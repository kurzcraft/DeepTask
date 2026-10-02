// npx vitest core/webview/__tests__/webviewMessageHandler.parallel.spec.ts

import type { ParallelWorkspace } from "@roo-code/types"

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"

vi.mock("../../mentions/resolveImageMentions", () => ({
	resolveImageMentions: vi.fn(async ({ text, images }: { text: string; images?: string[] }) => ({ text, images })),
}))

vi.mock("vscode", () => ({
	window: {
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/repo" } }],
	},
}))

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => {
		if (key === "common:answers.yes") {
			return "Yes"
		}
		if (key === "common:answers.delete_directly") {
			return "直接删除"
		}
		if (key === "common:confirmation.delete_workspace") {
			return "Delete workspace?"
		}
		return key
	}),
}))

import * as vscode from "vscode"

const makeWorkspace = (): ParallelWorkspace => ({
	name: "feature",
	path: "/repo/.kilocode/worktrees/feature",
	branch: "deeptask/feature",
	baseBranch: "main",
	status: "available",
	folderPath: "/repo",
	createdAt: 1,
	updatedAt: 1,
})

describe("webviewMessageHandler - parallel.deleteWorkspace", () => {
	const deleteWorkspace = vi.fn().mockResolvedValue(undefined)
	const moveConversationsToWorkspace = vi.fn().mockResolvedValue(undefined)
	const deleteConversationsInWorkspace = vi.fn().mockResolvedValue([
		{
			id: "cv-1",
			folderPath: "/repo",
			workspacePath: "/repo/.kilocode/worktrees/feature",
			sessionId: "task-1",
			createdAt: 1,
			lastActiveAt: 1,
		},
	])
	const abortAndRemoveTask = vi.fn().mockResolvedValue(undefined)
	const deleteTaskWithId = vi.fn().mockResolvedValue(undefined)
	const broadcast = vi.fn().mockResolvedValue(undefined)
	const switchWorkspace = vi.fn().mockResolvedValue(undefined)

	const provider = {
		parallelManager: {
			getFolders: vi.fn().mockResolvedValue([]),
			folderPathForWorkspace: vi.fn().mockReturnValue("/repo"),
			folderPathForPath: vi.fn().mockReturnValue("/repo"),
			moveConversationsToWorkspace,
			deleteConversationsInWorkspace,
			broadcast,
		},
		workspaceRegistry: {
			get: vi.fn().mockResolvedValue(makeWorkspace()),
		},
		getWorkspaceService: vi.fn().mockReturnValue({ deleteWorkspace }),
		abortAndRemoveTask,
		deleteTaskWithId,
		getCurrentTask: vi.fn().mockReturnValue({ cwd: "/repo/.kilocode/worktrees/feature", switchWorkspace }),
		postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		pendingNewConversation: undefined as { id: string; folderPath: string; workspacePath?: string } | undefined,
	} as unknown as ClineProvider

	beforeEach(() => {
		vi.clearAllMocks()
		provider.pendingNewConversation = undefined
		vi.mocked(provider.workspaceRegistry.get).mockResolvedValue(makeWorkspace())
		vi.mocked(provider.getWorkspaceService).mockReturnValue({ deleteWorkspace } as never)
	})

	test("Yes force-deletes the worktree and moves conversations to main", async () => {
		vi.mocked(vscode.window.showWarningMessage).mockResolvedValue("Yes" as never)

		await webviewMessageHandler(provider, { type: "parallel.deleteWorkspace", text: "feature" })

		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
			"Delete workspace?",
			{ modal: true },
			"Yes",
			"直接删除",
		)
		expect(deleteWorkspace).toHaveBeenCalledWith("feature")
		expect(moveConversationsToWorkspace).toHaveBeenCalledWith("/repo/.kilocode/worktrees/feature", "/repo")
		expect(deleteConversationsInWorkspace).not.toHaveBeenCalled()
		expect(switchWorkspace).toHaveBeenCalledWith("/repo")
		expect(broadcast).toHaveBeenCalled()
	})

	test("直接删除 force-deletes the worktree and deletes its conversations", async () => {
		vi.mocked(vscode.window.showWarningMessage).mockResolvedValue("直接删除" as never)

		await webviewMessageHandler(provider, { type: "parallel.deleteWorkspace", text: "feature" })

		expect(deleteWorkspace).toHaveBeenCalledWith("feature")
		expect(deleteConversationsInWorkspace).toHaveBeenCalledWith("/repo/.kilocode/worktrees/feature")
		expect(moveConversationsToWorkspace).not.toHaveBeenCalled()
		expect(abortAndRemoveTask).toHaveBeenCalledWith("task-1")
		expect(deleteTaskWithId).toHaveBeenCalledWith("task-1")
		expect(switchWorkspace).not.toHaveBeenCalled()
		expect(broadcast).toHaveBeenCalled()
	})

	test("switching workspace re-parents the bound conversation of the running task", async () => {
		const syncSessionWorkspace = vi.fn().mockResolvedValue(undefined)
		const conversationForSession = vi.fn().mockReturnValue({ id: "cv-1", sessionId: "task-1" })
		vi.mocked(provider.parallelManager).syncSessionWorkspace = syncSessionWorkspace
		vi.mocked(provider.parallelManager).conversationForSession = conversationForSession
		vi.mocked(provider.getCurrentTask).mockReturnValue({
			cwd: "/repo/.kilocode/worktrees/feature",
			taskId: "task-1",
			switchWorkspace,
		} as never)

		await webviewMessageHandler(provider, { type: "parallel.switchWorkspace", text: "/repo" })

		expect(switchWorkspace).toHaveBeenCalledWith("/repo")
		expect(syncSessionWorkspace).toHaveBeenCalledWith("task-1", "/repo")
		expect(provider.pendingNewConversation).toBeUndefined()
	})

	test("dismissing the confirm dialog does not delete", async () => {
		vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined as never)

		await webviewMessageHandler(provider, { type: "parallel.deleteWorkspace", text: "feature" })

		expect(deleteWorkspace).not.toHaveBeenCalled()
		expect(broadcast).not.toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - pending new conversation", () => {
	test("keeps pendingNewConversation until the new task is stacked", async () => {
		const pending = { id: "cv-new", folderPath: "/repo", workspacePath: "/repo" }
		let pendingDuringCreate: typeof pending | undefined
		const createTask = vi.fn().mockImplementation(async () => {
			pendingDuringCreate = { ...(provider.pendingNewConversation as typeof pending) }
			return { taskId: "task-new" }
		})
		const bindConversation = vi.fn().mockResolvedValue(undefined)
		const setActiveConversation = vi.fn().mockResolvedValue(undefined)
		const broadcast = vi.fn().mockResolvedValue(undefined)
		const focusTask = vi.fn().mockResolvedValue(undefined)
		const ensureUnoccupiedWorkspace = vi.fn().mockResolvedValue({ path: "/repo/.kilocode/worktrees/isolated" })
		const provider = {
			pendingNewConversation: pending,
			getCurrentTask: vi.fn().mockReturnValue(undefined),
			getState: vi.fn().mockResolvedValue({}),
			cwd: "/repo",
			ensureUnoccupiedWorkspace,
			createTask,
			focusTask,
			getWorkspaceService: vi.fn().mockReturnValue({ claim: vi.fn() }),
			parallelManager: { bindConversation, setActiveConversation, broadcast },
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		} as unknown as ClineProvider

		await webviewMessageHandler(provider, { type: "newTask", text: "second conversation" })

		expect(pendingDuringCreate).toEqual(pending)
		expect(createTask).toHaveBeenCalledWith("second conversation", undefined, undefined, {
			keepRunningTask: true,
			workspacePath: "/repo/.kilocode/worktrees/isolated",
		})
		expect(provider.pendingNewConversation).toBeUndefined()
		expect(bindConversation).toHaveBeenCalledWith("cv-new", "task-new", "second conversation")
		expect(setActiveConversation).toHaveBeenCalledWith("cv-new")
		expect(focusTask).toHaveBeenCalledWith("task-new")
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({ type: "action", action: "chatButtonClicked" })
		expect(provider.postMessageToWebview).not.toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
	})
})

describe("webviewMessageHandler - select live subagent conversation", () => {
	test("focuses the running subagent in the main chat", async () => {
		const focusTask = vi.fn().mockResolvedValue(undefined)
		const setActiveConversation = vi.fn().mockResolvedValue(undefined)
		const broadcast = vi.fn().mockResolvedValue(undefined)
		const getConversation = vi.fn().mockResolvedValue({
			id: "cv-sa",
			folderPath: "/repo",
			workspacePath: "/repo/.kilocode/worktrees/sa",
			sessionId: "sa-1",
		})
		const provider = {
			pendingNewConversation: undefined,
			focusTask,
			getCurrentTask: vi.fn().mockReturnValue({ cwd: "/repo/.kilocode/worktrees/sa" }),
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
			parallelManager: {
				getConversation,
				setActiveConversation,
				broadcast,
				getSession: vi.fn().mockReturnValue({ sessionId: "sa-1", status: "running" }),
			},
		} as unknown as ClineProvider

		await webviewMessageHandler(provider, { type: "parallel.selectConversation", text: "cv-sa" })

		expect(setActiveConversation).toHaveBeenCalledWith("cv-sa")
		expect(focusTask).toHaveBeenCalledWith("sa-1")
		expect(broadcast).toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - askResponse focused-conversation rebuild", () => {
	test("rebuilds the focused stopped conversation before delivering a typed message", async () => {
		const focusTask = vi.fn().mockResolvedValue(undefined)
		const stoppedSubagentTask = {
			taskId: "task-stopped-sa",
			clineMessages: [],
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			getPendingWebviewAskTs: vi.fn().mockReturnValue(undefined),
			findMessageByTimestamp: vi.fn().mockReturnValue(undefined),
			isSoftCompletionBoundaryPending: vi.fn().mockReturnValue(false),
			clearStaleWebviewAskResponse: vi.fn(),
			messageQueueService: { clear: vi.fn(), queue: [] },
			continueTaskFromUserMessage: vi.fn().mockResolvedValue(undefined),
			handleWebviewAskResponse: vi.fn(),
			isStreaming: false,
			isTaskLoopActive: false,
		}
		// After focusTask rebuilds the focused conversation's task, the focused
		// lookup returns it and the message is delivered there (not the stack top).
		let focusedTask: unknown = undefined
		const backgroundParentTask = {
			taskId: "task-parent-bg",
			clineMessages: [],
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(false),
			getPendingWebviewAskTs: vi.fn().mockReturnValue(undefined),
			findMessageByTimestamp: vi.fn().mockReturnValue(undefined),
			isStreaming: true,
		}
		const provider = {
			pendingNewConversation: undefined,
			focusTask,
			getState: vi.fn().mockResolvedValue({}),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
			cancelTask: vi.fn().mockResolvedValue(undefined),
			setPendingCancelledTaskContinuation: vi.fn(),
			getFocusedChatTask: vi.fn(() => focusedTask as never),
			getCurrentTask: vi.fn(() => backgroundParentTask as never),
			// The focused conversation points at the stopped subagent's session.
			parallelManager: {
				focusedConversationId: "cv-stopped-sa",
				getConversationById: vi.fn().mockReturnValue({
					id: "cv-stopped-sa",
					sessionId: "task-stopped-sa",
					folderPath: "/repo",
					workspacePath: "/repo",
				}),
			},
		} as unknown as ClineProvider
		focusTask.mockImplementation(async () => {
			focusedTask = stoppedSubagentTask
		})

		await webviewMessageHandler(provider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "hello after stop",
		})

		expect(focusTask).toHaveBeenCalledWith("task-stopped-sa")
		// No ghost: the message must not create a brand-new top-level task.
		const createTask = vi.fn()
		;(provider as unknown as { createTask?: unknown }).createTask = createTask
		expect(createTask).not.toHaveBeenCalled()
	})

	test("does not rebuild when the focused conversation's task is already current", async () => {
		const focusTask = vi.fn().mockResolvedValue(undefined)
		const liveTask = {
			taskId: "task-focused",
			clineMessages: [],
			hasPendingWebviewAskResponse: vi.fn().mockReturnValue(true),
			getPendingWebviewAskTs: vi.fn().mockReturnValue(undefined),
			findMessageByTimestamp: vi.fn().mockReturnValue(undefined),
			isSoftCompletionBoundaryPending: vi.fn().mockReturnValue(false),
			clearStaleWebviewAskResponse: vi.fn(),
			messageQueueService: { clear: vi.fn(), queue: [] },
			continueTaskFromUserMessage: vi.fn().mockResolvedValue(undefined),
			handleWebviewAskResponse: vi.fn(),
			isStreaming: true,
		}
		const provider = {
			pendingNewConversation: undefined,
			focusTask,
			getState: vi.fn().mockResolvedValue({}),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
			cancelTask: vi.fn().mockResolvedValue(undefined),
			setPendingCancelledTaskContinuation: vi.fn(),
			getFocusedChatTask: vi.fn().mockReturnValue(liveTask as never),
			getCurrentTask: vi.fn().mockReturnValue(liveTask as never),
			parallelManager: {
				focusedConversationId: "cv-focused",
				getConversationById: vi.fn().mockReturnValue({
					id: "cv-focused",
					sessionId: "task-focused",
					folderPath: "/repo",
					workspacePath: "/repo",
				}),
			},
		} as unknown as ClineProvider

		await webviewMessageHandler(provider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "normal send",
		})

		expect(focusTask).not.toHaveBeenCalled()
	})
})
