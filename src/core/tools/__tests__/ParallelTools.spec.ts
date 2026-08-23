import { dispatchSubagentsTool, workspaceStatusTool, workspaceCreateTool, workspaceMergeTool } from "../ParallelTools"
import { checkAutoApproval } from "../../auto-approval"

const makeCallbacks = () => ({
	askApproval: async () => true,
	handleError: async () => {},
	pushToolResult: vi.fn(),
	removeClosingTag: (tag: string, text?: string) => text ?? "",
	toolProtocol: "xml" as const,
})

const makeTask = (provider: unknown) =>
	({
		taskId: "task-1",
		cwd: "/repo",
		providerRef: { deref: () => provider },
		consecutiveMistakeCount: 0,
		recordToolError: () => {},
		didToolFailInCurrentTurn: false,
		say: async () => {},
		abort: false,
		switchWorkspace: vi.fn(async () => {}),
	}) as any

const makeProvider = (state: Record<string, unknown>) => {
	const provider: any = {
		getState: async () => state,
		parallelManager: undefined,
		workspaceService: undefined,
	}
	provider.getWorkspaceService = () => provider.workspaceService
	provider.postMessageToWebview = vi.fn(async () => undefined)
	return provider
}

describe("DispatchSubagentsTool", () => {
	test("parseLegacy parses the tasks JSON array", () => {
		const params = dispatchSubagentsTool.parseLegacy({
			tasks: '[{"task":"a","needs_workspace":true},{"task":"b"}]',
		})
		expect(params.tasks).toHaveLength(2)
		expect(params.tasks[0].needs_workspace).toBe(true)
	})

	test("parseLegacy returns empty array for invalid JSON", () => {
		expect(dispatchSubagentsTool.parseLegacy({ tasks: "not json" }).tasks).toEqual([])
	})

	test("execute rejects an empty tasks list", async () => {
		const callbacks = makeCallbacks()
		await dispatchSubagentsTool.execute({ tasks: [] }, makeTask(makeProvider({})), callbacks)
		expect(callbacks.pushToolResult).toHaveBeenCalledTimes(1)
		const result = callbacks.pushToolResult.mock.calls[0][0]
		expect(JSON.stringify(result)).toContain("non-empty `tasks` array")
	})

	test("execute rejects more than five subagents", async () => {
		const callbacks = makeCallbacks()
		const tasks = Array.from({ length: 6 }, (_, i) => ({ task: `t${i}` }))
		await dispatchSubagentsTool.execute({ tasks }, makeTask(makeProvider({})), callbacks)
		expect(JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])).toContain("At most 5")
	})

	test("execute fails fast when the parallel manager is unavailable", async () => {
		const callbacks = makeCallbacks()
		await dispatchSubagentsTool.execute(
			{ tasks: [{ task: "do" }] },
			makeTask(makeProvider({ agentSubagentDispatchEnabled: true })),
			callbacks,
		)
		expect(JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])).toContain("Parallel manager unavailable")
	})

	test("execute reports when dispatch is disabled by settings", async () => {
		const callbacks = makeCallbacks()
		const provider = makeProvider({ agentSubagentDispatchEnabled: false })
		provider.parallelManager = {}
		await dispatchSubagentsTool.execute({ tasks: [{ task: "do" }] }, makeTask(provider), callbacks)
		expect(JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])).toContain("disabled in settings")
	})

	test("execute rejects nested dispatch from a subagent", async () => {
		const callbacks = makeCallbacks()
		const task = makeTask(makeProvider({}))
		task.subagent = { sessionId: "sa-1", depth: 1, manager: {} }
		await dispatchSubagentsTool.execute({ tasks: [{ task: "do" }] }, task, callbacks)
		expect(JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])).toContain("depth limit")
	})

	test("a busy named workspace is forked into a sibling worktree", async () => {
		const callbacks = makeCallbacks()
		const created = {
			name: "ws-fork",
			path: "/repo/.kilocode/worktrees/ws-fork",
			branch: "deeptask/ws-fork",
		}
		const provider = makeProvider({
			agentSubagentDispatchEnabled: true,
			agentWorkspaceManagementEnabled: true,
		})
		provider.workspaceService = {
			claim: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(created),
			create: vi.fn(async () => created),
		}
		provider.parallelManager = {
			folderPathForPath: (cwd: string) => cwd,
			spawn: vi.fn(() => ({ sessionId: "sa-1", done: Promise.resolve() })),
			getSession: () => ({
				info: {
					label: "impl",
					status: "completed",
					workspaceName: created.name,
					branch: created.branch,
					result: "ok",
				},
			}),
			cancelChildrenOf: vi.fn(),
			broadcast: vi.fn(async () => undefined),
		}
		await dispatchSubagentsTool.execute(
			{ tasks: [{ task: "write files", label: "impl", workspace: "ws" }] },
			makeTask(provider),
			callbacks,
		)
		expect(provider.workspaceService.create).toHaveBeenCalledWith({
			name: "ws-fork",
			description: "write files",
			folderPath: "/repo",
		})
		expect(provider.parallelManager.spawn).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ workspaceName: created.name, workspacePath: created.path }),
		)
	})

	test("completed write-bearing workspaces auto-merge into the parent workspace", async () => {
		const callbacks = makeCallbacks()
		const created = {
			name: "writer",
			path: "/repo/.kilocode/worktrees/writer",
			branch: "deeptask/writer",
		}
		const provider = makeProvider({
			agentSubagentDispatchEnabled: true,
			agentWorkspaceManagementEnabled: true,
		})
		provider.workspaceService = {
			claim: vi.fn(async () => created),
			create: vi.fn(async () => created),
			summaries: vi.fn(async () => [{ name: created.name, dirtyFiles: 1, aheadOfBase: 1 }]),
			merge: vi.fn(async () => ({ ok: true, reason: "merged 1 commit" })),
		}
		provider.parallelManager = {
			folderPathForPath: (cwd: string) => cwd,
			spawn: vi.fn(() => ({ sessionId: "sa-write", done: Promise.resolve() })),
			getSession: () => ({
				info: {
					label: "writer",
					status: "completed",
					workspaceName: created.name,
					branch: created.branch,
					result: "wrote file",
				},
			}),
			cancelChildrenOf: vi.fn(),
			broadcast: vi.fn(async () => undefined),
		}
		await dispatchSubagentsTool.execute(
			{ tasks: [{ task: "write a file", label: "writer", needs_workspace: true }] },
			makeTask(provider),
			callbacks,
		)
		expect(provider.workspaceService.merge).toHaveBeenCalledWith({
			name: created.name,
			removeAfter: false,
			allowOwner: "task-1",
		})
		expect(JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])).toContain("Auto-merged")
	})
})

describe("Workspace tools execute guards", () => {
	test("workspace_status returns guidance when no workspaces exist", async () => {
		const callbacks = makeCallbacks()
		const provider = makeProvider({})
		provider.workspaceService = { summaries: async () => [] }
		await workspaceStatusTool.execute({}, makeTask(provider), callbacks)
		expect(JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])).toContain("No parallel workspaces exist yet")
	})

	test("workspace_create reports when workspace management is disabled", async () => {
		const callbacks = makeCallbacks()
		const provider = makeProvider({ agentWorkspaceManagementEnabled: false })
		provider.workspaceService = {}
		await workspaceCreateTool.execute({ name: "x" }, makeTask(provider), callbacks)
		expect(JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])).toContain("disabled in settings")
	})

	test("workspace_create switches the calling task and migrates its conversation", async () => {
		const callbacks = makeCallbacks()
		const created = {
			name: "feature-x",
			path: "/repo/.kilocode/worktrees/feature-x",
			branch: "deeptask/feature-x",
			baseBranch: "main",
		}
		const provider = makeProvider({ agentWorkspaceManagementEnabled: true })
		provider.workspaceService = {
			create: vi.fn(async () => created),
			claim: vi.fn(async () => created),
		}
		provider.parallelManager = {
			folderPathForPath: (cwd: string) => cwd,
			conversationForSession: () => ({ id: "cv-1", folderPath: "/repo", workspacePath: "/repo" }),
			updateConversationWorkspace: vi.fn(async () => undefined),
			broadcast: vi.fn(async () => undefined),
		}
		provider.postMessageToWebview = vi.fn(async () => undefined)
		const task = makeTask(provider)
		task.switchWorkspace = vi.fn(async () => undefined)
		await workspaceCreateTool.execute({ name: "feature-x" }, task, callbacks)
		expect(provider.workspaceService.create).toHaveBeenCalledWith({
			name: "feature-x",
			description: undefined,
			folderPath: "/repo",
		})
		expect(task.switchWorkspace).toHaveBeenCalledWith(created.path)
		expect(provider.parallelManager.updateConversationWorkspace).toHaveBeenCalledWith("cv-1", "/repo", created.path)
		expect(JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])).toContain("moved this conversation")
	})

	test("workspace_status reports occupancy by workspacePath", async () => {
		const callbacks = makeCallbacks()
		const provider = makeProvider({})
		provider.workspaceService = { summaries: async () => [] }
		provider.parallelManager = {
			folderPathForPath: (cwd: string) => cwd,
			listRunning: () => [],
			listConversations: async () => [
				{
					id: "cv-1",
					folderPath: "/repo",
					workspacePath: "/repo",
					title: "first",
					sessionId: "task-2",
				},
			],
			occupantsOf: async () => [{ kind: "conversation", id: "cv-1", label: "first" }],
		}
		await workspaceStatusTool.execute({}, makeTask(provider), callbacks)
		const result = JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])
		expect(result).toContain("workspace=/repo")
		expect(result).toContain("OCCUPIED")
		expect(result).toContain("first")
	})

	test("workspace_merge requires a name", async () => {
		const callbacks = makeCallbacks()
		const task = makeTask(makeProvider({}))
		const missingParam = vi.fn(async () => ({}) as any)
		task.sayAndCreateMissingParamError = missingParam
		await workspaceMergeTool.execute({ name: "" }, task, callbacks)
		expect(missingParam).toHaveBeenCalledWith("workspace_merge", "name")
	})

	test("workspace_merge switches the caller then merges and can delete the old worktree", async () => {
		const callbacks = makeCallbacks()
		const provider = makeProvider({ agentWorkspaceManagementEnabled: true })
		const source = { name: "workspace-old", path: "/repo/.kilocode/worktrees/workspace-old" }
		provider.workspaceService = {
			findByNameOrPath: vi.fn(async (value: string) => (value === source.name || value === source.path ? source : undefined)),
			merge: vi.fn(async () => ({ ok: true, reason: "merged" })),
		}
		provider.parallelManager = {
			folderPathForPath: () => "/repo",
			conversationForSession: () => ({ id: "cv-1" }),
			updateConversationWorkspace: vi.fn(async () => undefined),
			moveConversationsToWorkspace: vi.fn(async () => undefined),
			broadcast: vi.fn(async () => undefined),
		}
		const task = makeTask(provider)
		task.cwd = source.path
		task.switchWorkspace = vi.fn(async () => undefined)
		await workspaceMergeTool.execute(
			{ name: source.name, switch_to: "main", delete_after: true },
			task,
			callbacks,
		)
		expect(task.switchWorkspace).toHaveBeenCalledWith("/repo")
		expect(provider.workspaceService.merge).toHaveBeenCalledWith({
			name: source.name,
			removeAfter: true,
			allowOwner: "task-1",
		})
		expect(provider.parallelManager.moveConversationsToWorkspace).toHaveBeenCalledWith(source.path, "/repo")
		expect(JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])).toContain("This conversation is now in /repo")
	})
})

describe("parallel tool auto-approval", () => {
	test("dispatch is denied when the subagent permission is off", async () => {
		const decision = await checkAutoApproval({
			state: { autoApprovalEnabled: true, agentSubagentDispatchEnabled: false } as any,
			ask: "tool",
			text: JSON.stringify({ tool: "dispatchSubagents", count: 1 }),
		})
		expect(decision.decision).toBe("deny")
	})

	test("dispatch is approved by default (permission on)", async () => {
		const decision = await checkAutoApproval({
			state: { autoApprovalEnabled: true, agentSubagentDispatchEnabled: true } as any,
			ask: "tool",
			text: JSON.stringify({ tool: "dispatchSubagents", count: 2 }),
		})
		expect(decision.decision).toBe("approve")
	})

	test("workspace status is always approved (read-only)", async () => {
		const decision = await checkAutoApproval({
			state: { autoApprovalEnabled: true } as any,
			ask: "tool",
			text: JSON.stringify({ tool: "workspaceStatus" }),
		})
		expect(decision.decision).toBe("approve")
	})

	test("workspace create/merge auto-approve unless workspace management is disabled", async () => {
		const denied = await checkAutoApproval({
			state: { autoApprovalEnabled: true, agentWorkspaceManagementEnabled: false } as any,
			ask: "tool",
			text: JSON.stringify({ tool: "workspaceMerge", workspace: "x" }),
		})
		expect(denied.decision).toBe("deny")

		const approved = await checkAutoApproval({
			state: { autoApprovalEnabled: true } as any,
			ask: "tool",
			text: JSON.stringify({ tool: "workspaceMerge", workspace: "x" }),
		})
		expect(approved.decision).toBe("approve")
	})
})
