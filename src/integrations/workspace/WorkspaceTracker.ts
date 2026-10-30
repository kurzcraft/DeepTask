import * as vscode from "vscode"
import * as path from "path"

import { listFiles } from "../../services/glob/list-files"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { toRelativePath, getWorkspacePath } from "../../utils/path"

const MAX_INITIAL_FILES = 1_000

// Note: this is not a drop-in replacement for listFiles at the start of tasks, since that will be done for Desktops when there is no workspace selected
class WorkspaceTracker {
	private providerRef: WeakRef<ClineProvider>
	private disposables: vscode.Disposable[] = []
	private filePaths: Set<string> = new Set()
	private updateTimer: NodeJS.Timeout | null = null
	private prevWorkSpacePath: string | undefined
	private resetTimer: NodeJS.Timeout | null = null
	private pendingPathUpdates = 0
	private pendingUpdateAfterPaths = false
	private lastWorkspaceUpdateKey: string | undefined
	private lastWorkspaceUpdateAt = 0
	private disposed = false
	private static readonly WORKSPACE_UPDATE_DEDUP_MS = 300
	private static readonly WORKSPACE_FILE_EVENT_CONCURRENCY = 8
	private static readonly WORKSPACE_FILE_EVENT_MAX_URIS = MAX_INITIAL_FILES * 2
	private static readonly WORKSPACE_UPDATE_MAX_TABS = 64
	private static readonly WORKSPACE_UPDATE_MAX_PATHS = MAX_INITIAL_FILES * 2
	private static readonly IGNORED_PATH_MARKERS = [
		`${path.sep}node_modules${path.sep}`,
		`${path.sep}.git${path.sep}`,
		`${path.sep}.pnpm${path.sep}`,
		`${path.sep}.kilocode${path.sep}worktrees${path.sep}`,
	]

	get cwd() {
		return this.providerRef?.deref()?.cwd ?? getWorkspacePath()
	}
	constructor(provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)
		this.registerListeners()
	}

	async initializeFilePaths() {
		// should not auto get filepaths for desktop since it would immediately show permission popup before cline ever creates a file
		if (!this.cwd) {
			return
		}
		const tempCwd = this.cwd
		const [files, _] = await listFiles(tempCwd, true, MAX_INITIAL_FILES)
		if (this.prevWorkSpacePath !== tempCwd) {
			return
		}
		this.filePaths.clear() // kilocode_change: initializeFilePaths is called multiple times, clear to avoid exceeding MAX_INITIAL_FILES
		files
			.slice(0, MAX_INITIAL_FILES)
			.filter((file) => !this.shouldIgnorePath(file))
			.forEach((file) => this.filePaths.add(this.normalizeFilePath(file)))
		this.workspaceDidUpdate()
	}

	private registerListeners() {
		this.prevWorkSpacePath = this.cwd

		// kilocode_change start: do not create a recursive RelativePattern "**"
		// watcher. VS Code compiles that glob as a second full-tree inotify that
		// ignores files.watcherExclude, pinning node_modules/.git until the
		// fileWatcher process OOMs and the webview goes grey. Workspace file
		// events reuse the editor's existing watchers and still cover agent
		// writes that go through vscode.workspace.fs / TextDocument save.
		this.disposables.push(
			vscode.workspace.onDidCreateFiles((event) => {
				void this.handleCreatedUris(event.files)
			}),
			vscode.workspace.onDidDeleteFiles((event) => {
				void this.handleDeletedUris(event.files)
			}),
			vscode.workspace.onDidRenameFiles((event) => {
				void this.handleRenamedFiles(event.files)
			}),
			vscode.workspace.onDidSaveTextDocument((document) => {
				if (document.uri.scheme !== "file") {
					return
				}
				void this.handleCreatedUris([document.uri])
			}),
			vscode.workspace.onDidOpenTextDocument((document) => {
				if (document.uri.scheme !== "file") {
					return
				}
				void this.handleCreatedUris([document.uri])
			}),
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				this.workspaceDidReset()
			}),
		)
		// kilocode_change end

		// Listen for tab changes and call workspaceDidUpdate directly
		this.disposables.push(
			vscode.window.tabGroups.onDidChangeTabs(() => {
				// Reset if workspace path has changed
				if (this.prevWorkSpacePath !== this.cwd) {
					this.workspaceDidReset()
				} else {
					// Otherwise just update
					this.workspaceDidUpdate()
				}
			}),
		)
	}

	private shouldIgnorePath(filePath: string): boolean {
		const normalized = path.normalize(filePath)
		const wrapped = `${path.sep}${normalized}${path.sep}`
		return WorkspaceTracker.IGNORED_PATH_MARKERS.some((marker) => wrapped.includes(marker))
	}

	private async mapUrisWithLimit<T>(uris: readonly vscode.Uri[], mapper: (uri: vscode.Uri) => Promise<T>): Promise<T[]> {
		const limited = uris.slice(0, WorkspaceTracker.WORKSPACE_FILE_EVENT_MAX_URIS)
		const results: T[] = []
		for (let i = 0; i < limited.length; i += WorkspaceTracker.WORKSPACE_FILE_EVENT_CONCURRENCY) {
			const chunk = limited.slice(i, i + WorkspaceTracker.WORKSPACE_FILE_EVENT_CONCURRENCY)
			results.push(...(await Promise.all(chunk.map((uri) => mapper(uri)))))
		}
		return results
	}

	private beginPathUpdate(): void {
		this.pendingPathUpdates++
	}

	private endPathUpdate(): void {
		this.pendingPathUpdates = Math.max(0, this.pendingPathUpdates - 1)
		if (this.pendingPathUpdates === 0 && this.pendingUpdateAfterPaths) {
			this.pendingUpdateAfterPaths = false
			this.workspaceDidUpdate()
		}
	}

	private async handleCreatedUris(uris: readonly vscode.Uri[]): Promise<void> {
		if (this.disposed) {
			return
		}
		this.beginPathUpdate()
		try {
			const relevant = uris.filter((uri) => uri.scheme === "file" && !this.shouldIgnorePath(uri.fsPath))
			if (relevant.length === 0) {
				return
			}
			await this.mapUrisWithLimit(relevant, (uri) => this.addFilePath(uri.fsPath))
			if (!this.disposed) {
				this.workspaceDidUpdate()
			}
		} finally {
			this.endPathUpdate()
		}
	}

	private async handleDeletedUris(uris: readonly vscode.Uri[]): Promise<void> {
		if (this.disposed) {
			return
		}
		this.beginPathUpdate()
		try {
			const relevant = uris.filter((uri) => uri.scheme === "file" && !this.shouldIgnorePath(uri.fsPath))
			if (relevant.length === 0) {
				return
			}
			const removed = await this.mapUrisWithLimit(relevant, (uri) => this.removeFilePath(uri.fsPath))
			if (!this.disposed && removed.some(Boolean)) {
				this.workspaceDidUpdate()
			}
		} finally {
			this.endPathUpdate()
		}
	}

	private async handleRenamedFiles(files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]): Promise<void> {
		if (this.disposed) {
			return
		}
		this.beginPathUpdate()
		try {
			const oldUris = files.map((file) => file.oldUri)
			const newUris = files.map((file) => file.newUri)
			await this.mapUrisWithLimit(
				oldUris.filter((uri) => uri.scheme === "file" && !this.shouldIgnorePath(uri.fsPath)),
				(uri) => this.removeFilePath(uri.fsPath),
			)
			await this.mapUrisWithLimit(
				newUris.filter((uri) => uri.scheme === "file" && !this.shouldIgnorePath(uri.fsPath)),
				(uri) => this.addFilePath(uri.fsPath),
			)
			if (!this.disposed) {
				this.workspaceDidUpdate()
			}
		} finally {
			this.endPathUpdate()
		}
	}

	private getOpenedTabsInfo() {
		const tabs = vscode.window.tabGroups.all.reduce(
			(acc, group) => {
				const groupTabs = group.tabs
					.filter((tab) => tab.input instanceof vscode.TabInputText)
					.map((tab) => ({
						label: tab.label,
						isActive: tab.isActive,
						path: toRelativePath((tab.input as vscode.TabInputText).uri.fsPath, this.cwd || ""),
					}))

				groupTabs.forEach((tab) => (tab.isActive ? acc.unshift(tab) : acc.push(tab)))
				return acc
			},
			[] as Array<{ label: string; isActive: boolean; path: string }>,
		)
		return tabs.slice(0, WorkspaceTracker.WORKSPACE_UPDATE_MAX_TABS)
	}

	private async workspaceDidReset() {
		if (this.resetTimer) {
			clearTimeout(this.resetTimer)
		}
		this.resetTimer = setTimeout(async () => {
			if (this.prevWorkSpacePath !== this.cwd) {
				await this.providerRef.deref()?.postMessageToWebview({
					type: "workspaceUpdated",
					filePaths: [],
					openedTabs: this.getOpenedTabsInfo(),
				})
				this.filePaths.clear()
				this.lastWorkspaceUpdateKey = undefined
				this.lastWorkspaceUpdateAt = 0
				this.prevWorkSpacePath = this.cwd
				this.initializeFilePaths()
			}
		}, 300) // Debounce for 300ms
	}

	private workspaceDidUpdate() {
		if (this.disposed) {
			return
		}
		if (this.pendingPathUpdates > 0) {
			this.pendingUpdateAfterPaths = true
			return
		}
		if (this.updateTimer) {
			clearTimeout(this.updateTimer)
		}
		this.updateTimer = setTimeout(() => {
			if (!this.cwd) {
				return
			}

			const relativeFilePaths = Array.from(this.filePaths)
				.slice(0, WorkspaceTracker.WORKSPACE_UPDATE_MAX_PATHS)
				.map((file) => toRelativePath(file, this.cwd))
			const openedTabs = this.getOpenedTabsInfo()
			const updateKey = JSON.stringify({ filePaths: relativeFilePaths, openedTabs })
			const now = Date.now()
			if (
				updateKey === this.lastWorkspaceUpdateKey &&
				now - this.lastWorkspaceUpdateAt < WorkspaceTracker.WORKSPACE_UPDATE_DEDUP_MS
			) {
				this.updateTimer = null
				return
			}
			this.lastWorkspaceUpdateKey = updateKey
			this.lastWorkspaceUpdateAt = now
			this.providerRef.deref()?.postMessageToWebview({
				type: "workspaceUpdated",
				filePaths: relativeFilePaths,
				openedTabs,
			})
			this.updateTimer = null
		}, 300) // Debounce for 300ms
	}

	private normalizeFilePath(filePath: string): string {
		const resolvedPath = this.cwd ? path.resolve(this.cwd, filePath) : path.resolve(filePath)
		return filePath.endsWith("/") ? resolvedPath + "/" : resolvedPath
	}

	private async addFilePath(filePath: string): Promise<string> {
		// Allow for some buffer to account for files being created/deleted during a task
		if (this.filePaths.size >= MAX_INITIAL_FILES * 2) {
			return filePath
		}

		if (this.shouldIgnorePath(filePath)) {
			return filePath
		}

		const normalizedPath = this.normalizeFilePath(filePath)
		try {
			const stat = await vscode.workspace.fs.stat(vscode.Uri.file(normalizedPath))
			const isDirectory = (stat.type & vscode.FileType.Directory) !== 0
			const pathWithSlash = isDirectory && !normalizedPath.endsWith("/") ? normalizedPath + "/" : normalizedPath
			this.filePaths.add(pathWithSlash)
			return pathWithSlash
		} catch {
			// If stat fails, assume it's a file (this can happen for newly created files)
			this.filePaths.add(normalizedPath)
			return normalizedPath
		}
	}

	private async removeFilePath(filePath: string): Promise<boolean> {
		const normalizedPath = this.normalizeFilePath(filePath)
		return this.filePaths.delete(normalizedPath) || this.filePaths.delete(normalizedPath + "/")
	}

	public dispose() {
		this.disposed = true
		if (this.updateTimer) {
			clearTimeout(this.updateTimer)
			this.updateTimer = null
		}
		if (this.resetTimer) {
			clearTimeout(this.resetTimer)
			this.resetTimer = null
		}
		this.pendingPathUpdates = 0
		this.pendingUpdateAfterPaths = false
		this.lastWorkspaceUpdateKey = undefined
		this.lastWorkspaceUpdateAt = 0
		this.disposables.forEach((d) => d.dispose())
		this.disposables = [] // Clear the array
	}
}

export default WorkspaceTracker
