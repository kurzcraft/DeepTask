import { safeWriteJson } from "../../utils/safeWriteJson"
import * as path from "path"
import * as vscode from "vscode"
import { getTaskDirectoryPath } from "../../utils/storage"
import { GlobalFileNames } from "../../shared/globalFileNames"
import { fileExistsAtPath } from "../../utils/fs"
import fs from "fs/promises"
import { ContextProxy } from "../config/ContextProxy"
import type { FileMetadataEntry, RecordSource, TaskMetadata } from "./FileContextTrackerTypes"
import { ClineProvider } from "../webview/ClineProvider"

// This class is responsible for tracking file operations that may result in stale context.
// If a user modifies a file outside of Roo, the context may become stale and need to be updated.
// We do not want Roo to reload the context every time a file is modified, so we use this class merely
// to inform Roo that the change has occurred, and tell Roo to reload the file before making
// any changes to it. This fixes an issue with diff editing, where Roo was unable to complete a diff edit.

// FileContextTracker
//
// This class is responsible for tracking file operations.
// If the full contents of a file are passed to Roo via a tool, mention, or edit, the file is marked as active.
// If a file is modified outside of Roo, we detect and track this change to prevent stale context.
export class FileContextTracker {
	readonly taskId: string
	private providerRef: WeakRef<ClineProvider>

	// File tracking and watching.
	// Never attach a recursive `**` change watcher: on a large repo that
	// floods the VS Code fileWatcher process (node_modules/.git/EXTRA churn)
	// even when we ignore unmatched paths. Tracked files are a small set, so
	// watch each one by basename. Editor saves also arrive via
	// onDidSaveTextDocument, which uses no extra inotify.
	// kilocode_change start
	private trackedFilesByAbs = new Map<string, string>()
	private fileWatchers = new Map<string, vscode.FileSystemWatcher>()
	private saveListener: vscode.Disposable | undefined
	// kilocode_change end
	private recentlyModifiedFiles = new Set<string>()
	private recentlyEditedByRoo = new Set<string>()
	private checkpointPossibleFiles = new Set<string>()

	constructor(provider: ClineProvider, taskId: string) {
		this.providerRef = new WeakRef(provider)
		this.taskId = taskId
	}

	// Gets the current working directory or returns undefined if it cannot be determined
	private getCwd(): string | undefined {
		const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)
		if (!cwd) {
			console.info("No workspace folder available - cannot determine current working directory")
		}
		return cwd
	}

	private handleTrackedFileChange(filePath: string): void {
		if (this.recentlyEditedByRoo.has(filePath)) {
			this.recentlyEditedByRoo.delete(filePath) // This was an edit by Roo, no need to inform Roo
			return
		}

		// Save events and basename watchers can both fire for one edit.
		if (this.recentlyModifiedFiles.has(filePath)) {
			return
		}

		this.recentlyModifiedFiles.add(filePath) // This was a user edit, we will inform Roo
		void this.trackFileContext(filePath, "user_edited") // Update the task metadata with file tracking
	}

	// kilocode_change start
	private ensureSaveListener(): void {
		if (this.saveListener || typeof vscode.workspace.onDidSaveTextDocument !== "function") {
			return
		}

		this.saveListener = vscode.workspace.onDidSaveTextDocument((document) => {
			const tracked = this.trackedFilesByAbs.get(path.normalize(document.uri.fsPath))
			if (tracked) {
				this.handleTrackedFileChange(tracked)
			}
		})
	}

	// File watchers are set up for each file that is tracked in the task metadata.
	async setupFileWatcher(filePath: string) {
		const cwd = this.getCwd()
		if (!cwd) {
			return
		}

		const absPath = path.normalize(path.resolve(cwd, filePath))
		if (this.trackedFilesByAbs.has(absPath) || this.fileWatchers.has(absPath)) {
			return
		}

		this.trackedFilesByAbs.set(absPath, filePath)
		this.ensureSaveListener()

		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(path.dirname(absPath), path.basename(absPath)),
			true,
			false,
			true,
		)
		watcher.onDidChange(() => this.handleTrackedFileChange(filePath))
		this.fileWatchers.set(absPath, watcher)
	}
	// kilocode_change end

	// Tracks a file operation in metadata and sets up a watcher for the file
	// This is the main entry point for FileContextTracker and is called when a file is passed to Roo via a tool, mention, or edit.
	async trackFileContext(filePath: string, operation: RecordSource) {
		try {
			const cwd = this.getCwd()
			if (!cwd) {
				return
			}

			await this.addFileToFileContextTracker(this.taskId, filePath, operation)

			// Set up file watcher for this file
			await this.setupFileWatcher(filePath)
		} catch (error) {
			console.error("Failed to track file operation:", error)
		}
	}

	public getContextProxy(): ContextProxy | undefined {
		const provider = this.providerRef.deref()
		if (!provider) {
			console.error("ClineProvider reference is no longer valid")
			return undefined
		}
		const context = provider.contextProxy

		if (!context) {
			console.error("Context is not available")
			return undefined
		}

		return context
	}

	// Gets task metadata from storage
	async getTaskMetadata(taskId: string): Promise<TaskMetadata> {
		const globalStoragePath = this.getContextProxy()?.globalStorageUri.fsPath ?? ""
		const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
		const filePath = path.join(taskDir, GlobalFileNames.taskMetadata)
		try {
			if (await fileExistsAtPath(filePath)) {
				return JSON.parse(await fs.readFile(filePath, "utf8"))
			}
		} catch (error) {
			console.error("Failed to read task metadata:", error)
		}
		return { files_in_context: [] }
	}

	// Saves task metadata to storage
	async saveTaskMetadata(taskId: string, metadata: TaskMetadata) {
		try {
			const globalStoragePath = this.getContextProxy()!.globalStorageUri.fsPath
			const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
			const filePath = path.join(taskDir, GlobalFileNames.taskMetadata)
			await safeWriteJson(filePath, metadata)

			// kilocode_change start
			// Post directly to webview for CLI to react to file save
			const provider = this.providerRef.deref()
			if (provider) {
				await provider.postMessageToWebview({
					type: "taskMetadataSaved",
					payload: [taskId, filePath],
				})
			}
			// kilocode_change end
		} catch (error) {
			console.error("Failed to save task metadata:", error)
		}
	}

	// Adds a file to the metadata tracker
	// This handles the business logic of determining if the file is new, stale, or active.
	// It also updates the metadata with the latest read/edit dates.
	async addFileToFileContextTracker(taskId: string, filePath: string, source: RecordSource) {
		try {
			const metadata = await this.getTaskMetadata(taskId)
			const now = Date.now()

			// Mark existing entries for this file as stale
			metadata.files_in_context.forEach((entry) => {
				if (entry.path === filePath && entry.record_state === "active") {
					entry.record_state = "stale"
				}
			})

			// Helper to get the latest date for a specific field and file
			const getLatestDateForField = (path: string, field: keyof FileMetadataEntry): number | null => {
				const relevantEntries = metadata.files_in_context
					.filter((entry) => entry.path === path && entry[field])
					.sort((a, b) => (b[field] as number) - (a[field] as number))

				return relevantEntries.length > 0 ? (relevantEntries[0][field] as number) : null
			}

			let newEntry: FileMetadataEntry = {
				path: filePath,
				record_state: "active",
				record_source: source,
				roo_read_date: getLatestDateForField(filePath, "roo_read_date"),
				roo_edit_date: getLatestDateForField(filePath, "roo_edit_date"),
				user_edit_date: getLatestDateForField(filePath, "user_edit_date"),
			}

			switch (source) {
				// user_edited: The user has edited the file
				case "user_edited":
					newEntry.user_edit_date = now
					this.recentlyModifiedFiles.add(filePath)
					break

				// roo_edited: Roo has edited the file
				case "roo_edited":
					newEntry.roo_read_date = now
					newEntry.roo_edit_date = now
					this.checkpointPossibleFiles.add(filePath)
					this.markFileAsEditedByRoo(filePath)
					break

				// read_tool/file_mentioned: Roo has read the file via a tool or file mention
				case "read_tool":
				case "file_mentioned":
					newEntry.roo_read_date = now
					break
			}

			metadata.files_in_context.push(newEntry)
			await this.saveTaskMetadata(taskId, metadata)
		} catch (error) {
			console.error("Failed to add file to metadata:", error)
		}
	}

	// Returns (and then clears) the set of recently modified files
	getAndClearRecentlyModifiedFiles(): string[] {
		const files = Array.from(this.recentlyModifiedFiles)
		this.recentlyModifiedFiles.clear()
		return files
	}

	getAndClearCheckpointPossibleFile(): string[] {
		const files = Array.from(this.checkpointPossibleFiles)
		this.checkpointPossibleFiles.clear()
		return files
	}

	// Marks a file as edited by Roo to prevent false positives in file watchers
	markFileAsEditedByRoo(filePath: string): void {
		this.recentlyEditedByRoo.add(filePath)
	}

	// Disposes all file watchers
	dispose(): void {
		this.saveListener?.dispose()
		this.saveListener = undefined
		for (const watcher of this.fileWatchers.values()) {
			watcher.dispose()
		}
		this.fileWatchers.clear()
		this.trackedFilesByAbs.clear()
	}
}
