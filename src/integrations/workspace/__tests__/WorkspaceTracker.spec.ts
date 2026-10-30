import type { Mock } from "vitest"
import * as vscode from "vscode"
import WorkspaceTracker from "../WorkspaceTracker"
import { ClineProvider } from "../../../core/webview/ClineProvider"
import { listFiles } from "../../../services/glob/list-files"
import { getWorkspacePath } from "../../../utils/path"

// Mock functions - must be defined before vitest.mock calls
const mockOnDidCreateFiles = vitest.fn()
const mockOnDidDeleteFiles = vitest.fn()
const mockOnDidRenameFiles = vitest.fn()
const mockOnDidSaveTextDocument = vitest.fn()
const mockOnDidOpenTextDocument = vitest.fn()
const mockDispose = vitest.fn()

// Store registered tab change callback
let registeredTabChangeCallback: (() => Promise<void>) | null = null
let createFilesCallback: ((event: { files: Array<{ scheme: string; fsPath: string }> }) => Promise<void>) | null = null
let deleteFilesCallback: ((event: { files: Array<{ scheme: string; fsPath: string }> }) => Promise<void>) | null = null
let renameFilesCallback:
	| ((event: { files: Array<{ oldUri: { scheme: string; fsPath: string }; newUri: { scheme: string; fsPath: string } }> }) => Promise<void>)
	| null = null
let saveDocumentCallback: ((document: { uri: { scheme: string; fsPath: string } }) => Promise<void>) | null = null
let openDocumentCallback: ((document: { uri: { scheme: string; fsPath: string } }) => Promise<void>) | null = null

// Mock workspace path
vitest.mock("../../../utils/path", () => ({
	getWorkspacePath: vitest.fn().mockReturnValue("/test/workspace"),
	toRelativePath: vitest.fn((path, cwd) => {
		// Handle both Windows and POSIX paths by using path.relative
		const relativePath = require("path").relative(cwd, path)
		// Convert to forward slashes for consistency
		let normalizedPath = relativePath.replace(/\\/g, "/")
		// Add trailing slash if original path had one
		return path.endsWith("/") ? normalizedPath + "/" : normalizedPath
	}),
}))

// Mock vscode
vitest.mock("vscode", () => ({
	window: {
		tabGroups: {
			onDidChangeTabs: vitest.fn((callback) => {
				registeredTabChangeCallback = callback
				return { dispose: mockDispose }
			}),
			all: [],
		},
		onDidChangeActiveTextEditor: vitest.fn(() => ({ dispose: vitest.fn() })),
	},
	workspace: {
		workspaceFolders: [
			{
				uri: { fsPath: "/test/workspace" },
				name: "test",
				index: 0,
			},
		],
		createFileSystemWatcher: vitest.fn(),
		onDidCreateFiles: vitest.fn((callback) => {
			createFilesCallback = callback
			return { dispose: mockDispose }
		}),
		onDidDeleteFiles: vitest.fn((callback) => {
			deleteFilesCallback = callback
			return { dispose: mockDispose }
		}),
		onDidRenameFiles: vitest.fn((callback) => {
			renameFilesCallback = callback
			return { dispose: mockDispose }
		}),
		onDidSaveTextDocument: vitest.fn((callback) => {
			saveDocumentCallback = callback
			return { dispose: mockDispose }
		}),
		onDidOpenTextDocument: vitest.fn((callback) => {
			openDocumentCallback = callback
			return { dispose: mockDispose }
		}),
		onDidChangeWorkspaceFolders: vitest.fn(() => ({ dispose: mockDispose })),
		fs: {
			stat: vitest.fn().mockResolvedValue({ type: 1 }), // FileType.File = 1
		},
	},
	Uri: {
		file: vitest.fn((fsPath: string) => ({ scheme: "file", fsPath })),
	},
	FileType: { File: 1, Directory: 2 },
	RelativePattern: vitest.fn((base: unknown, pattern: string) => ({ base, pattern })),
}))

vitest.mock("../../../services/glob/list-files", () => ({
	listFiles: vitest.fn(),
}))

describe("WorkspaceTracker", () => {
	let workspaceTracker: WorkspaceTracker
	let mockProvider: ClineProvider

	beforeEach(() => {
		vitest.clearAllMocks()
		vitest.useFakeTimers()

		// Reset all mock implementations
		registeredTabChangeCallback = null
		createFilesCallback = null
		deleteFilesCallback = null
		renameFilesCallback = null
		saveDocumentCallback = null
		openDocumentCallback = null

		// Reset workspace path mock
		;(getWorkspacePath as Mock).mockReturnValue("/test/workspace")

		// Create provider mock
		mockProvider = {
			postMessageToWebview: vitest.fn().mockResolvedValue(undefined),
		} as unknown as ClineProvider & { postMessageToWebview: Mock }

		// Create tracker instance
		workspaceTracker = new WorkspaceTracker(mockProvider)

		expect(registeredTabChangeCallback).not.toBeNull()
		expect(createFilesCallback).not.toBeNull()
		expect(deleteFilesCallback).not.toBeNull()
		expect(renameFilesCallback).not.toBeNull()
		expect(saveDocumentCallback).not.toBeNull()
		expect(openDocumentCallback).not.toBeNull()
	})

	afterEach(() => {
		workspaceTracker.dispose()
		vitest.useRealTimers()
	})

	const flushWorkspaceUpdate = async () => {
		await vitest.runAllTimersAsync()
	}

	it("should use workspace file events instead of a recursive RelativePattern watcher", () => {
		expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled()
		expect(vscode.workspace.onDidCreateFiles).toHaveBeenCalled()
		expect(vscode.workspace.onDidDeleteFiles).toHaveBeenCalled()
		expect(vscode.workspace.onDidRenameFiles).toHaveBeenCalled()
		expect(vscode.workspace.onDidSaveTextDocument).toHaveBeenCalled()
		expect(vscode.workspace.onDidOpenTextDocument).toHaveBeenCalled()
	})

	it("should initialize with workspace files", async () => {
		const mockFiles = [["/test/workspace/file1.ts", "/test/workspace/file2.ts"], false]
		;(listFiles as Mock).mockResolvedValue(mockFiles)

		await workspaceTracker.initializeFilePaths()
		vitest.runAllTimers()

		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "workspaceUpdated",
			filePaths: expect.arrayContaining(["file1.ts", "file2.ts"]),
			openedTabs: [],
		})
		expect((mockProvider.postMessageToWebview as Mock).mock.calls[0][0].filePaths).toHaveLength(2)
	})

	it("should handle file creation events", async () => {
		await createFilesCallback!({ files: [{ scheme: "file", fsPath: "/test/workspace/newfile.ts" }] })
		await flushWorkspaceUpdate()

		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "workspaceUpdated",
			filePaths: ["newfile.ts"],
			openedTabs: [],
		})
	})

	it("should handle file deletion events", async () => {
		await createFilesCallback!({ files: [{ scheme: "file", fsPath: "/test/workspace/file.ts" }] })
		await flushWorkspaceUpdate()

		await deleteFilesCallback!({ files: [{ scheme: "file", fsPath: "/test/workspace/file.ts" }] })
		await flushWorkspaceUpdate()

		expect(mockProvider.postMessageToWebview).toHaveBeenLastCalledWith({
			type: "workspaceUpdated",
			filePaths: [],
			openedTabs: [],
		})
	})

	it("should handle directory paths correctly", async () => {
		;(vscode.workspace.fs.stat as Mock).mockResolvedValueOnce({ type: 2 })

		await createFilesCallback!({ files: [{ scheme: "file", fsPath: "/test/workspace/newdir" }] })
		await flushWorkspaceUpdate()

		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "workspaceUpdated",
			filePaths: expect.arrayContaining(["newdir/"]),
			openedTabs: [],
		})
		const lastCall = (mockProvider.postMessageToWebview as Mock).mock.calls.slice(-1)[0]
		expect(lastCall[0].filePaths).toHaveLength(1)
	})

	it("should treat saved and opened documents as created files", async () => {
		await saveDocumentCallback!({ uri: { scheme: "file", fsPath: "/test/workspace/saved.ts" } })
		await flushWorkspaceUpdate()

		expect((mockProvider.postMessageToWebview as Mock).mock.calls.at(-1)?.[0].filePaths).toEqual(
			expect.arrayContaining(["saved.ts"]),
		)

		await openDocumentCallback!({ uri: { scheme: "file", fsPath: "/test/workspace/opened.ts" } })
		await flushWorkspaceUpdate()

		expect((mockProvider.postMessageToWebview as Mock).mock.calls.at(-1)?.[0].filePaths).toEqual(
			expect.arrayContaining(["saved.ts", "opened.ts"]),
		)
	})

	it("should ignore node_modules, git, pnpm, and worktree paths", async () => {
		await createFilesCallback!({
			files: [
				{ scheme: "file", fsPath: "/test/workspace/node_modules/pkg/index.js" },
				{ scheme: "file", fsPath: "/test/workspace/.git/HEAD" },
				{ scheme: "file", fsPath: "/test/workspace/.pnpm/store/file" },
				{ scheme: "file", fsPath: "/test/workspace/.kilocode/worktrees/agent-1/src/a.ts" },
				{ scheme: "file", fsPath: "/test/workspace/src/keep.ts" },
			],
		})
		await flushWorkspaceUpdate()

		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "workspaceUpdated",
			filePaths: ["src/keep.ts"],
			openedTabs: [],
		})
	})

	it("should handle rename events as delete plus create", async () => {
		await createFilesCallback!({ files: [{ scheme: "file", fsPath: "/test/workspace/old.ts" }] })
		await flushWorkspaceUpdate()

		await renameFilesCallback!({
			files: [
				{
					oldUri: { scheme: "file", fsPath: "/test/workspace/old.ts" },
					newUri: { scheme: "file", fsPath: "/test/workspace/new.ts" },
				},
			],
		})
		await flushWorkspaceUpdate()

		expect(mockProvider.postMessageToWebview).toHaveBeenLastCalledWith({
			type: "workspaceUpdated",
			filePaths: ["new.ts"],
			openedTabs: [],
		})
	})

	it("should respect file limits", async () => {
		// Create array of unique file paths for initial load
		const files = Array.from({ length: 1001 }, (_, i) => `/test/workspace/file${i}.ts`)
		;(listFiles as Mock).mockResolvedValue([files, false])

		await workspaceTracker.initializeFilePaths()
		vitest.runAllTimers()

		// Should only have 1000 files initially
		const expectedFiles = Array.from({ length: 1000 }, (_, i) => `file${i}.ts`).sort()
		const calls = (mockProvider.postMessageToWebview as Mock).mock.calls

		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "workspaceUpdated",
			filePaths: expect.arrayContaining(expectedFiles),
			openedTabs: [],
		})
		expect(calls[0][0].filePaths).toHaveLength(1000)

		await createFilesCallback!({
			files: Array.from({ length: 1000 }, (_, i) => ({
				scheme: "file",
				fsPath: `/test/workspace/extra${i}.ts`,
			})),
		})
		await flushWorkspaceUpdate()

		const lastCall = (mockProvider.postMessageToWebview as Mock).mock.calls.slice(-1)[0]
		expect(lastCall[0].filePaths).toHaveLength(2000)

		await createFilesCallback!({ files: [{ scheme: "file", fsPath: "/test/workspace/toomany.ts" }] })
		await flushWorkspaceUpdate()

		const finalCall = (mockProvider.postMessageToWebview as Mock).mock.calls.slice(-1)[0]
		expect(finalCall[0].filePaths).toHaveLength(2000)
	})

	it("should clean up listeners and timers on dispose", async () => {
		const pending = createFilesCallback!({ files: [{ scheme: "file", fsPath: "/test/workspace/file.ts" }] })
		workspaceTracker.dispose()
		await pending
		expect(mockDispose).toHaveBeenCalled()
		vitest.runAllTimers()

		expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
	})

	it("should handle workspace path changes when tabs change", async () => {
		expect(registeredTabChangeCallback).not.toBeNull()

		// Set initial workspace path and create tracker
		;(getWorkspacePath as Mock).mockReturnValue("/test/workspace")
		workspaceTracker = new WorkspaceTracker(mockProvider)

		// Clear any initialization calls
		vitest.clearAllMocks()

		// Mock listFiles to return some files
		const mockFiles = [["/test/new-workspace/file1.ts"], false]
		;(listFiles as Mock).mockResolvedValue(mockFiles)

		// Change workspace path
		;(getWorkspacePath as Mock).mockReturnValue("/test/new-workspace")

		// Simulate tab change event
		await registeredTabChangeCallback!()

		// Run the debounce timer for workspaceDidReset
		vitest.advanceTimersByTime(300)

		// Should clear file paths and reset workspace
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "workspaceUpdated",
			filePaths: [],
			openedTabs: [],
		})

		// Run all remaining timers to complete initialization
		await Promise.resolve() // Wait for initializeFilePaths to complete
		vitest.runAllTimers()

		// Should initialize file paths for new workspace
		expect(listFiles).toHaveBeenCalledWith("/test/new-workspace", true, 1000)
		vitest.runAllTimers()
	})

	it("should not update file paths if workspace changes during initialization", async () => {
		// Setup initial workspace path
		;(getWorkspacePath as Mock).mockReturnValue("/test/workspace")
		workspaceTracker = new WorkspaceTracker(mockProvider)

		// Clear any initialization calls
		vitest.clearAllMocks()
		;(mockProvider.postMessageToWebview as Mock).mockClear()

		// Create a promise to control listFiles timing
		let resolveListFiles: (value: [string[], boolean]) => void
		const listFilesPromise = new Promise<[string[], boolean]>((resolve) => {
			resolveListFiles = resolve
		})

		// Setup listFiles to use our controlled promise
		;(listFiles as Mock).mockImplementation(() => {
			// Change workspace path before listFiles resolves
			;(getWorkspacePath as Mock).mockReturnValue("/test/changed-workspace")
			return listFilesPromise
		})

		// Start initialization
		const initPromise = workspaceTracker.initializeFilePaths()

		// Resolve listFiles after workspace path change
		resolveListFiles!([["/test/workspace/file1.ts", "/test/workspace/file2.ts"], false])

		// Wait for initialization to complete
		await initPromise
		vitest.runAllTimers()

		// Should not update file paths because workspace changed during initialization
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "workspaceUpdated",
				openedTabs: [],
			}),
		)

		// Extract the actual file paths to verify format
		const actualFilePaths = (mockProvider.postMessageToWebview as Mock).mock.calls[0][0].filePaths

		// Verify file path array length
		expect(actualFilePaths).toHaveLength(2)

		// Verify file paths contain the expected file names regardless of platform specifics
		expect(actualFilePaths.every((path: string) => path.includes("file1.ts") || path.includes("file2.ts"))).toBe(
			true,
		)
	})

	it("should clear resetTimer when calling workspaceDidReset multiple times", async () => {
		expect(registeredTabChangeCallback).not.toBeNull()

		// Set initial workspace path
		;(getWorkspacePath as Mock).mockReturnValue("/test/workspace")

		// Create tracker instance to set initial prevWorkSpacePath
		workspaceTracker = new WorkspaceTracker(mockProvider)

		// Change workspace path to trigger update
		;(getWorkspacePath as Mock).mockReturnValue("/test/new-workspace")

		// Call workspaceDidReset through tab change event
		await registeredTabChangeCallback!()

		// Call again before timer completes
		await registeredTabChangeCallback!()

		// Advance timer
		vitest.advanceTimersByTime(300)

		// Should only have one call to postMessageToWebview
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "workspaceUpdated",
			filePaths: [],
			openedTabs: [],
		})
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledTimes(1)
	})

	it("should handle dispose with active resetTimer", async () => {
		expect(registeredTabChangeCallback).not.toBeNull()

		// Mock workspace path change to trigger resetTimer
		;(getWorkspacePath as Mock).mockReturnValueOnce("/test/workspace").mockReturnValueOnce("/test/new-workspace")

		// Trigger resetTimer
		await registeredTabChangeCallback!()

		// Dispose before timer completes
		workspaceTracker.dispose()

		// Advance timer
		vitest.advanceTimersByTime(300)

		// Should have called dispose on all disposables
		expect(mockDispose).toHaveBeenCalled()

		// No postMessage should be called after dispose
		expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
	})
})
