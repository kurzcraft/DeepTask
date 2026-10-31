import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"
import fs from "fs/promises"

import { ClineProvider } from "../ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"
import { fileExistsAtPath } from "../../../utils/fs"
import { getTaskDirectoryPath } from "../../../utils/storage"
import { downloadTask } from "../../../integrations/misc/export-markdown"

vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	return {
		workspace: {
			getConfiguration: vi.fn(() => ({
				get: vi.fn().mockReturnValue([]),
				update: vi.fn().mockResolvedValue(undefined),
			})),
			workspaceFolders: [],
			onDidChangeConfiguration: vi.fn(() => mockDisposable),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: vi.fn().mockImplementation(() => ({
			event: vi.fn(),
			fire: vi.fn(),
		})),
		Disposable: { from: vi.fn() },
		window: {
			showErrorMessage: vi.fn(),
			createTextEditorDecorationType: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onDidChangeActiveTextEditor: vi.fn(() => mockDisposable),
		},
		Uri: {
			file: vi.fn().mockReturnValue({ toString: () => "file://test" }),
		},
	}
})

vi.mock("fs/promises", () => {
	const readFile = vi.fn()
	return {
		default: { readFile, mkdir: vi.fn(), writeFile: vi.fn() },
		readFile,
		mkdir: vi.fn(),
		writeFile: vi.fn(),
	}
})

vi.mock("../../task/Task")
vi.mock("../../config/ContextProxy", () => ({
	ContextProxy: vi.fn().mockImplementation(() => ({
		getValue: vi.fn().mockReturnValue(undefined),
		setValue: vi.fn().mockResolvedValue(undefined),
		getValues: vi.fn().mockReturnValue({}),
		setValues: vi.fn().mockResolvedValue(undefined),
		globalStorageUri: { fsPath: "/test/storage/path" },
	})),
}))
vi.mock("../../../services/mcp/McpServerManager", () => ({
	McpServerManager: {
		getInstance: vi.fn().mockResolvedValue({ registerClient: vi.fn() }),
		unregisterProvider: vi.fn(),
	},
}))
vi.mock("../../../services/marketplace")
vi.mock("../../../integrations/workspace/WorkspaceTracker")
vi.mock("../../config/ProviderSettingsManager")
vi.mock("../../config/CustomModesManager")
vi.mock("../../../utils/path", () => ({
	getWorkspacePath: vi.fn().mockReturnValue("/test/workspace"),
}))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			setProvider: vi.fn(),
			captureTaskCreated: vi.fn(),
		},
	},
}))
vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
}))
vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi.fn(),
	getSettingsDirectoryPath: vi.fn().mockResolvedValue("/test/settings/path"),
	getGlobalStoragePath: vi.fn().mockResolvedValue("/test/storage/path"),
}))
vi.mock("../../../integrations/misc/export-markdown", () => ({
	downloadTask: vi.fn().mockResolvedValue(undefined),
}))

describe("ClineProvider.getTaskWithId", () => {
	const historyItem = { id: "task-1", ts: 123, task: "long running" }
	let provider: ClineProvider

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(getTaskDirectoryPath).mockResolvedValue("/test/task/path")
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify([{ role: "user", content: "full history" }]))

		const mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: { get: vi.fn(), update: vi.fn(), keys: vi.fn().mockReturnValue([]) },
			workspaceState: { get: vi.fn(), update: vi.fn(), keys: vi.fn().mockReturnValue([]) },
			secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
			subscriptions: [],
			extension: { packageJSON: { version: "1.0.0" } },
			globalStorageUri: { fsPath: "/test/storage/path" },
		} as unknown as vscode.ExtensionContext
		const mockOutputChannel = { appendLine: vi.fn() } as unknown as vscode.OutputChannel
		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))
		vi.spyOn(provider as any, "getGlobalState").mockImplementation((key: unknown) =>
			key === "taskHistory" ? [historyItem] : undefined,
		)
	})

	it("skips parsing api_conversation_history for metadata lookups", async () => {
		const result = await provider.getTaskWithId("task-1")

		expect(fs.readFile).not.toHaveBeenCalled()
		expect(result.historyItem).toEqual(historyItem)
		expect(result.apiConversationHistory).toEqual([])
		expect(result.apiConversationHistoryFilePath).toBe("/test/task/path/api_conversation_history.json")
		expect(result.uiMessagesFilePath).toBe("/test/task/path/ui_messages.json")
	})

	it("parses api_conversation_history only when export asks for it", async () => {
		const result = await provider.getTaskWithId("task-1", true, { includeApiConversationHistory: true })

		expect(fs.readFile).toHaveBeenCalledWith("/test/task/path/api_conversation_history.json", "utf8")
		expect(result.apiConversationHistory).toEqual([{ role: "user", content: "full history" }])
	})

	it("exportTaskWithId loads the parsed history for download", async () => {
		await provider.exportTaskWithId("task-1")

		expect(fs.readFile).toHaveBeenCalledWith("/test/task/path/api_conversation_history.json", "utf8")
		expect(downloadTask).toHaveBeenCalledWith(123, [{ role: "user", content: "full history" }])
	})
})
