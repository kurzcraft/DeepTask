// kilocode_change - new file
import { describe, it, expect, vi, beforeEach } from "vitest"
import { ClineProvider } from "../ClineProvider"

function makeProvider(overrides?: Record<string, unknown>) {
	const create = vi.fn().mockResolvedValue({
		name: "isolated",
		path: "/repo/.kilocode/worktrees/isolated",
	})
	const claim = vi.fn()
	const provider: any = {
		cwd: "/repo",
		pendingNewConversation: undefined,
		getState: vi.fn().mockResolvedValue({ agentWorkspaceManagementEnabled: true }),
		getWorkspaceService: vi.fn().mockReturnValue({ create, claim }),
		postMessageToWebview: vi.fn(),
		log: vi.fn(),
		parallelManager: {
			getFolders: vi.fn().mockResolvedValue([]),
			folderPathForPath: vi.fn().mockReturnValue("/repo"),
			occupantsOf: vi.fn().mockResolvedValue([]),
			updateConversationWorkspace: vi.fn(),
			broadcast: vi.fn(),
			getSession: vi.fn(),
			conversationForSession: vi.fn(),
			setActiveConversation: vi.fn(),
		},
		...overrides,
	}
	Object.setPrototypeOf(provider, ClineProvider.prototype)
	return { provider, create, claim }
}

describe("ClineProvider workspace routing", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does not relocate when occupancy excepts the assigned write subagent", async () => {
		const assigned = "/repo/.kilocode/worktrees/928-workspace-routing"
		const { provider, create } = makeProvider()
		provider.parallelManager.occupantsOf.mockResolvedValue([])
		const task = { taskId: "child-1", cwd: assigned, subagent: { sessionId: "child-1" } }

		const result = await provider.ensureUnoccupiedWorkspace({
			workspacePath: assigned,
			task,
		})

		expect(provider.parallelManager.occupantsOf).toHaveBeenCalledWith(assigned, {
			taskId: "child-1",
			conversationId: undefined,
		})
		expect(create).not.toHaveBeenCalled()
		expect(result.path).toBe(assigned)
	})

	it("still isolates a true second writer", async () => {
		const assigned = "/repo/.kilocode/worktrees/child-ws"
		const { provider, create } = makeProvider()
		provider.parallelManager.occupantsOf.mockResolvedValue([{ kind: "subagent", id: "other-child" }])
		const task = { taskId: "new-task", cwd: assigned, switchWorkspace: vi.fn() }

		const result = await provider.ensureUnoccupiedWorkspace({
			workspacePath: assigned,
			task,
			conversationId: "cv-new",
		})

		expect(create).toHaveBeenCalled()
		expect(task.switchWorkspace).toHaveBeenCalledWith("/repo/.kilocode/worktrees/isolated")
		expect(result.path).toBe("/repo/.kilocode/worktrees/isolated")
	})

	it("focusTask rebinds a restored subagent to its assigned worktree instead of UI cwd", async () => {
		const assigned = "/repo/.kilocode/worktrees/928-workspace-routing"
		const switchWorkspace = vi.fn()
		const task = {
			taskId: "child-1",
			cwd: "/repo",
			subagent: { sessionId: "child-1" },
			switchWorkspace,
			getTaskApiConfigName: vi.fn().mockResolvedValue(undefined),
		}
		const { provider } = makeProvider({
			clineStack: [task],
			getCurrentTask: vi.fn(() => task),
			getFocusedChatTask: vi.fn(() => task),
			restoreFocusedTaskProviderProfile: vi.fn(),
			restoreFocusedTaskMode: vi.fn(),
			replayFocusedTaskLiveCommands: vi.fn(),
			postStateToWebview: vi.fn(),
		})
		provider.parallelManager.getSession.mockReturnValue({
			info: { workspacePath: assigned, sessionId: "child-1" },
		})
		provider.parallelManager.conversationForSession.mockReturnValue({
			id: "cv-child",
			workspacePath: assigned,
			sessionId: "child-1",
		})

		await provider.focusTask("child-1")

		expect(switchWorkspace).toHaveBeenCalledWith(assigned)
		expect(task.cwd).toBe("/repo")
	})
})
