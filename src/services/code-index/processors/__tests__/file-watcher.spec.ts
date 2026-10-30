// npx vitest services/code-index/processors/__tests__/file-watcher.spec.ts

import * as vscode from "vscode"

import { FileWatcher } from "../file-watcher"

vi.mock("../../../../../packages/telemetry/src/TelemetryService", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

vi.mock("../../cache-manager")
vi.mock("../../../../core/ignore/RooIgnoreController", () => ({
	RooIgnoreController: vi.fn().mockImplementation(() => ({
		validateAccess: vi.fn().mockReturnValue(true),
	})),
}))
vi.mock("ignore")
vi.mock("../parser", () => ({
	codeParser: {
		parseFile: vi.fn().mockResolvedValue([]),
	},
}))

let createFilesCallback: ((event: { files: Array<{ scheme: string; fsPath: string }> }) => void) | null = null
let deleteFilesCallback: ((event: { files: Array<{ scheme: string; fsPath: string }> }) => void) | null = null
let saveDocumentCallback: ((document: { uri: { scheme: string; fsPath: string } }) => void) | null = null
const mockWorkspaceDispose = vi.fn()

vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn().mockReturnValue({
			onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
			onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
			onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
			dispose: vi.fn(),
		}),
		onDidCreateFiles: vi.fn((callback) => {
			createFilesCallback = callback
			return { dispose: mockWorkspaceDispose }
		}),
		onDidDeleteFiles: vi.fn((callback) => {
			deleteFilesCallback = callback
			return { dispose: mockWorkspaceDispose }
		}),
		onDidRenameFiles: vi.fn(() => ({ dispose: mockWorkspaceDispose })),
		onDidSaveTextDocument: vi.fn((callback) => {
			saveDocumentCallback = callback
			return { dispose: mockWorkspaceDispose }
		}),
		workspaceFolders: [
			{
				uri: {
					fsPath: "/mock/workspace",
				},
			},
		],
		fs: {
			stat: vi.fn().mockResolvedValue({ size: 1000 }),
			readFile: vi.fn().mockResolvedValue(Buffer.from("test content")),
		},
	},
	RelativePattern: vi.fn().mockImplementation((base, pattern) => ({ base, pattern })),
	Uri: {
		file: vi.fn().mockImplementation((path) => ({ fsPath: path, scheme: "file" })),
	},
	EventEmitter: vi.fn().mockImplementation(() => ({
		event: vi.fn(),
		fire: vi.fn(),
		dispose: vi.fn(),
	})),
	ExtensionContext: vi.fn(),
}))

describe("FileWatcher", () => {
	let fileWatcher: FileWatcher
	let mockContext: any
	let mockCacheManager: any
	let mockEmbedder: any
	let mockVectorStore: any
	let mockIgnoreInstance: any

	beforeEach(() => {
		vi.clearAllMocks()
		createFilesCallback = null
		deleteFilesCallback = null
		saveDocumentCallback = null

		mockContext = {
			subscriptions: [],
		}

		mockCacheManager = {
			getHash: vi.fn(),
			updateHash: vi.fn(),
			deleteHash: vi.fn(),
		}

		mockEmbedder = {
			createEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
		}

		mockVectorStore = {
			upsertPoints: vi.fn().mockResolvedValue(undefined),
			deletePointsByFilePath: vi.fn().mockResolvedValue(undefined),
			deletePointsByMultipleFilePaths: vi.fn().mockResolvedValue(undefined),
		}

		mockIgnoreInstance = {
			ignores: vi.fn().mockReturnValue(false),
		}

		const mockIgnoreController = {
			validateAccess: vi.fn().mockReturnValue(true),
		}

		fileWatcher = new FileWatcher(
			"/mock/workspace",
			mockContext,
			mockCacheManager,
			mockEmbedder,
			mockVectorStore,
			mockIgnoreInstance,
			mockIgnoreController as any,
		)
	})

	describe("workspace file events", () => {
		it("should use workspace file events instead of a recursive RelativePattern watcher", async () => {
			await fileWatcher.initialize()

			expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled()
			expect(vscode.workspace.onDidCreateFiles).toHaveBeenCalled()
			expect(vscode.workspace.onDidDeleteFiles).toHaveBeenCalled()
			expect(vscode.workspace.onDidRenameFiles).toHaveBeenCalled()
			expect(vscode.workspace.onDidSaveTextDocument).toHaveBeenCalled()
			expect(createFilesCallback).not.toBeNull()
			expect(deleteFilesCallback).not.toBeNull()
			expect(saveDocumentCallback).not.toBeNull()
		})
	})

	describe("file filtering", () => {
		it("should ignore files in hidden directories on create events", async () => {
			await fileWatcher.initialize()

			const processedFiles: string[] = []
			mockVectorStore.upsertPoints.mockImplementation(async (points: any[]) => {
				points.forEach((point) => {
					if (point.payload?.file_path) {
						processedFiles.push(point.payload.file_path)
					}
				})
			})

			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.git/config", shouldProcess: false },
				{ path: "/mock/workspace/.hidden/file.ts", shouldProcess: false },
				{ path: "/mock/workspace/src/.next/static/file.js", shouldProcess: false },
				{ path: "/mock/workspace/node_modules/package/index.js", shouldProcess: false },
				{ path: "/mock/workspace/normal/file.js", shouldProcess: true },
			]

			createFilesCallback!({
				files: testCases.map(({ path }) => ({ scheme: "file", fsPath: path })),
			})

			await new Promise((resolve) => setTimeout(resolve, 600))

			expect(processedFiles).not.toContain("src/.next/static/file.js")
			expect(processedFiles).not.toContain(".git/config")
			expect(processedFiles).not.toContain(".hidden/file.ts")
		})

		it("should ignore files in hidden directories on change events", async () => {
			await fileWatcher.initialize()

			const processedFiles: string[] = []
			mockVectorStore.upsertPoints.mockImplementation(async (points: any[]) => {
				points.forEach((point) => {
					if (point.payload?.file_path) {
						processedFiles.push(point.payload.file_path)
					}
				})
			})

			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.vscode/settings.json", shouldProcess: false },
				{ path: "/mock/workspace/src/.cache/data.json", shouldProcess: false },
				{ path: "/mock/workspace/dist/bundle.js", shouldProcess: false },
			]

			for (const { path } of testCases) {
				saveDocumentCallback!({ uri: { scheme: "file", fsPath: path } })
			}

			await new Promise((resolve) => setTimeout(resolve, 600))

			expect(processedFiles).not.toContain(".vscode/settings.json")
			expect(processedFiles).not.toContain("src/.cache/data.json")
		})

		it("should ignore files in hidden directories on delete events", async () => {
			await fileWatcher.initialize()

			const deletedFiles: string[] = []
			mockVectorStore.deletePointsByFilePath.mockImplementation(async (filePath: string) => {
				deletedFiles.push(filePath)
			})

			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.git/objects/abc123", shouldProcess: false },
				{ path: "/mock/workspace/.DS_Store", shouldProcess: false },
				{ path: "/mock/workspace/build/.cache/temp.js", shouldProcess: false },
			]

			deleteFilesCallback!({
				files: testCases.map(({ path }) => ({ scheme: "file", fsPath: path })),
			})

			await new Promise((resolve) => setTimeout(resolve, 600))

			expect(deletedFiles).not.toContain(".git/objects/abc123")
			expect(deletedFiles).not.toContain(".DS_Store")
			expect(deletedFiles).not.toContain("build/.cache/temp.js")
		})

		it("should handle nested hidden directories correctly", async () => {
			await fileWatcher.initialize()

			const processedFiles: string[] = []
			mockVectorStore.upsertPoints.mockImplementation(async (points: any[]) => {
				points.forEach((point) => {
					if (point.payload?.file_path) {
						processedFiles.push(point.payload.file_path)
					}
				})
			})

			const testCases = [
				{ path: "/mock/workspace/src/components/Button.tsx", shouldProcess: true },
				{ path: "/mock/workspace/src/.hidden/components/Button.tsx", shouldProcess: false },
				{ path: "/mock/workspace/.hidden/src/components/Button.tsx", shouldProcess: false },
				{ path: "/mock/workspace/src/components/.hidden/Button.tsx", shouldProcess: false },
			]

			createFilesCallback!({
				files: testCases.map(({ path }) => ({ scheme: "file", fsPath: path })),
			})

			await new Promise((resolve) => setTimeout(resolve, 600))

			expect(processedFiles).not.toContain("src/.hidden/components/Button.tsx")
			expect(processedFiles).not.toContain(".hidden/src/components/Button.tsx")
			expect(processedFiles).not.toContain("src/components/.hidden/Button.tsx")
		})
	})

	describe("dispose", () => {
		it("should dispose workspace listeners when disposed", async () => {
			await fileWatcher.initialize()
			fileWatcher.dispose()

			expect(mockWorkspaceDispose).toHaveBeenCalled()
			expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled()
		})
	})
})
