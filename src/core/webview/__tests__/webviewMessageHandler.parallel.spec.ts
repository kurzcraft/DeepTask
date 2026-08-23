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
		const broadcast = vi.fn().mockResolvedValue(undefined)
		const ensureUnoccupiedWorkspace = vi.fn().mockResolvedValue({ path: "/repo/.kilocode/worktrees/isolated" })
		const provider = {
			pendingNewConversation: pending,
			getCurrentTask: vi.fn().mockReturnValue(undefined),
			getState: vi.fn().mockResolvedValue({}),
			cwd: "/repo",
			ensureUnoccupiedWorkspace,
			createTask,
			getWorkspaceService: vi.fn().mockReturnValue({ claim: vi.fn() }),
			parallelManager: { bindConversation, broadcast },
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
