import * as vscode from "vscode"
import { FileContextTracker } from "../FileContextTracker"
import type { ClineProvider } from "../../webview/ClineProvider"

const mockDispose = vi.fn()
const mockOnDidChange = vi.fn(() => ({ dispose: mockDispose }))
const mockWatcher = {
	onDidChange: mockOnDidChange,
	onDidCreate: vi.fn(() => ({ dispose: mockDispose })),
	onDidDelete: vi.fn(() => ({ dispose: mockDispose })),
	dispose: mockDispose,
}

const mockOnDidSaveTextDocument = vi.fn(() => ({ dispose: mockDispose }))

vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [
			{
				uri: { fsPath: "/test/workspace" },
				name: "test",
				index: 0,
			},
		],
		createFileSystemWatcher: vi.fn(() => mockWatcher),
		onDidSaveTextDocument: (...args: unknown[]) => mockOnDidSaveTextDocument(...args),
	},
	RelativePattern: vi.fn((base: unknown, pattern: string) => ({ base, pattern })),
	Uri: {
		file: (fsPath: string) => ({ fsPath }),
	},
}))

describe("FileContextTracker targeted watchers", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockOnDidChange.mockReturnValue({ dispose: mockDispose })
		mockOnDidSaveTextDocument.mockReturnValue({ dispose: mockDispose })
	})

	it("watches each tracked file by basename and never attaches a recursive ** change watcher", async () => {
		const tracker = new FileContextTracker({} as ClineProvider, "task-1")

		await tracker.setupFileWatcher("src/a.ts")
		await tracker.setupFileWatcher("src/b.ts")
		await tracker.setupFileWatcher("src/a.ts")

		expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(2)
		expect(vscode.workspace.createFileSystemWatcher).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ pattern: "a.ts" }),
			true,
			false,
			true,
		)
		expect(vscode.workspace.createFileSystemWatcher).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ pattern: "b.ts" }),
			true,
			false,
			true,
		)
		expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalledWith(
			expect.objectContaining({ pattern: "**" }),
			expect.anything(),
			expect.anything(),
			expect.anything(),
		)
		expect(mockOnDidSaveTextDocument).toHaveBeenCalledTimes(1)

		tracker.dispose()
		expect(mockDispose).toHaveBeenCalled()
	})

	it("creates a dedicated watcher for files outside cwd as well", async () => {
		const tracker = new FileContextTracker({} as ClineProvider, "task-1")

		await tracker.setupFileWatcher("src/a.ts")
		await tracker.setupFileWatcher("/elsewhere/secret.ts")

		expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(2)
		expect(vscode.workspace.createFileSystemWatcher).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ pattern: "secret.ts" }),
			true,
			false,
			true,
		)

		tracker.dispose()
	})

	it("marks a tracked file as user-edited on save without watching the whole tree", async () => {
		const tracker = new FileContextTracker({} as ClineProvider, "task-1")
		await tracker.setupFileWatcher("src/a.ts")

		const [[saveCallback]] = mockOnDidSaveTextDocument.mock.calls
		saveCallback({ uri: { fsPath: "/test/workspace/src/a.ts" } })

		expect(tracker.getAndClearRecentlyModifiedFiles()).toEqual(["src/a.ts"])
		expect(tracker.getAndClearRecentlyModifiedFiles()).toEqual([])

		tracker.dispose()
	})
})
