// npx vitest core/webview/__tests__/webviewMessageHandler.spec.ts

import type { Mock } from "vitest"

// Mock dependencies - must come before imports
vi.mock("../../../api/providers/fetchers/modelCache")

vi.mock("../../../integrations/openai-codex/oauth", () => ({
	openAiCodexOAuthManager: {
		getAccessToken: vi.fn(),
		getAccountId: vi.fn(),
	},
}))

vi.mock("../../../integrations/openai-codex/rate-limits", () => ({
	fetchOpenAiCodexRateLimitInfo: vi.fn(),
}))

// Mock the diagnosticsHandler module
vi.mock("../diagnosticsHandler", () => ({
	generateErrorDiagnostics: vi.fn().mockResolvedValue({ success: true, filePath: "/tmp/diagnostics.json" }),
}))

vi.mock("../../task-persistence", () => ({
	saveTaskMessages: vi.fn().mockResolvedValue(undefined),
}))

import type { ModelRecord } from "@roo-code/types"

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"
import { getModels } from "../../../api/providers/fetchers/modelCache"
const { openAiCodexOAuthManager } = await import("../../../integrations/openai-codex/oauth")
const { fetchOpenAiCodexRateLimitInfo } = await import("../../../integrations/openai-codex/rate-limits")

const mockGetModels = getModels as Mock<typeof getModels>
const mockGetAccessToken = vi.mocked(openAiCodexOAuthManager.getAccessToken)
const mockGetAccountId = vi.mocked(openAiCodexOAuthManager.getAccountId)
const mockFetchOpenAiCodexRateLimitInfo = vi.mocked(fetchOpenAiCodexRateLimitInfo)

// Mock ClineProvider
const mockClineProvider = {
	getState: vi.fn(),
	postMessageToWebview: vi.fn(),
	customModesManager: {
		getCustomModes: vi.fn(),
		deleteCustomMode: vi.fn(),
	},
	context: {
		extensionPath: "/mock/extension/path",
		globalStorageUri: { fsPath: "/mock/global/storage" },
	},
	contextProxy: {
		globalStorageUri: { fsPath: "/mock/global/storage" },
		context: {
			extensionPath: "/mock/extension/path",
			globalStorageUri: { fsPath: "/mock/global/storage" },
		},
		setValue: vi.fn(),
		getValue: vi.fn(),
	},
	log: vi.fn(),
	postStateToWebview: vi.fn(),
	getCurrentTask: vi.fn(),
	getTaskWithId: vi.fn(),
	createTaskWithHistoryItem: vi.fn(),
	setPendingCancelledTaskContinuation: vi.fn(),
	cancelTask: vi.fn().mockResolvedValue(undefined),
} as unknown as ClineProvider

import { t } from "../../../i18n"

vi.mock("vscode", () => {
	const showInformationMessage = vi.fn()
	const showErrorMessage = vi.fn()
	const openTextDocument = vi.fn().mockResolvedValue({})
	const showTextDocument = vi.fn().mockResolvedValue(undefined)

	return {
		window: {
			showInformationMessage,
			showErrorMessage,
			showTextDocument,
			createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })), // kilocode_change
		},
		workspace: {
			workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
			openTextDocument,
		},
	}
})

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string, args?: Record<string, any>) => {
		// For the delete confirmation with rules, we need to return the interpolated string
		if (key === "common:confirmation.delete_custom_mode_with_rules" && args) {
			return `Are you sure you want to delete this ${args.scope} mode?\n\nThis will also delete the associated rules folder at:\n${args.rulesFolderPath}`
		}
		// Return the translated value for "Yes"
		if (key === "common:answers.yes") {
			return "Yes"
		}
		// Return the translated value for "Cancel"
		if (key === "common:answers.cancel") {
			return "Cancel"
		}
		return key
	}),
}))

vi.mock("fs/promises", () => {
	const mockRm = vi.fn().mockResolvedValue(undefined)
	const mockMkdir = vi.fn().mockResolvedValue(undefined)
	const mockReadFile = vi.fn().mockResolvedValue("[]")
	const mockWriteFile = vi.fn().mockResolvedValue(undefined)

	return {
		default: {
			rm: mockRm,
			mkdir: mockMkdir,
			readFile: mockReadFile,
			writeFile: mockWriteFile,
		},
		rm: mockRm,
		mkdir: mockMkdir,
		readFile: mockReadFile,
		writeFile: mockWriteFile,
	}
})

import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as fsUtils from "../../../utils/fs"
import { getWorkspacePath } from "../../../utils/path"
import { ensureSettingsDirectoryExists } from "../../../utils/globalContext"
import { generateErrorDiagnostics } from "../diagnosticsHandler"
import type { ModeConfig } from "@roo-code/types"

vi.mock("../../../utils/fs")
vi.mock("../../../utils/path")
vi.mock("../../../utils/globalContext")

vi.mock("../../mentions/resolveImageMentions", () => ({
	resolveImageMentions: vi.fn(async ({ text, images }: { text: string; images?: string[] }) => ({
		text,
		images: [...(images ?? []), "data:image/png;base64,from-mention"],
	})),
}))

import { resolveImageMentions } from "../../mentions/resolveImageMentions"

describe("webviewMessageHandler - requestLmStudioModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				lmStudioModelId: "model-1",
				lmStudioBaseUrl: "http://localhost:1234",
			},
		})
	})

	it("successfully fetches models from LMStudio", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
			"model-2": {
				maxTokens: 8192,
				contextWindow: 16384,
				supportsPromptCache: false,
				description: "Test model 2",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestLmStudioModels",
		})

		expect(mockGetModels).toHaveBeenCalledWith({ provider: "lmstudio", baseUrl: "http://localhost:1234" })

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "lmStudioModels",
			lmStudioModels: mockModels,
		})
	})
})

describe("webviewMessageHandler - image mentions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			maxImageFileSize: 5,
			maxTotalImageSize: 20,
		})
	})

	it("should resolve image mentions for askResponse payloads", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(true),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "See @/img.png",
			images: [],
		})

		expect(vi.mocked(resolveImageMentions)).toHaveBeenCalled()
		expect(mockHandleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "See @/img.png", [
			"data:image/png;base64,from-mention",
		])
	})

	it("routes user text as a continuation when no ask is pending", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			clineMessages: [{ ts: 1, type: "say", say: "text", text: "still active", partial: false }],
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "continue without a visible ask",
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockContinueTaskFromUserMessage).toHaveBeenCalledWith("continue without a visible ask", [
			"data:image/png;base64,from-mention",
		])
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("resumes the task for an empty stale yesButton click when no ask is pending", async () => {
		vi.mocked(resolveImageMentions).mockResolvedValueOnce({ text: "", images: [] })
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "yesButtonClicked",
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockContinueTaskFromUserMessage).toHaveBeenCalledWith("")
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("drops a late yesButton for an already auto-approved tool ask instead of sending continue", async () => {
		vi.mocked(resolveImageMentions).mockResolvedValueOnce({ text: "", images: [] })
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn()
		const answeredAsk = {
			ts: 200,
			type: "ask",
			ask: "tool",
			text: JSON.stringify({ tool: "switchProviderProfile", profile: "deepseek" }),
			isAnswered: true,
			partial: false,
		}
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			getPendingWebviewAskTs: vi.fn().mockReturnValue(undefined),
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			findMessageByTimestamp: vi.fn().mockReturnValue(answeredAsk),
			clineMessages: [answeredAsk],
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "yesButtonClicked",
			askTs: 200,
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockContinueTaskFromUserMessage).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("resumes after API-key edit when a late Continue targets an already-marked resume_task row", async () => {
		// Returning from settings after fixing an API key often re-clicks Resume on a
		// row that was briefly marked answered. That click must still continue work,
		// otherwise the webview clears buttons and freezes with no recovery path.
		vi.mocked(resolveImageMentions).mockResolvedValueOnce({ text: "", images: [] })
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn()
		const answeredResumeAsk = {
			ts: 300,
			type: "ask",
			ask: "resume_task",
			isAnswered: true,
			partial: false,
		}
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			getPendingWebviewAskTs: vi.fn().mockReturnValue(undefined),
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			findMessageByTimestamp: vi.fn().mockReturnValue(answeredResumeAsk),
			clineMessages: [answeredResumeAsk],
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "yesButtonClicked",
			askTs: 300,
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockContinueTaskFromUserMessage).toHaveBeenCalledWith("")
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("wakes a live terminal for a stale yesButton click after the command ask settled", async () => {
		vi.mocked(resolveImageMentions).mockResolvedValueOnce({ text: "", images: [] })
		const mockHandleWebviewAskResponse = vi.fn()
		const mockHandleTerminalOperation = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			terminalProcess: { continue: vi.fn() },
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			handleTerminalOperation: mockHandleTerminalOperation,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "yesButtonClicked",
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockContinueTaskFromUserMessage).not.toHaveBeenCalled()
		expect(mockHandleTerminalOperation).toHaveBeenCalledWith("continue", "", [])
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("ignores stale askResponse payloads for an older ask row", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			getPendingWebviewAskTs: vi.fn().mockReturnValue(200),
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(true),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "yesButtonClicked",
			askTs: 100,
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("accepts askResponse payloads for the current ask row", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			getPendingWebviewAskTs: vi.fn().mockReturnValue(200),
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(true),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "yesButtonClicked",
			askTs: 200,
			images: [],
		})

		expect(mockHandleWebviewAskResponse).toHaveBeenCalledWith("yesButtonClicked", "", [
			"data:image/png;base64,from-mention",
		])
	})

	it("routes user text to a stuck terminal process without waiting for a task loop", async () => {
		const mockHandleTerminalOperation = vi.fn().mockResolvedValue(new Promise(() => {}))
		const mockContinueTaskFromUserMessage = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			terminalProcess: { continue: vi.fn() },
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			handleTerminalOperation: mockHandleTerminalOperation,
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "command is done, continue",
			images: [],
		})

		expect(mockHandleTerminalOperation).toHaveBeenCalledWith("continue", "command is done, continue", [
			"data:image/png;base64,from-mention",
		])
		expect(mockContinueTaskFromUserMessage).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("converts stale terminalOperation after command exit into a real continuation", async () => {
		const mockHandleTerminalOperation = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			terminalProcess: undefined,
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			handleTerminalOperation: mockHandleTerminalOperation,
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "terminalOperation",
			terminalOperation: "continue",
			terminalOperationText: "command finished, keep going",
			terminalOperationImages: [],
		})

		expect(mockHandleTerminalOperation).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockContinueTaskFromUserMessage).toHaveBeenCalledWith("command finished, keep going", [])
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("resumes the task for an empty Continue click after the shell has already exited", async () => {
		const mockHandleTerminalOperation = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			terminalProcess: undefined,
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			handleTerminalOperation: mockHandleTerminalOperation,
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "terminalOperation",
			terminalOperation: "continue",
			terminalOperationText: "",
			terminalOperationImages: [],
		})

		expect(mockHandleTerminalOperation).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockContinueTaskFromUserMessage).toHaveBeenCalledWith("", [])
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("stores streaming cancellation continuations instead of dropping them", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockSetPendingCancelledTaskContinuation = vi.fn()
		const mockCancelTask = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			isStreaming: true,
			abortReason: "user_cancelled",
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
		} as any)
		;(mockClineProvider as any).setPendingCancelledTaskContinuation = mockSetPendingCancelledTaskContinuation
		;(mockClineProvider as any).cancelTask = mockCancelTask

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "continue after cancellation",
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockSetPendingCancelledTaskContinuation).toHaveBeenCalledWith("continue after cancellation", [
			"data:image/png;base64,from-mention",
		])
		// Already cancelling: only park the message; do not re-enter cancelTask.
		expect(mockCancelTask).not.toHaveBeenCalled()
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("interrupts a live stream by parking the message and cancelling the task", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockSetPendingCancelledTaskContinuation = vi.fn()
		const mockCancelTask = vi.fn().mockResolvedValue(undefined)
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			isStreaming: true,
			abandoned: false,
			abortReason: undefined,
			isActivelyRunningTaskLoop: vi.fn().mockReturnValue(true),
			clineMessages: [{ ts: 1, type: "say", say: "text", text: "still working", partial: true }],
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)
		;(mockClineProvider as any).setPendingCancelledTaskContinuation = mockSetPendingCancelledTaskContinuation
		;(mockClineProvider as any).cancelTask = mockCancelTask

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "new mid-task instruction",
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockContinueTaskFromUserMessage).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockSetPendingCancelledTaskContinuation).toHaveBeenCalledWith("new mid-task instruction", [
			"data:image/png;base64,from-mention",
		])
		expect(mockCancelTask).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("restores the webview when cancelling a live stream fails", async () => {
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockCancelTask = vi.fn().mockRejectedValue(new Error("history persistence failed"))
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			isStreaming: true,
			abandoned: false,
			abortReason: undefined,
			isActivelyRunningTaskLoop: vi.fn().mockReturnValue(true),
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
		} as any)
		;(mockClineProvider as any).cancelTask = mockCancelTask

		await expect(
			webviewMessageHandler(mockClineProvider, {
				type: "askResponse",
				askResponse: "messageResponse",
				text: "recover after failed cancel",
				images: [],
			}),
		).resolves.toBeUndefined()

		expect(mockCancelTask).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "action",
			action: "chatButtonClicked",
		})
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("continues the existing task when a message arrives at a completion boundary", async () => {
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockSetPendingCancelledTaskContinuation = vi.fn()
		const mockCancelTask = vi.fn().mockResolvedValue(undefined)
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		const mockCreateTask = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			isStreaming: true,
			abandoned: false,
			abortReason: undefined,
			isSoftCompletionBoundaryPending: vi.fn().mockReturnValue(true),
			clineMessages: [{ ts: 1, type: "say", say: "completion_result", text: "soft done", partial: false }],
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)
		;(mockClineProvider as any).setPendingCancelledTaskContinuation = mockSetPendingCancelledTaskContinuation
		;(mockClineProvider as any).cancelTask = mockCancelTask
		;(mockClineProvider as any).createTask = mockCreateTask

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "reply immediately after completion",
			images: [],
		})

		expect(mockContinueTaskFromUserMessage).not.toHaveBeenCalled()
		expect(mockCreateTask).not.toHaveBeenCalled()
		expect(mockSetPendingCancelledTaskContinuation).toHaveBeenCalledWith(
			"reply immediately after completion",
			["data:image/png;base64,from-mention"],
			{ kind: "continuation" },
		)
		expect(mockCancelTask).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
	})

	it("routes a completion message to continuation while the old stream is still unwinding", async () => {
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		const mockCancelTask = vi.fn().mockResolvedValue(undefined)
		const completionMessage = { ts: 1, type: "say", say: "completion_result", text: "done", partial: false }
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			isStreaming: true,
			abandoned: false,
			abortReason: undefined,
			isSoftCompletionBoundaryPending: vi.fn().mockReturnValue(false),
			clineMessages: [completionMessage],
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)
		;(mockClineProvider as any).cancelTask = mockCancelTask

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "extend the completed work",
			images: [],
		})

		expect(mockContinueTaskFromUserMessage).not.toHaveBeenCalled()
		expect(mockCancelTask).toHaveBeenCalledTimes(1)
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
	})

	it("does not let historical soft completion preempt a live tool ask", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			isStreaming: false,
			abandoned: false,
			abortReason: undefined,
			isActivelyRunningTaskLoop: vi.fn().mockReturnValue(true),
			clineMessages: [
				{ ts: 1, type: "say", say: "completion_result", text: "soft done", partial: false },
				{ ts: 2, type: "ask", ask: "tool", text: "{}", partial: false },
			],
			getPendingWebviewAskTs: vi.fn().mockReturnValue(2),
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(true),
			findMessageByTimestamp: vi.fn().mockReturnValue({ ts: 2, type: "ask", ask: "tool" }),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			askTs: 2,
			text: "answer the tool ask",
			images: [],
		})

		expect(mockContinueTaskFromUserMessage).not.toHaveBeenCalled()
		expect(mockHandleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "answer the tool ask", [
			"data:image/png;base64,from-mention",
		])
	})

	it("routes a message past a stale ask that predates the final completion row", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		const mockSetPendingCancelledTaskContinuation = vi.fn()
		const mockCancelTask = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			isStreaming: false,
			abandoned: false,
			abortReason: undefined,
			isSoftCompletionBoundaryPending: vi.fn().mockReturnValue(false),
			clineMessages: [
				{ ts: 2, type: "ask", ask: "followup", text: "stale", partial: false },
				{ ts: 3, type: "say", say: "completion_result", text: "done", partial: false },
			],
			getPendingWebviewAskTs: vi.fn().mockReturnValue(2),
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(true),
			findMessageByTimestamp: vi.fn().mockReturnValue({ ts: 2, type: "ask", ask: "followup" }),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)
		;(mockClineProvider as any).setPendingCancelledTaskContinuation = mockSetPendingCancelledTaskContinuation
		;(mockClineProvider as any).cancelTask = mockCancelTask

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			askTs: 2,
			text: "continue after the completed task",
			images: [],
		})

		expect(mockContinueTaskFromUserMessage).not.toHaveBeenCalled()
		expect(mockSetPendingCancelledTaskContinuation).toHaveBeenCalledWith(
			"continue after the completed task",
			["data:image/png;base64,from-mention"],
			{ kind: "continuation" },
		)
		expect(mockCancelTask).toHaveBeenCalledTimes(1)
		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
	})

	it("answers a command_output ask instead of parking/cancelling while the loop is active", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockSetPendingCancelledTaskContinuation = vi.fn()
		const mockCancelTask = vi.fn().mockResolvedValue(undefined)
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			isStreaming: false,
			abandoned: false,
			abortReason: undefined,
			isActivelyRunningTaskLoop: vi.fn().mockReturnValue(true),
			terminalProcess: undefined,
			clineMessages: [{ ts: 9, type: "ask", ask: "command_output", partial: false }],
			getPendingWebviewAskTs: vi.fn().mockReturnValue(9),
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(true),
			findMessageByTimestamp: vi.fn().mockReturnValue({ ts: 9, type: "ask", ask: "command_output" }),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)
		;(mockClineProvider as any).setPendingCancelledTaskContinuation = mockSetPendingCancelledTaskContinuation
		;(mockClineProvider as any).cancelTask = mockCancelTask

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			askTs: 9,
			text: "command done continue",
			images: [],
		})

		expect(mockCancelTask).not.toHaveBeenCalled()
		expect(mockSetPendingCancelledTaskContinuation).not.toHaveBeenCalled()
		expect(mockContinueTaskFromUserMessage).not.toHaveBeenCalled()
		expect(mockHandleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "command done continue", [
			"data:image/png;base64,from-mention",
		])
	})

	it("does not feed cancelled-task continuations into a stale pending ask", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockSetPendingCancelledTaskContinuation = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			isStreaming: false,
			abortReason: "user_cancelled",
			getPendingWebviewAskTs: vi.fn().mockReturnValue(200),
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(true),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
		} as any)
		;(mockClineProvider as any).setPendingCancelledTaskContinuation = mockSetPendingCancelledTaskContinuation

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			askTs: 200,
			text: "continue after paused model",
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockSetPendingCancelledTaskContinuation).toHaveBeenCalledWith("continue after paused model", [
			"data:image/png;base64,from-mention",
		])
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("routes legacy queued messages during cancellation as pending continuations", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockSetPendingCancelledTaskContinuation = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			isStreaming: false,
			abortReason: "user_cancelled",
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(true),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
		} as any)
		;(mockClineProvider as any).setPendingCancelledTaskContinuation = mockSetPendingCancelledTaskContinuation

		await webviewMessageHandler(mockClineProvider, {
			type: "queueMessage",
			text: "legacy queued during cancel",
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockSetPendingCancelledTaskContinuation).toHaveBeenCalledWith("legacy queued during cancel", [
			"data:image/png;base64,from-mention",
		])
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("routes legacy queued messages to a stuck terminal before pending asks", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		const mockHandleTerminalOperation = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			terminalProcess: { continue: vi.fn() },
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(true),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			handleTerminalOperation: mockHandleTerminalOperation,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "queueMessage",
			text: "legacy queued terminal feedback",
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockHandleTerminalOperation).toHaveBeenCalledWith("continue", "legacy queued terminal feedback", [
			"data:image/png;base64,from-mention",
		])
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("rehydrates completion_result feedback when no ask is pending", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		const mockCreateTask = vi.fn().mockResolvedValue(undefined)
		const mockSetPendingCancelledTaskContinuation = vi.fn()
		const mockCancelTask = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			clineMessages: [{ ts: 1, type: "ask", ask: "completion_result", partial: false }],
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)
		;(mockClineProvider as any).createTask = mockCreateTask
		;(mockClineProvider as any).setPendingCancelledTaskContinuation = mockSetPendingCancelledTaskContinuation
		;(mockClineProvider as any).cancelTask = mockCancelTask

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "continue from final feedback",
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockContinueTaskFromUserMessage).not.toHaveBeenCalled()
		expect(mockSetPendingCancelledTaskContinuation).toHaveBeenCalledWith(
			"continue from final feedback",
			["data:image/png;base64,from-mention"],
			{ kind: "continuation" },
		)
		expect(mockCancelTask).toHaveBeenCalledTimes(1)
		expect(mockCreateTask).not.toHaveBeenCalled()
	})
	it("rehydrates the task before consuming a stale pending completion ask", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		const mockCreateTask = vi.fn().mockResolvedValue(undefined)
		const mockSetPendingCancelledTaskContinuation = vi.fn()
		const mockCancelTask = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			clineMessages: [{ ts: 1, type: "ask", ask: "completion_result", partial: false }],
			getPendingWebviewAskTs: vi.fn().mockReturnValue(1),
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(true),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)
		;(mockClineProvider as any).createTask = mockCreateTask
		;(mockClineProvider as any).setPendingCancelledTaskContinuation = mockSetPendingCancelledTaskContinuation
		;(mockClineProvider as any).cancelTask = mockCancelTask

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "continue even if completion looked pending",
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockContinueTaskFromUserMessage).not.toHaveBeenCalled()
		expect(mockSetPendingCancelledTaskContinuation).toHaveBeenCalledWith(
			"continue even if completion looked pending",
			["data:image/png;base64,from-mention"],
			{ kind: "continuation" },
		)
		expect(mockCancelTask).toHaveBeenCalledTimes(1)
		expect(mockCreateTask).not.toHaveBeenCalled()
		expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
	})

	it("rehydrates post-completion text even when completion is no longer last", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		const mockCreateTask = vi.fn().mockResolvedValue(undefined)
		const mockSetPendingCancelledTaskContinuation = vi.fn()
		const mockCancelTask = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			clineMessages: [
				{ ts: 1, type: "ask", ask: "completion_result", partial: false },
				{ ts: 2, type: "say", say: "text", text: "visible summary", partial: false },
			],
			getPendingWebviewAskTs: vi.fn().mockReturnValue(undefined),
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)
		;(mockClineProvider as any).createTask = mockCreateTask
		;(mockClineProvider as any).setPendingCancelledTaskContinuation = mockSetPendingCancelledTaskContinuation
		;(mockClineProvider as any).cancelTask = mockCancelTask

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "do the next fix",
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockContinueTaskFromUserMessage).not.toHaveBeenCalled()
		expect(mockSetPendingCancelledTaskContinuation).toHaveBeenCalledWith(
			"do the next fix",
			["data:image/png;base64,from-mention"],
			{ kind: "continuation" },
		)
		expect(mockCancelTask).toHaveBeenCalledTimes(1)
		expect(mockCreateTask).not.toHaveBeenCalled()
		expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
	})

	it("does not reset the chat while rehydrating after completion", async () => {
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		const mockCreateTask = vi.fn().mockResolvedValue(undefined)
		const mockSetPendingCancelledTaskContinuation = vi.fn()
		const mockCancelTask = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			clineMessages: [{ ts: 1, type: "ask", ask: "completion_result", partial: false }],
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)
		;(mockClineProvider as any).createTask = mockCreateTask
		;(mockClineProvider as any).setPendingCancelledTaskContinuation = mockSetPendingCancelledTaskContinuation
		;(mockClineProvider as any).cancelTask = mockCancelTask

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "continue from final feedback",
			images: [],
		})

		expect(mockContinueTaskFromUserMessage).not.toHaveBeenCalled()
		expect(mockSetPendingCancelledTaskContinuation).toHaveBeenCalledWith(
			"continue from final feedback",
			["data:image/png;base64,from-mention"],
			{ kind: "continuation" },
		)
		expect(mockCancelTask).toHaveBeenCalledTimes(1)
		expect(mockCreateTask).not.toHaveBeenCalled()
		expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
	})

	it("creates a new task when askResponse arrives without a current task", async () => {
		const mockCreateTask = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue(undefined as any)
		;(mockClineProvider as any).createTask = mockCreateTask

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "start work from the home task list",
			images: [],
		})

		expect(mockCreateTask).toHaveBeenCalledWith("start work from the home task list", [
			"data:image/png;base64,from-mention",
		])
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
	})

	it("routes empty continue clicks as continuations when no ask is pending", async () => {
		vi.mocked(resolveImageMentions).mockResolvedValueOnce({ text: "", images: [] })
		const mockHandleWebviewAskResponse = vi.fn()
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			clineMessages: [{ ts: 1, type: "say", say: "text", text: "previous response", partial: false }],
			getPendingWebviewAskTs: vi.fn().mockReturnValue(undefined),
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "",
			images: [],
		})

		expect(mockHandleWebviewAskResponse).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockContinueTaskFromUserMessage).toHaveBeenCalledWith("")
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - stale message modification confirmations", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("ignores stale edit confirmations without showing a message-not-found error", async () => {
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			clineMessages: [{ ts: 1, type: "say", say: "text", text: "remaining" }],
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "editMessageConfirm",
			messageTs: 999,
			text: "stale edit",
		})

		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("ignores stale delete confirmations without showing a message-not-found error", async () => {
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			clineMessages: [{ ts: 1, type: "say", say: "text", text: "remaining" }],
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "deleteMessageConfirm",
			messageTs: 999,
		})

		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - legacy queueMessage anti-stall routing", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({})
	})

	it("routes non-empty legacy queue messages as continuations when no ask is pending", async () => {
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn().mockResolvedValue(undefined)
		const mockSay = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
			say: mockSay,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "queueMessage",
			text: "legacy queued continuation",
			images: [],
		})

		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockContinueTaskFromUserMessage).toHaveBeenCalledWith("legacy queued continuation", [
			"data:image/png;base64,from-mention",
		])
		expect(mockSay).not.toHaveBeenCalled()
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("starts a fresh task when legacy queue input arrives without a current task", async () => {
		const mockCreateTask = vi.fn().mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue(undefined as any)
		;(mockClineProvider as any).createTask = mockCreateTask

		await webviewMessageHandler(mockClineProvider, {
			type: "queueMessage",
			text: "start from legacy queue",
			images: [],
		})

		expect(mockCreateTask).toHaveBeenCalledWith("start from legacy queue", ["data:image/png;base64,from-mention"])
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
	})

	it("clears empty legacy queue messages without starting a continuation", async () => {
		vi.mocked(resolveImageMentions).mockResolvedValueOnce({ text: "", images: [] })
		const mockClearStaleWebviewAskResponse = vi.fn()
		const mockClearQueue = vi.fn()
		const mockContinueTaskFromUserMessage = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			clearStaleWebviewAskResponse: mockClearStaleWebviewAskResponse,
			messageQueueService: { clear: mockClearQueue },
			continueTaskFromUserMessage: mockContinueTaskFromUserMessage,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "queueMessage",
			text: "",
			images: [],
		})

		expect(mockClearQueue).toHaveBeenCalledTimes(1)
		expect(mockClearStaleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(mockContinueTaskFromUserMessage).not.toHaveBeenCalled()
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - requestOllamaModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				ollamaModelId: "model-1",
				ollamaBaseUrl: "http://localhost:1234",
			},
		})
	})

	it("successfully fetches models from Ollama", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
			"model-2": {
				maxTokens: 8192,
				contextWindow: 16384,
				supportsPromptCache: false,
				description: "Test model 2",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestOllamaModels",
		})

		expect(mockGetModels).toHaveBeenCalledWith({ provider: "ollama", baseUrl: "http://localhost:1234" })

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "ollamaModels",
			ollamaModels: mockModels,
		})
	})
})

describe("webviewMessageHandler - requestRouterModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				glamaApiKey: "glama-key", // kilocode_change
				unboundApiKey: "unbound-key",
				litellmApiKey: "litellm-key",
				litellmBaseUrl: "http://localhost:4000",
				// kilocode_change start
				chutesApiKey: "chutes-key",
				geminiApiKey: "gemini-key",
				googleGeminiBaseUrl: "https://gemini.example.com",
				nanoGptApiKey: "nano-gpt-key",
				ovhCloudAiEndpointsApiKey: "ovhcloud-key",
				inceptionLabsApiKey: "inception-key",
				inceptionLabsBaseUrl: "https://api.inceptionlabs.ai/v1/",
				// kilocode_change end
			},
		})
	})

	it("successfully fetches models from all providers", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
			"model-2": {
				maxTokens: 8192,
				contextWindow: 16384,
				supportsPromptCache: false,
				description: "Test model 2",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
		})

		// Verify getModels was called for each provider
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "openrouter", apiKey: "openrouter-key" }) // kilocode_change: apiKey
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "requesty", apiKey: "requesty-key" })
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "glama" }) // kilocode_change
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "unbound", apiKey: "unbound-key" })
		// kilocode_change start
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "chutes", apiKey: "chutes-key" })
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "gemini",
			apiKey: "gemini-key",
			baseUrl: "https://gemini.example.com",
		})
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "inception",
			apiKey: "inception-key",
			baseUrl: "https://api.inceptionlabs.ai/v1/",
		})
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "nano-gpt",
			apiKey: "nano-gpt-key",
			nanoGptModelList: undefined,
		})
		// kilocode_change end
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "vercel-ai-gateway" })
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "deepinfra" })
		expect(mockGetModels).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "roo",
				baseUrl: expect.any(String),
			}),
		)
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "litellm-key",
			baseUrl: "http://localhost:4000",
		})
		// Note: huggingface is not fetched in requestRouterModels - it has its own handler
		// Note: io-intelligence is not fetched because no API key is provided in the mock state

		// Verify response was sent
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				cerebras: {},
				deepinfra: mockModels,
				deepseek: {},
				openrouter: mockModels,
				gemini: mockModels, // kilocode_change
				requesty: mockModels,
				glama: mockModels, // kilocode_change
				groq: {},
				synthetic: mockModels, // kilocode_change
				unbound: mockModels,
				litellm: mockModels,
				kilocode: mockModels,
				mistral: {},
				"nano-gpt": mockModels, // kilocode_change
				roo: mockModels,
				chutes: mockModels,
				ollama: mockModels, // kilocode_change
				lmstudio: {},
				"vercel-ai-gateway": mockModels,
				huggingface: {},
				"io-intelligence": {},
				ovhcloud: mockModels, // kilocode_change
				inception: mockModels, // kilocode_change
				"sap-ai-core": {}, // kilocode_change
			},
			values: undefined,
		})
	})

	it("handles LiteLLM models with values from message when config is missing", async () => {
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				glamaApiKey: "glama-key", // kilocode_change
				unboundApiKey: "unbound-key",
				ovhCloudAiEndpointsApiKey: "ovhcloud-key", // kilocode_change
				// Missing litellm config
			},
		})

		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
			values: {
				litellmApiKey: "message-litellm-key",
				litellmBaseUrl: "http://message-url:4000",
			},
		})

		// Verify LiteLLM was called with values from message
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "message-litellm-key",
			baseUrl: "http://message-url:4000",
		})
	})

	it("skips LiteLLM when both config and message values are missing", async () => {
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				unboundApiKey: "unbound-key",
				// kilocode_change start
				ovhCloudAiEndpointsApiKey: "ovhcloud-key",
				chutesApiKey: "chutes-key",
				nanoGptApiKey: "nano-gpt-key",
				// kilocode_change end
				// Missing litellm config
			},
		})

		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
			// No values provided
		})

		// Verify LiteLLM was NOT called
		expect(mockGetModels).not.toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "litellm",
			}),
		)

		// Verify response includes empty object for LiteLLM
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				cerebras: {},
				deepinfra: mockModels,
				deepseek: {},
				openrouter: mockModels,
				gemini: mockModels, // kilocode_change
				requesty: mockModels,
				glama: mockModels, // kilocode_change
				groq: {},
				synthetic: mockModels, // kilocode_change
				unbound: mockModels,
				roo: mockModels,
				chutes: mockModels,
				litellm: {},
				kilocode: mockModels,
				mistral: {},
				"nano-gpt": mockModels, // kilocode_change
				ollama: mockModels, // kilocode_change
				lmstudio: {},
				"vercel-ai-gateway": mockModels,
				huggingface: {},
				"io-intelligence": {},
				ovhcloud: mockModels, // kilocode_change
				inception: mockModels, // kilocode_change
				"sap-ai-core": {}, // kilocode_change
			},
			values: undefined,
		})
	})

	it("handles individual provider failures gracefully", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
		}

		// Mock some providers to succeed and others to fail
		mockGetModels
			.mockResolvedValueOnce(mockModels) // openrouter
			.mockResolvedValueOnce(mockModels) // kilocode_change: gemini
			.mockRejectedValueOnce(new Error("Requesty API error")) // requesty
			.mockResolvedValueOnce(mockModels) // kilocode_change: glama
			.mockRejectedValueOnce(new Error("Unbound API error")) // unbound
			.mockResolvedValueOnce(mockModels) // kilocode-openrouter
			.mockRejectedValueOnce(new Error("Ollama API error")) // kilocode_change
			.mockResolvedValueOnce(mockModels) // vercel-ai-gateway
			.mockResolvedValueOnce(mockModels) // deepinfra
			.mockResolvedValueOnce(mockModels) // nano-gpt // kilocode_change
			.mockResolvedValueOnce(mockModels) // kilocode_change ovhcloud
			.mockRejectedValueOnce(new Error("Inception API error")) // kilocode_change
			.mockRejectedValueOnce(new Error("Synthetic API error")) // kilocode_change
			.mockResolvedValueOnce(mockModels) // roo
			.mockRejectedValueOnce(new Error("Chutes API error")) // chutes
			.mockRejectedValueOnce(new Error("LiteLLM connection failed")) // litellm

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
		})

		// Verify error messages were sent for failed providers (these come first)
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Requesty API error",
			values: { provider: "requesty" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Unbound API error",
			values: { provider: "unbound" },
		})

		// kilocode_change start
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Inception API error",
			values: { provider: "inception" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Synthetic API error",
			values: { provider: "synthetic" },
		})
		// kilocode_change end

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Chutes API error",
			values: { provider: "chutes" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "LiteLLM connection failed",
			values: { provider: "litellm" },
		})

		// Verify final routerModels response includes successful providers and empty objects for failed ones
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				cerebras: {},
				deepinfra: mockModels,
				deepseek: {},
				openrouter: mockModels,
				requesty: {},
				glama: mockModels, // kilocode_change
				groq: {},
				unbound: {},
				roo: mockModels,
				chutes: {},
				litellm: {},
				ollama: {},
				lmstudio: {},
				mistral: {},
				"vercel-ai-gateway": mockModels,
				huggingface: {},
				"io-intelligence": {},
				// kilocode_change start
				kilocode: mockModels,
				"nano-gpt": mockModels,
				inception: {},
				synthetic: {},
				gemini: mockModels,
				ovhcloud: mockModels,
				"sap-ai-core": {},
				// kilocode_change end
			},
			values: undefined,
		})
	})

	it("handles Error objects and string errors correctly", async () => {
		// Mock providers to fail with different error types
		mockGetModels
			.mockRejectedValueOnce(new Error("Structured error message")) // openrouter
			.mockRejectedValueOnce(new Error("Gemini API error")) // // kilocode_change: gemini
			.mockRejectedValueOnce(new Error("Requesty API error")) // requesty
			.mockRejectedValueOnce(new Error("Glama API error")) // kilocode_change: glama
			.mockRejectedValueOnce(new Error("Unbound API error")) // unbound
			.mockResolvedValueOnce({}) // kilocode-openrouter - Success
			.mockRejectedValueOnce(new Error("Ollama API error")) // ollama
			.mockRejectedValueOnce(new Error("Vercel AI Gateway error")) // vercel-ai-gateway
			.mockRejectedValueOnce(new Error("DeepInfra API error")) // deepinfra
			.mockRejectedValueOnce(new Error("Nano-GPT API error")) // nano-gpt // kilocode_change
			.mockRejectedValueOnce(new Error("OVHcloud AI Endpoints error")) // ovhcloud // kilocode_change
			.mockRejectedValueOnce(new Error("Inception API error")) // kilocode_change inception
			.mockRejectedValueOnce(new Error("Synthetic API error")) // kilocode_change synthetic
			.mockRejectedValueOnce(new Error("Roo API error")) // roo
			.mockRejectedValueOnce(new Error("Chutes API error")) // chutes
			.mockRejectedValueOnce(new Error("LiteLLM connection failed")) // litellm

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
		})

		// Verify error handling for different error types
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Structured error message",
			values: { provider: "openrouter" },
		})

		// kilocode_change start
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Gemini API error",
			values: { provider: "gemini" },
		})
		// kilocode_change end

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Requesty API error",
			values: { provider: "requesty" },
		})

		// kilocode_change start
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Glama API error",
			values: { provider: "glama" },
		})
		// kilocode_change end

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Unbound API error",
			values: { provider: "unbound" },
		})

		// kilocode_change start
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Ollama API error",
			values: { provider: "ollama" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Vercel AI Gateway error",
			values: { provider: "vercel-ai-gateway" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Chutes API error",
			values: { provider: "chutes" },
		})
		// kilocode_change end

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "DeepInfra API error",
			values: { provider: "deepinfra" },
		})

		// kilocode_change start
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Nano-GPT API error",
			values: { provider: "nano-gpt" },
		})
		// kilocode_change end

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Vercel AI Gateway error",
			values: { provider: "vercel-ai-gateway" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Roo API error",
			values: { provider: "roo" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Chutes API error",
			values: { provider: "chutes" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "LiteLLM connection failed",
			values: { provider: "litellm" },
		})

		// kilocode_change start
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "OVHcloud AI Endpoints error",
			values: { provider: "ovhcloud" },
		})
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Inception API error",
			values: { provider: "inception" },
		})
		// kilocode_change end
	})

	it("prefers config values over message values for LiteLLM", async () => {
		const mockModels: ModelRecord = {}
		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
			values: {
				litellmApiKey: "message-key",
				litellmBaseUrl: "http://message-url",
			},
		})

		// Verify config values are used over message values
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "litellm-key", // From config
			baseUrl: "http://localhost:4000", // From config
		})
	})
})

describe("webviewMessageHandler - requestOpenAiCodexRateLimits", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetAccessToken.mockResolvedValue(null)
		mockGetAccountId.mockResolvedValue(null)
	})

	it("posts error when not authenticated", async () => {
		await webviewMessageHandler(mockClineProvider, { type: "requestOpenAiCodexRateLimits" } as any)

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "openAiCodexRateLimits",
			error: "Not authenticated with OpenAI Codex",
		})
	})

	it("posts values when authenticated", async () => {
		mockGetAccessToken.mockResolvedValue("token")
		mockGetAccountId.mockResolvedValue("acct_123")
		mockFetchOpenAiCodexRateLimitInfo.mockResolvedValue({
			primary: { usedPercent: 10, resetsAt: 1700000000000 },
			fetchedAt: 1700000000000,
		})

		await webviewMessageHandler(mockClineProvider, { type: "requestOpenAiCodexRateLimits" } as any)

		expect(mockFetchOpenAiCodexRateLimitInfo).toHaveBeenCalledWith("token", { accountId: "acct_123" })
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "openAiCodexRateLimits",
			values: {
				primary: { usedPercent: 10, resetsAt: 1700000000000 },
				fetchedAt: 1700000000000,
			},
		})
	})
})

describe("webviewMessageHandler - deleteCustomMode", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getWorkspacePath).mockReturnValue("/mock/workspace")
		vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined)
		vi.mocked(ensureSettingsDirectoryExists).mockResolvedValue("/mock/global/storage/.kilocode")
	})

	it("should delete a project mode and its rules folder", async () => {
		const slug = "test-project-mode"
		const rulesFolderPath = path.join("/mock/workspace", ".kilocode", `rules-${slug}`)

		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Project Mode",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "project",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		// The confirmation dialog is now handled in the webview, so we don't expect showInformationMessage to be called
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).toHaveBeenCalledWith(rulesFolderPath, { recursive: true, force: true })
	})

	it("should delete a global mode and its rules folder", async () => {
		const slug = "test-global-mode"
		const homeDir = os.homedir()
		const rulesFolderPath = path.join(homeDir, ".kilocode", `rules-${slug}`)

		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Global Mode",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "global",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		// The confirmation dialog is now handled in the webview, so we don't expect showInformationMessage to be called
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).toHaveBeenCalledWith(rulesFolderPath, { recursive: true, force: true })
	})

	it("should only delete the mode when rules folder does not exist", async () => {
		const slug = "test-mode-no-rules"
		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Mode No Rules",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "project",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(false)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		// The confirmation dialog is now handled in the webview, so we don't expect showInformationMessage to be called
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).not.toHaveBeenCalled()
	})

	it("should handle errors when deleting rules folder", async () => {
		const slug = "test-mode-error"
		const rulesFolderPath = path.join("/mock/workspace", ".kilocode", `rules-${slug}`)
		const error = new Error("Permission denied")

		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Mode Error",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "project",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)
		vi.mocked(fs.rm).mockRejectedValue(error)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).toHaveBeenCalledWith(rulesFolderPath, { recursive: true, force: true })
		// Verify error message is shown to the user
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			t("common:errors.delete_rules_folder_failed", {
				rulesFolderPath,
				error: error.message,
			}),
		)
		// No error response is sent anymore - we just continue with deletion
		expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - message dialog preferences", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Mock a current Cline instance
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			taskId: "test-task-id",
			apiConversationHistory: [],
			clineMessages: [],
		} as any)
		// Reset getValue mock
		vi.mocked(mockClineProvider.contextProxy.getValue).mockReturnValue(false)
	})

	describe("deleteMessage", () => {
		it("should always show dialog for delete confirmation", async () => {
			vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
				clineMessages: [],
				apiConversationHistory: [],
			} as any) // Mock current cline with proper structure

			await webviewMessageHandler(mockClineProvider, {
				type: "deleteMessage",
				value: 123456789, // Changed from messageTs to value
			})

			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "showDeleteMessageDialog",
				messageTs: 123456789,
				hasCheckpoint: false,
			})
		})
	})

	describe("submitEditedMessage", () => {
		it("replaces the original user branch instead of appending a new turn", async () => {
			const rewindToTimestamp = vi.fn().mockResolvedValue(undefined)
			const overwriteClineMessages = vi.fn().mockResolvedValue(undefined)
			const overwriteApiConversationHistory = vi.fn().mockResolvedValue(undefined)
			const cancelTask = vi.fn().mockResolvedValue(undefined)
			const clineMessages = [
				{ type: "say", say: "user_feedback", ts: 111, text: "previous context" },
				{ type: "say", say: "user_feedback", ts: 123456789, text: "old content" },
				{ type: "say", say: "text", ts: 123456790, text: "later response" },
			]
			const apiConversationHistory = [
				{ role: "user", ts: 111, content: [{ type: "text", text: "previous context" }] },
				{ role: "user", ts: 123456789, content: [{ type: "text", text: "old content" }] },
				{ role: "assistant", ts: 123456790, content: [{ type: "text", text: "later response" }] },
			]
			;(mockClineProvider as any).cancelTask = cancelTask

			vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
				taskId: "test-task-id",
				clineMessages,
				apiConversationHistory,
				messageQueueService: { clear: vi.fn() },
				clearStaleWebviewAskResponse: vi.fn(),
				overwriteClineMessages,
				overwriteApiConversationHistory,
				messageManager: { rewindToTimestamp },
			} as any)

			await webviewMessageHandler(mockClineProvider, {
				type: "submitEditedMessage",
				value: 123456789,
				editedMessageContent: "edited content",
			})

			expect(rewindToTimestamp).toHaveBeenCalledWith(123456789, {
				includeTargetMessage: false,
			})
			expect(overwriteClineMessages).not.toHaveBeenCalled()
			expect(overwriteApiConversationHistory).not.toHaveBeenCalled()
			expect(mockClineProvider.setPendingCancelledTaskContinuation).toHaveBeenCalledWith(
				"edited content",
				undefined,
				expect.objectContaining({ kind: "edited_resend" }),
			)
			expect(cancelTask).toHaveBeenCalledTimes(1)
		})

		it("rewinds repeated user text by UI timestamp and preserves the earlier branch", async () => {
			const rewindToTimestamp = vi.fn().mockResolvedValue(undefined)
			const cancelTask = vi.fn().mockResolvedValue(undefined)
			const clineMessages = [
				{ type: "say", say: "user_feedback", ts: 111, text: "preserved reasoning context" },
				{ type: "say", say: "user_feedback", ts: 222, text: "repeated prompt" },
			]
			const apiConversationHistory = [
				{ role: "user", ts: 111, content: [{ type: "text", text: "preserved reasoning context" }] },
				{ role: "user", ts: 200, content: [{ type: "text", text: "repeated prompt" }] },
				{ role: "assistant", ts: 210, content: [{ type: "text", text: "first branch reasoning" }] },
				{ role: "user", ts: 222, content: [{ type: "text", text: "repeated prompt" }] },
			]
			;(mockClineProvider as any).cancelTask = cancelTask
			vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
				taskId: "test-task-id",
				clineMessages,
				apiConversationHistory,
				messageQueueService: { clear: vi.fn() },
				clearStaleWebviewAskResponse: vi.fn(),
				messageManager: { rewindToTimestamp },
			} as any)

			await webviewMessageHandler(mockClineProvider, {
				type: "submitEditedMessage",
				value: 222,
				editedMessageContent: "small correction",
			})

			expect(rewindToTimestamp).toHaveBeenCalledWith(222, {
				includeTargetMessage: false,
			})
			expect(mockClineProvider.setPendingCancelledTaskContinuation).toHaveBeenCalledWith(
				"small correction",
				undefined,
				expect.objectContaining({ kind: "edited_resend" }),
			)
			expect(cancelTask).toHaveBeenCalledTimes(1)
		})
	})
})

describe("webviewMessageHandler - mcpEnabled", () => {
	let mockMcpHub: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Create a mock McpHub instance
		mockMcpHub = {
			handleMcpEnabledChange: vi.fn().mockResolvedValue(undefined),
		}

		// Ensure provider exposes getMcpHub and returns our mock
		;(mockClineProvider as any).getMcpHub = vi.fn().mockReturnValue(mockMcpHub)
	})

	it("delegates enable=true to McpHub and posts updated state", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { mcpEnabled: true },
		})

		expect((mockClineProvider as any).getMcpHub).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledWith(true)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalledTimes(1)
	})

	it("delegates enable=false to McpHub and posts updated state", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { mcpEnabled: false },
		})

		expect((mockClineProvider as any).getMcpHub).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledWith(false)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalledTimes(1)
	})

	it("handles missing McpHub instance gracefully and still posts state", async () => {
		;(mockClineProvider as any).getMcpHub = vi.fn().mockReturnValue(undefined)

		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { mcpEnabled: true },
		})

		expect((mockClineProvider as any).getMcpHub).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalledTimes(1)
	})
})

describe("webviewMessageHandler - downloadErrorDiagnostics", () => {
	beforeEach(() => {
		vi.clearAllMocks()

		// Ensure contextProxy has a globalStorageUri for the handler
		;(mockClineProvider as any).contextProxy.globalStorageUri = { fsPath: "/mock/global/storage" }

		// Provide a current task with a stable ID
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			taskId: "test-task-id",
		} as any)
	})

	it("calls generateErrorDiagnostics with correct parameters", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "downloadErrorDiagnostics",
			values: {
				timestamp: "2025-01-01T00:00:00.000Z",
				version: "1.2.3",
				provider: "test-provider",
				model: "test-model",
				details: "Sample error details",
			},
		} as any)

		// Verify generateErrorDiagnostics was called with the correct parameters
		expect(generateErrorDiagnostics).toHaveBeenCalledTimes(1)
		expect(generateErrorDiagnostics).toHaveBeenCalledWith({
			taskId: "test-task-id",
			globalStoragePath: "/mock/global/storage",
			values: {
				timestamp: "2025-01-01T00:00:00.000Z",
				version: "1.2.3",
				provider: "test-provider",
				model: "test-model",
				details: "Sample error details",
			},
			log: expect.any(Function),
		})
	})

	it("shows error when no active task", async () => {
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue(null as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "downloadErrorDiagnostics",
			values: {},
		} as any)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("No active task to generate diagnostics for")
		expect(generateErrorDiagnostics).not.toHaveBeenCalled()
	})
})
