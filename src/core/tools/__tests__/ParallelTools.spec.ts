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

	test("execute allows nested dispatch from a subagent (no depth gate)", async () => {
		const callbacks = makeCallbacks()
		const provider = makeProvider({ agentSubagentDispatchEnabled: true })
		provider.parallelManager = {
			folderPathForPath: (cwd: string) => cwd,
			spawn: vi.fn(() => ({ sessionId: "sa-grandchild", done: Promise.resolve() })),
			getSession: () => ({
				info: {
					label: "grandchild",
					status: "completed",
					result: "nested ok",
				},
			}),
			cancelChildrenOf: vi.fn(),
			broadcast: vi.fn(async () => undefined),
		}
		const task = makeTask(provider)
		// A depth-1 subagent (i.e. a child spawned by another subagent's parent)
		// must be allowed to dispatch its own subagents — nesting is unbounded.
		task.subagent = { sessionId: "sa-1", depth: 1, manager: {} }
		await dispatchSubagentsTool.execute({ tasks: [{ task: "grandchild work" }] }, task, callbacks)
		expect(provider.parallelManager.spawn).toHaveBeenCalledTimes(1)
		const result = JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])
		expect(result).toContain("nested ok")
		expect(result).not.toContain("depth limit")
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

	test("subagents get a workspace by default (needs_workspace defaults to true)", async () => {
		const callbacks = makeCallbacks()
		const created = {
			name: "default-ws",
			path: "/repo/.kilocode/worktrees/default-ws",
			branch: "deeptask/default-ws",
		}
		const provider = makeProvider({
			agentSubagentDispatchEnabled: true,
			agentWorkspaceManagementEnabled: true,
		})
		provider.workspaceService = {
			create: vi.fn(async () => created),
			claim: vi.fn(async () => created),
			summaries: vi.fn(async () => [{ name: created.name, dirtyFiles: 0, aheadOfBase: 0 }]),
		}
		provider.parallelManager = {
			folderPathForPath: (cwd: string) => cwd,
			spawn: vi.fn(() => ({ sessionId: "sa-default", done: Promise.resolve() })),
			getSession: () => ({
				info: { label: "default-ws", status: "completed", workspaceName: created.name, result: "ok" },
			}),
			cancelChildrenOf: vi.fn(),
			broadcast: vi.fn(async () => undefined),
		}
		// NOTE: no needs_workspace field at all — must still create a workspace.
		await dispatchSubagentsTool.execute({ tasks: [{ task: "maybe writes", label: "default-ws" }] }, makeTask(provider), callbacks)
		expect(provider.workspaceService.create).toHaveBeenCalledWith({
			name: "default-ws",
			description: "maybe writes",
			folderPath: "/repo",
		})
		expect(provider.parallelManager.spawn).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ workspaceName: created.name, workspacePath: created.path }),
		)
	})

	test("needs_workspace:false opts out of workspace creation for read-only tasks", async () => {
		const callbacks = makeCallbacks()
		const provider = makeProvider({
			agentSubagentDispatchEnabled: true,
			agentWorkspaceManagementEnabled: true,
		})
		provider.workspaceService = {
			create: vi.fn(async () => { throw new Error("must not create") }),
			claim: vi.fn(async () => { throw new Error("must not claim") }),
		}
		provider.parallelManager = {
			folderPathForPath: (cwd: string) => cwd,
			spawn: vi.fn(() => ({ sessionId: "sa-readonly", done: Promise.resolve() })),
			getSession: () => ({
				info: { label: "reader", status: "completed", result: "read ok" },
			}),
			cancelChildrenOf: vi.fn(),
			broadcast: vi.fn(async () => undefined),
		}
		await dispatchSubagentsTool.execute(
			{ tasks: [{ task: "read only", label: "reader", needs_workspace: false }] },
			makeTask(provider),
			callbacks,
		)
		expect(provider.workspaceService.create).not.toHaveBeenCalled()
		const spec = (provider.parallelManager.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1]
		expect(spec.workspaceName).toBeUndefined()
	})

	test("needs_workspace:false wins over an explicit workspace field (no sibling fork)", async () => {
		// kilocode_change: defect G regression — models pass BOTH needs_workspace:false
		// AND workspace:"main"; the workspace branch used to run first and fork a
		// sibling worktree (main-fork-9) for an explicitly read-only task.
		const callbacks = makeCallbacks()
		const provider = makeProvider({
			agentSubagentDispatchEnabled: true,
			agentWorkspaceManagementEnabled: true,
		})
		provider.workspaceService = {
			create: vi.fn(async () => {
				throw new Error("must not create")
			}),
			claim: vi.fn(async () => {
				throw new Error("must not claim")
			}),
		}
		provider.parallelManager = {
			folderPathForPath: (cwd: string) => cwd,
			spawn: vi.fn(() => ({ sessionId: "sa-ro-main", done: Promise.resolve() })),
			getSession: () => ({
				info: { label: "reader-main", status: "completed", result: "read ok" },
			}),
			cancelChildrenOf: vi.fn(),
			broadcast: vi.fn(async () => undefined),
		}
		await dispatchSubagentsTool.execute(
			{ tasks: [{ task: "read only in parent cwd", label: "reader-main", needs_workspace: false, workspace: "main" }] },
			makeTask(provider),
			callbacks,
		)
		expect(provider.workspaceService.create).not.toHaveBeenCalled()
		expect(provider.workspaceService.claim).not.toHaveBeenCalled()
		const spec = (provider.parallelManager.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1]
		expect(spec.workspaceName).toBeUndefined()
		expect(spec.sharedWorkspace).toBe(true)
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
			syncSessionWorkspace: vi.fn(async () => undefined),
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
		expect(provider.parallelManager.syncSessionWorkspace).toHaveBeenCalledWith("task-1", created.path)
		expect(JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])).toContain("moved this conversation")
	})

	test("workspace_create binds an unbound session then moves it under the new worktree", async () => {
		const callbacks = makeCallbacks()
		const created = {
			name: "feature-x",
			path: "/repo/.kilocode/worktrees/feature-x",
			branch: "deeptask/feature-x",
			baseBranch: "main",
		}
		const createdConversation = { id: "cv-new", folderPath: "/repo", workspacePath: created.path }
		const provider = makeProvider({ agentWorkspaceManagementEnabled: true })
		provider.workspaceService = {
			create: vi.fn(async () => created),
			claim: vi.fn(async () => created),
		}
		provider.parallelManager = {
			folderPathForPath: (cwd: string) => cwd,
			conversationForSession: vi.fn(() => undefined),
			ensureTaskConversation: vi.fn(async () => createdConversation),
			syncSessionWorkspace: vi.fn(async () => undefined),
			broadcast: vi.fn(async () => undefined),
		}
		provider.postMessageToWebview = vi.fn(async () => undefined)
		const task = makeTask(provider)
		task.switchWorkspace = vi.fn(async () => undefined)
		await workspaceCreateTool.execute({ name: "feature-x" }, task, callbacks)
		expect(provider.parallelManager.syncSessionWorkspace).toHaveBeenCalledWith("task-1", created.path)
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
			syncSessionWorkspace: vi.fn(async () => undefined),
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
		expect(provider.parallelManager.syncSessionWorkspace).toHaveBeenCalledWith("task-1", "/repo")
		expect(provider.workspaceService.merge).toHaveBeenCalledWith({
			name: source.name,
			removeAfter: true,
			allowOwner: "task-1",
		})
		expect(provider.parallelManager.moveConversationsToWorkspace).toHaveBeenCalledWith(source.path, "/repo")
		expect(JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])).toContain("This conversation is now in /repo")
	})

	// kilocode_change: defect K - literal "null" switch_to must be rejected, never
	// turned into a real path (host bridges stringify JSON null into "null").
	test("workspace_merge refuses a literal null switch_to without merging", async () => {
		const callbacks = makeCallbacks()
		const provider = makeProvider({ agentWorkspaceManagementEnabled: true })
		const source = { name: "workspace-old", path: "/repo/.kilocode/worktrees/workspace-old" }
		provider.workspaceService = {
			findByNameOrPath: vi.fn(async () => source),
			merge: vi.fn(async () => ({ ok: true, reason: "merged" })),
		}
		provider.parallelManager = {
			folderPathForPath: () => "/repo",
			syncSessionWorkspace: vi.fn(async () => undefined),
			broadcast: vi.fn(async () => undefined),
		}
		const task = makeTask(provider)
		task.cwd = source.path
		task.switchWorkspace = vi.fn(async () => undefined)
		await workspaceMergeTool.execute({ name: source.name, switch_to: "null" as unknown as undefined }, task, callbacks)
		expect(task.switchWorkspace).not.toHaveBeenCalled()
		expect(provider.workspaceService.merge).not.toHaveBeenCalled()
		expect(JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])).toContain("Ignoring invalid switch_to")
	})

	test("workspace_merge refuses a non-absolute unregistered switch_to target", async () => {
		const callbacks = makeCallbacks()
		const provider = makeProvider({ agentWorkspaceManagementEnabled: true })
		const source = { name: "workspace-old", path: "/repo/.kilocode/worktrees/workspace-old" }
		provider.workspaceService = {
			findByNameOrPath: vi.fn(async (value: string) => (value === source.name || value === source.path ? source : undefined)),
			merge: vi.fn(async () => ({ ok: true, reason: "merged" })),
		}
		provider.parallelManager = {
			folderPathForPath: () => "/repo",
			syncSessionWorkspace: vi.fn(async () => undefined),
			broadcast: vi.fn(async () => undefined),
		}
		const task = makeTask(provider)
		task.cwd = source.path
		task.switchWorkspace = vi.fn(async () => undefined)
		await workspaceMergeTool.execute({ name: source.name, switch_to: "junk-relative-name" }, task, callbacks)
		expect(task.switchWorkspace).not.toHaveBeenCalled()
		expect(provider.workspaceService.merge).not.toHaveBeenCalled()
		expect(JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])).toContain("Refusing to switch")
	})

	test("workspace_create refuses a non-absolute junk cwd without creating", async () => {
		const callbacks = makeCallbacks()
		const provider = makeProvider({ agentWorkspaceManagementEnabled: true })
		provider.workspaceService = { create: vi.fn(async () => ({})), claim: vi.fn(async () => undefined) }
		const task = makeTask(provider)
		task.cwd = "null"
		await workspaceCreateTool.execute({ name: "bad-root" }, task, callbacks)
		expect(provider.workspaceService.create).not.toHaveBeenCalled()
		expect(JSON.stringify(callbacks.pushToolResult.mock.calls[0][0])).toContain(
			"not a valid absolute repository path",
		)
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
