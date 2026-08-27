import type { Mock } from "vitest"
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock dependencies first
vi.mock("vscode", () => ({
	window: {
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn(() => ({
			dispose: vi.fn(),
		})),
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn(),
			update: vi.fn(),
		}),
	},
	Uri: {
		file: vi.fn((path) => ({ fsPath: path })),
	},
	env: {
		uriScheme: "vscode",
	},
}))

vi.mock("../../task-persistence", () => ({
	saveTaskMessages: vi.fn(),
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn(),
	flushModels: vi.fn(),
	getModelsFromCache: vi.fn().mockReturnValue(undefined),
}))

vi.mock("../checkpointRestoreHandler", () => ({
	handleCheckpointRestoreOperation: vi.fn(),
}))

// Import after mocks
import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"
import type { ClineMessage } from "@roo-code/types"
import type { ApiMessage } from "../../task-persistence/apiMessages"
import { MessageManager } from "../../message-manager"

describe("webviewMessageHandler - Edit Message with Timestamp Fallback", () => {
	let mockClineProvider: ClineProvider
	let mockCurrentTask: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Create a mock task with messages
		mockCurrentTask = {
			taskId: "test-task-id",
			clineMessages: [] as ClineMessage[],
			apiConversationHistory: [] as ApiMessage[],
			overwriteClineMessages: vi.fn(),
			overwriteApiConversationHistory: vi.fn(),
			handleWebviewAskResponse: vi.fn(),
			clearStaleWebviewAskResponse: vi.fn(),
			messageQueueService: { clear: vi.fn() },
		}
		mockCurrentTask.messageManager = new MessageManager(mockCurrentTask)

		// Create mock provider
		mockClineProvider = {
			getCurrentTask: vi.fn().mockReturnValue(mockCurrentTask),
			setPendingCancelledTaskContinuation: vi.fn(),
			cancelTask: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview: vi.fn(),
			contextProxy: {
				getValue: vi.fn(),
				setValue: vi.fn(),
				globalStorageUri: { fsPath: "/mock/storage" },
			},
			log: vi.fn(),
			postStateToWebview: vi.fn(),
			getState: vi.fn().mockResolvedValue({
				maxImageFileSize: 5,
				maxTotalImageSize: 20,
			}),
		} as unknown as ClineProvider
	})

	it("should not modify API history when apiConversationHistoryIndex is -1", async () => {
		// Setup: User message followed by attempt_completion
		const userMessageTs = 1000
		const assistantMessageTs = 2000
		const completionMessageTs = 3000

		// UI messages (clineMessages)
		mockCurrentTask.clineMessages = [
			{
				ts: userMessageTs,
				type: "say",
				say: "user_feedback",
				text: "Hello",
			} as ClineMessage,
			{
				ts: completionMessageTs,
				type: "say",
				say: "completion_result",
				text: "Task Completed!",
			} as ClineMessage,
		]

		// API conversation history - note the user message is missing (common scenario after condense)
		mockCurrentTask.apiConversationHistory = [
			{
				ts: assistantMessageTs,
				role: "assistant",
				content: [
					{
						type: "text",
						text: "I'll help you with that.",
					},
				],
			},
			{
				ts: completionMessageTs,
				role: "assistant",
				content: [
					{
						type: "tool_use",
						name: "attempt_completion",
						id: "tool-1",
						input: {
							result: "Task Completed!",
						},
					},
				],
			},
		] as ApiMessage[]

		// Trigger edit confirmation
		await webviewMessageHandler(mockClineProvider, {
			type: "editMessageConfirm",
			messageTs: userMessageTs,
			text: "Hello World", // edited content
			restoreCheckpoint: false,
		})

		// Verify that UI messages were truncated at the correct index
		expect(mockCurrentTask.overwriteClineMessages).toHaveBeenCalledWith(
			[], // All messages before index 0 (empty array)
			{ force: true },
		)

		// Strict branch replacement must force-persist the clean API boundary.
		expect(mockCurrentTask.overwriteApiConversationHistory).toHaveBeenCalledWith([], { force: true })
	})

	it("should discard API history when the edited message is not provable in API history", async () => {
		const earlierMessageTs = 500
		const userMessageTs = 1000
		const assistantMessageTs = 2000

		// UI messages
		mockCurrentTask.clineMessages = [
			{
				ts: earlierMessageTs,
				type: "say",
				say: "user_feedback",
				text: "Earlier message",
			} as ClineMessage,
			{
				ts: userMessageTs,
				type: "say",
				say: "user_feedback",
				text: "Hello",
			} as ClineMessage,
			{
				ts: assistantMessageTs,
				type: "say",
				say: "text",
				text: "Response",
			} as ClineMessage,
		]

		// API history - missing the exact user message at ts=1000
		mockCurrentTask.apiConversationHistory = [
			{
				ts: earlierMessageTs,
				role: "user",
				content: [{ type: "text", text: "Earlier message" }],
			},
			{
				ts: assistantMessageTs,
				role: "assistant",
				content: [{ type: "text", text: "Response" }],
			},
		] as ApiMessage[]

		await webviewMessageHandler(mockClineProvider, {
			type: "editMessageConfirm",
			messageTs: userMessageTs,
			text: "Hello World",
			restoreCheckpoint: false,
		})

		// Verify UI messages were truncated to preserve earlier message
		expect(mockCurrentTask.overwriteClineMessages).toHaveBeenCalledWith(
			[
				{
					ts: earlierMessageTs,
					type: "say",
					say: "user_feedback",
					text: "Earlier message",
				},
			],
			{ force: true },
		)

		expect(mockCurrentTask.overwriteApiConversationHistory).toHaveBeenCalledWith(
			[mockCurrentTask.apiConversationHistory[0]],
			{ force: true },
		)
	})

	it("should not use fallback when exact apiConversationHistoryIndex is found", async () => {
		const userMessageTs = 1000
		const assistantMessageTs = 2000

		// Both UI and API have the message at the same timestamp
		mockCurrentTask.clineMessages = [
			{
				ts: userMessageTs,
				type: "say",
				say: "user_feedback",
				text: "Hello",
			} as ClineMessage,
			{
				ts: assistantMessageTs,
				type: "say",
				say: "text",
				text: "Response",
			} as ClineMessage,
		]

		mockCurrentTask.apiConversationHistory = [
			{
				ts: userMessageTs,
				role: "user",
				content: [{ type: "text", text: "Hello" }],
			},
			{
				ts: assistantMessageTs,
				role: "assistant",
				content: [{ type: "text", text: "Response" }],
			},
		] as ApiMessage[]

		await webviewMessageHandler(mockClineProvider, {
			type: "editMessageConfirm",
			messageTs: userMessageTs,
			text: "Hello World",
			restoreCheckpoint: false,
		})

		// Both should be truncated at index 0
		expect(mockCurrentTask.overwriteClineMessages).toHaveBeenCalledWith([], { force: true })
		expect(mockCurrentTask.overwriteApiConversationHistory).toHaveBeenCalledWith([], { force: true })
	})

	it("should handle case where no API messages match timestamp criteria", async () => {
		const userMessageTs = 3000

		mockCurrentTask.clineMessages = [
			{
				ts: userMessageTs,
				type: "say",
				say: "user_feedback",
				text: "Hello",
			} as ClineMessage,
		]

		// All API messages have timestamps before the edited message
		mockCurrentTask.apiConversationHistory = [
			{
				ts: 1000,
				role: "assistant",
				content: [{ type: "text", text: "Old message 1" }],
			},
			{
				ts: 2000,
				role: "assistant",
				content: [{ type: "text", text: "Old message 2" }],
			},
		] as ApiMessage[]

		await webviewMessageHandler(mockClineProvider, {
			type: "editMessageConfirm",
			messageTs: userMessageTs,
			text: "Hello World",
			restoreCheckpoint: false,
		})

		expect(mockCurrentTask.overwriteClineMessages).toHaveBeenCalledWith([], { force: true })
		expect(mockCurrentTask.overwriteApiConversationHistory).toHaveBeenCalledWith(
			mockCurrentTask.apiConversationHistory,
			{ force: true },
		)
	})

	it("should handle empty API conversation history gracefully", async () => {
		const userMessageTs = 1000

		mockCurrentTask.clineMessages = [
			{
				ts: userMessageTs,
				type: "say",
				say: "user_feedback",
				text: "Hello",
			} as ClineMessage,
		]

		mockCurrentTask.apiConversationHistory = []

		await webviewMessageHandler(mockClineProvider, {
			type: "editMessageConfirm",
			messageTs: userMessageTs,
			text: "Hello World",
			restoreCheckpoint: false,
		})

		// Strict branch replacement force-persists empty UI and API histories.
		expect(mockCurrentTask.overwriteClineMessages).toHaveBeenCalledWith([], { force: true })
		expect(mockCurrentTask.overwriteApiConversationHistory).toHaveBeenCalledWith([], { force: true })
	})

	it("should discard a condensed branch when the edited user turn is hidden by its summary", async () => {
		const editedMessageTs = 2000
		const condenseId = "discarded-branch-summary"
		const initialMessage = {
			ts: 1000,
			type: "say",
			say: "user_feedback",
			text: "Keep this earlier instruction",
		} as ClineMessage
		const editedMessage = {
			ts: editedMessageTs,
			type: "say",
			say: "user_feedback",
			text: "Replace this instruction",
		} as ClineMessage

		mockCurrentTask.clineMessages = [
			initialMessage,
			editedMessage,
			{
				ts: 3000,
				type: "say",
				say: "text",
				text: "Later response from discarded branch",
			} as ClineMessage,
		]
		mockCurrentTask.apiConversationHistory = [
			{
				ts: 1000,
				role: "user",
				content: [{ type: "text", text: "Keep this earlier instruction" }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Summary includes later discarded reasoning" }],
				isSummary: true,
				condenseId,
				ts: 1999,
			},
			{
				ts: editedMessageTs,
				role: "user",
				content: [{ type: "text", text: "Replace this instruction" }],
				condenseParent: condenseId,
			},
			{
				ts: 3000,
				role: "assistant",
				content: [{ type: "text", text: "Later response from discarded branch" }],
			},
		] as ApiMessage[]

		await webviewMessageHandler(mockClineProvider, {
			type: "editMessageConfirm",
			messageTs: editedMessageTs,
			text: "Replace this instruction with the new branch",
			restoreCheckpoint: false,
		})

		expect(mockCurrentTask.overwriteApiConversationHistory).toHaveBeenCalledWith(
			[mockCurrentTask.apiConversationHistory[0]],
			{ force: true },
		)
	})

	it("should correctly handle attempt_completion in API history", async () => {
		const userMessageTs = 1000
		const completionTs = 2000
		const feedbackTs = 3000

		mockCurrentTask.clineMessages = [
			{
				ts: userMessageTs,
				type: "say",
				say: "user_feedback",
				text: "Do something",
			} as ClineMessage,
			{
				ts: completionTs,
				type: "say",
				say: "completion_result",
				text: "Task Completed!",
			} as ClineMessage,
			{
				ts: feedbackTs,
				type: "say",
				say: "user_feedback",
				text: "Thanks",
			} as ClineMessage,
		]

		// API history with attempt_completion tool use (user message missing)
		mockCurrentTask.apiConversationHistory = [
			{
				ts: completionTs,
				role: "assistant",
				content: [
					{
						type: "tool_use",
						name: "attempt_completion",
						id: "tool-1",
						input: {
							result: "Task Completed!",
						},
					},
				],
			},
			{
				ts: feedbackTs,
				role: "user",
				content: [
					{
						type: "text",
						text: "Thanks",
					},
				],
			},
		] as ApiMessage[]

		// Edit the first user message
		await webviewMessageHandler(mockClineProvider, {
			type: "editMessageConfirm",
			messageTs: userMessageTs,
			text: "Do something else",
			restoreCheckpoint: false,
		})

		// UI messages truncated at edited message
		expect(mockCurrentTask.overwriteClineMessages).toHaveBeenCalledWith([], { force: true })

		// Strict branch replacement force-persists the clean API boundary.
		expect(mockCurrentTask.overwriteApiConversationHistory).toHaveBeenCalledWith([], { force: true })
	})

	it("edits an assistant response in place, drops later turns, and inserts an editable 继续 row", async () => {
		const assistantTs = 2000
		mockCurrentTask.clineMessages = [
			{ ts: 1000, type: "say", say: "user_feedback", text: "Initial request" },
			{ ts: assistantTs, type: "say", say: "text", text: "Assistant response" },
			{ ts: 3000, type: "say", say: "text", text: "Discarded later response" },
		] as ClineMessage[]
		mockCurrentTask.apiConversationHistory = [
			{ ts: 1000, role: "user", content: [{ type: "text", text: "Initial request" }] },
			{ ts: assistantTs, role: "assistant", content: [{ type: "text", text: "Assistant response" }] },
			{ ts: 3000, role: "assistant", content: [{ type: "text", text: "Discarded later response" }] },
		] as ApiMessage[]
		mockCurrentTask.freezeHistoryPersistenceForBranchReplacement = vi.fn()

		await webviewMessageHandler(mockClineProvider, {
			type: "submitEditedAssistantMessage",
			value: assistantTs,
			editedMessageContent: "Edited assistant",
		})

		expect(mockCurrentTask.overwriteClineMessages).toHaveBeenCalledWith(
			[
				{ ts: 1000, type: "say", say: "user_feedback", text: "Initial request" },
				{ ts: assistantTs, type: "say", say: "text", text: "Edited assistant" },
				expect.objectContaining({
					type: "say",
					say: "user_feedback",
					text: "继续",
					editPrompt: true,
				}),
			],
			{ force: true },
		)
		expect(mockCurrentTask.overwriteApiConversationHistory).toHaveBeenCalledWith(
			[
				mockCurrentTask.apiConversationHistory[0],
				expect.objectContaining({
					role: "assistant",
					content: [{ type: "text", text: "Edited assistant" }],
				}),
			],
			{ force: true },
		)
		expect(mockCurrentTask.freezeHistoryPersistenceForBranchReplacement).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.setPendingCancelledTaskContinuation).not.toHaveBeenCalled()
		expect(mockClineProvider.cancelTask).not.toHaveBeenCalled()
	})
})
