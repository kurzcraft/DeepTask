// kilocode_change - new file: tests for the parallel conversation registry
import type { ExtensionMessage } from "@roo-code/types"

import { Task } from "../../../task/Task"
import { ParallelManager } from "../ParallelManager"
import { WorkspaceRegistry } from "../WorkspaceRegistry"

const makeStorage = (store: Map<string, unknown>) => ({
	get: (key: string, defaultValue?: unknown) => (store.has(key) ? store.get(key) : defaultValue),
	update: (key: string, value: unknown) => {
		store.set(key, value)
		return Promise.resolve(undefined)
	},
})

const setup = () => {
	const store = new Map<string, unknown>()
	const posted: ExtensionMessage[] = []
	const provider = {
		context: { globalState: makeStorage(store) },
		postMessageToWebview: async (message: ExtensionMessage) => {
			posted.push(message)
		},
	} as unknown as ConstructorParameters<typeof ParallelManager>[0]
	const registry = new WorkspaceRegistry(makeStorage(store) as never)
	const manager = new ParallelManager(provider, registry)
	return { manager, store, posted }
}

describe("ParallelManager conversations", () => {
	test("createConversation persists, activates, and lists newest first", async () => {
		const { manager } = setup()
		const first = await manager.createConversation("/repo", { sessionId: "t1", title: "first task" })
		const second = await manager.createConversation("/repo")

		expect(second.id).not.toBe(first.id)
		expect(manager.getActiveConversationId()).toBe(second.id)

		const list = await manager.listConversations()
		expect(list.map((c) => c.id)).toEqual([second.id, first.id])
		expect(list[1].title).toBe("first task")
		expect(list[1].sessionId).toBe("t1")
		expect(list[0].sessionId).toBeUndefined()
		expect(list[0].folderPath).toBe("/repo")
		expect(list[0].workspacePath).toBe("/repo")
	})

	test("conversations survive a new manager instance (global state)", async () => {
		const { manager, store } = setup()
		const created = await manager.createConversation("/repo", { sessionId: "t1", title: "keep" })

		const resurrectedStore = new Map(store)
		const provider2 = {
			context: { globalState: makeStorage(resurrectedStore) },
			postMessageToWebview: async () => {},
		} as unknown as ConstructorParameters<typeof ParallelManager>[0]
		const manager2 = new ParallelManager(provider2, new WorkspaceRegistry(makeStorage(resurrectedStore) as never))

		const conversation = await manager2.getConversation(created.id)
		expect(conversation?.title).toBe("keep")
		expect(conversation?.sessionId).toBe("t1")
	})

	test("bindConversation attaches the session and updates the title", async () => {
		const { manager } = setup()
		const created = await manager.createConversation("/repo")

		await manager.bindConversation(created.id, "task-9", "Fix login")
		const conversation = await manager.getConversation(created.id)
		expect(conversation?.sessionId).toBe("task-9")
		expect(conversation?.title).toBe("Fix login")
		expect(manager.conversationForSession("task-9")?.id).toBe(created.id)
	})

	test("createConversation nests under the folder's main workspace by default", async () => {
		const { manager } = setup()
		await manager.registerMainFolder("/repo")
		const created = await manager.createConversation("/repo")
		expect(created.folderPath).toBe("/repo")
		expect(created.workspacePath).toBe("/repo")
	})

	test("createConversation binds a subagent task under its worktree node", async () => {
		const { manager } = setup()
		await manager.registerMainFolder("/repo")
		const created = await manager.createConversation("/repo", {
			sessionId: "child-task-id",
			title: "term-a",
			workspacePath: "/repo/.kilocode/worktrees/subagent-term-a",
			activate: false,
		})
		expect(created.folderPath).toBe("/repo")
		expect(created.workspacePath).toBe("/repo/.kilocode/worktrees/subagent-term-a")
		expect(created.sessionId).toBe("child-task-id")
		expect(manager.getActiveConversationId()).not.toBe(created.id)
		expect(manager.conversationForSession("child-task-id")?.workspacePath).toBe(
			"/repo/.kilocode/worktrees/subagent-term-a",
		)
	})

	test("updateConversationWorkspace keeps the parent folder and moves the conversation into a worktree", async () => {
		const { manager } = setup()
		await manager.registerMainFolder("/repo")
		const created = await manager.createConversation("/repo")

		await manager.updateConversationWorkspace(created.id, "/repo", "/repo/.kilocode/worktrees/ws-1")
		const conversation = await manager.getConversation(created.id)
		expect(conversation?.folderPath).toBe("/repo")
		expect(conversation?.workspacePath).toBe("/repo/.kilocode/worktrees/ws-1")
		expect(conversation?.sessionId).toBeUndefined()
	})

	test("getFolders lists only main folders, not worktree workspaces", async () => {
		const { manager } = setup()
		await manager.registerMainFolder("/repo")
		const folders = await manager.getFolders()
		expect(folders.map((f) => f.path)).toEqual(["/repo"])
		expect(folders.every((f) => f.kind === "main")).toBe(true)
	})

	test("legacy worktree conversations migrate under their parent folder", async () => {
		const { store } = setup()
		store.set("parallelFolders", [{ name: "repo", path: "/repo", kind: "main", createdAt: 1 }])
		store.set("parallelConversations", [
			{
				id: "cv-legacy",
				folderPath: "/repo/.kilocode/worktrees/ws-1",
				title: "old",
				createdAt: 1,
				lastActiveAt: 1,
			},
		])
		const resurrected = new ParallelManager(
			{
				context: { globalState: makeStorage(new Map(store)) },
				postMessageToWebview: async () => {},
			} as unknown as ConstructorParameters<typeof ParallelManager>[0],
			new WorkspaceRegistry(makeStorage(new Map(store)) as never),
		)
		const conversation = await resurrected.getConversation("cv-legacy")
		expect(conversation?.folderPath).toBe("/repo")
		expect(conversation?.workspacePath).toBe("/repo/.kilocode/worktrees/ws-1")
	})

	test("broadcast includes conversations and the active conversation id", async () => {
		const { manager, posted } = setup()
		const created = await manager.createConversation("/repo")

		await manager.broadcast()
		const message = posted.find((m) => m.type === "parallelSessionsUpdated")
		expect(message?.parallelConversations?.map((c) => c.id)).toEqual([created.id])
		expect(message?.parallelActiveConversationId).toBe(created.id)
	})

	test("setConversationArchived hides from the default list but remains in broadcast", async () => {
		const { manager, posted } = setup()
		const created = await manager.createConversation("/repo", { title: "keep" })
		await manager.setConversationArchived(created.id, true)

		expect((await manager.listConversations()).map((c) => c.id)).toEqual([])
		expect((await manager.listConversations(true)).map((c) => c.id)).toEqual([created.id])

		await manager.broadcast()
		const message = posted.find((m) => m.type === "parallelSessionsUpdated")
		expect(message?.parallelConversations?.[0]?.archivedAt).toBeTypeOf("number")
	})

	test("renameConversation updates the title", async () => {
		const { manager } = setup()
		const created = await manager.createConversation("/repo")
		await manager.renameConversation(created.id, "  renamed  ")
		expect((await manager.getConversation(created.id))?.title).toBe("renamed")
	})

	test("setFolderArchived persists and round-trips through a new manager", async () => {
		const { manager, store } = setup()
		await manager.registerMainFolder("/repo")
		await manager.setFolderArchived("/repo", true)

		const folders = await manager.getFolders()
		expect(folders.find((f) => f.path === "/repo")?.archivedAt).toBeTruthy()

		const resurrected = new ParallelManager(
			{
				context: { globalState: makeStorage(new Map(store)) },
				postMessageToWebview: async () => {},
			} as unknown as ConstructorParameters<typeof ParallelManager>[0],
			new WorkspaceRegistry(makeStorage(new Map(store)) as never),
		)
		const restored = await resurrected.getFolders()
		expect(restored.find((f) => f.path === "/repo")?.archivedAt).toBeTruthy()
	})

	test("restoreActiveConversation reads the persisted id", async () => {
		const { manager, store } = setup()
		const created = await manager.createConversation("/repo")

		const resurrected = new ParallelManager(
			{
				context: { globalState: makeStorage(new Map(store)) },
				postMessageToWebview: async () => {},
			} as unknown as ConstructorParameters<typeof ParallelManager>[0],
			new WorkspaceRegistry(makeStorage(new Map(store)) as never),
		)
		expect(await resurrected.restoreActiveConversation()).toBe(created.id)
	})

	test("occupantsOf reports a live sibling conversation in the same workspace", async () => {
		const store = new Map<string, unknown>()
		const liveTasks = [{ taskId: "task-1", cwd: "/repo", abort: false, abandoned: false, isStreaming: true }]
		const provider = {
			context: { globalState: makeStorage(store) },
			postMessageToWebview: async () => {},
			getLiveTasks: () => liveTasks,
		} as unknown as ConstructorParameters<typeof ParallelManager>[0]
		const manager = new ParallelManager(provider, new WorkspaceRegistry(makeStorage(store) as never))
		await manager.registerMainFolder("/repo")
		const first = await manager.createConversation("/repo", { sessionId: "task-1", title: "running" })
		const second = await manager.createConversation("/repo")

		expect(await manager.isWorkspaceOccupied("/repo", { conversationId: second.id })).toBe(true)
		const occupants = await manager.occupantsOf("/repo", { conversationId: second.id })
		expect(occupants.some((occupant) => occupant.id === first.id)).toBe(true)
	})

	test("occupantsOf ignores idle sibling conversations that are not streaming", async () => {
		const store = new Map<string, unknown>()
		const liveTasks = [{ taskId: "task-1", cwd: "/repo", abort: false, abandoned: false, isStreaming: false }]
		const provider = {
			context: { globalState: makeStorage(store) },
			postMessageToWebview: async () => {},
			getLiveTasks: () => liveTasks,
		} as unknown as ConstructorParameters<typeof ParallelManager>[0]
		const manager = new ParallelManager(provider, new WorkspaceRegistry(makeStorage(store) as never))
		await manager.registerMainFolder("/repo")
		await manager.createConversation("/repo", { sessionId: "task-1", title: "idle" })
		const second = await manager.createConversation("/repo")

		expect(await manager.isWorkspaceOccupied("/repo", { conversationId: second.id })).toBe(false)
	})

	test("broadcast hydrates persisted workspaces on window open", async () => {
		const store = new Map<string, unknown>()
		store.set("parallelFolders", [{ name: "repo", path: "/repo", kind: "main", createdAt: 1 }])
		store.set("parallelWorkspaceRegistry", [
			{
				name: "feature",
				path: "/repo/.kilocode/worktrees/feature",
				branch: "deeptask/feature",
				baseBranch: "main",
				status: "available",
				folderPath: "/repo",
				createdAt: 1,
				updatedAt: 1,
			},
		])
		const posted: ExtensionMessage[] = []
		const hydrateFromDisk = vi.fn().mockResolvedValue([])
		const provider = {
			context: { globalState: makeStorage(store) },
			postMessageToWebview: async (message: ExtensionMessage) => {
				posted.push(message)
			},
			getWorkspaceService: () => ({ hydrateFromDisk }),
		} as unknown as ConstructorParameters<typeof ParallelManager>[0]
		const manager = new ParallelManager(provider, new WorkspaceRegistry(makeStorage(store) as never))

		await manager.broadcast()
		const message = posted.find((entry) => entry.type === "parallelSessionsUpdated")
		expect(message?.parallelWorkspaces?.map((workspace) => workspace.name)).toEqual(["feature"])
		expect(hydrateFromDisk).toHaveBeenCalled()
	})

	test("deleteConversationsInWorkspace removes only that workspace's conversations", async () => {
		const { manager } = setup()
		await manager.registerMainFolder("/repo")
		const keep = await manager.createConversation("/repo")
		const gone = await manager.createConversation("/repo", {
			workspacePath: "/repo/.kilocode/worktrees/ws",
		})
		await manager.createConversation("/repo", {
			workspacePath: "/repo/.kilocode/worktrees/ws",
		})

		const removed = await manager.deleteConversationsInWorkspace("/repo/.kilocode/worktrees/ws")
		expect(removed).toHaveLength(2)
		expect(removed.every((conversation) => conversation.workspacePath === "/repo/.kilocode/worktrees/ws")).toBe(
			true,
		)
		expect((await manager.listConversations()).map((conversation) => conversation.id)).toEqual([keep.id])
		expect(manager.getActiveConversationId()).toBe(keep.id)
	})

	test("broadcast reloads conversations written by another window", async () => {
		const { manager, store, posted } = setup()
		await manager.registerMainFolder("/repo")
		await manager.createConversation("/repo", { title: "local" })

		store.set("parallelConversations", [
			{
				id: "cv-remote",
				folderPath: "/repo",
				workspacePath: "/repo",
				title: "from other window",
				createdAt: Date.now(),
				lastActiveAt: Date.now(),
			},
		])

		await manager.broadcast()
		const list = await manager.listConversations()
		expect(list.map((conversation) => conversation.id)).toEqual(["cv-remote"])
		const last = posted.at(-1)
		expect(last?.type).toBe("parallelSessionsUpdated")
		expect(last?.parallelConversations?.map((conversation) => conversation.id)).toEqual(["cv-remote"])
	})

	test("spawn inherits parent checkpoint and diff settings", () => {
		const { manager } = setup()
		const created: Array<Record<string, unknown>> = []
		const createSpy = vi.spyOn(Task, "create").mockImplementation((options) => {
			created.push(options as unknown as Record<string, unknown>)
			const child = {
				taskId: "child-task",
				enableCheckpoints: options.enableCheckpoints,
				diffEnabled: options.enableDiff,
				checkpointTimeout: options.checkpointTimeout,
			} as Task
			return [child, Promise.resolve()]
		})
		const parent = {
			taskId: "parent-task",
			cwd: "/repo",
			apiConfiguration: { apiProvider: "openai" },
			enableCheckpoints: false,
			diffEnabled: false,
			checkpointTimeout: 42,
			subagent: undefined,
		} as unknown as Task

		manager.spawn(parent, { label: "probe", task: "do not enable checkpoints" })

		expect(created[0]?.enableCheckpoints).toBe(false)
		expect(created[0]?.enableDiff).toBe(false)
		expect(created[0]?.checkpointTimeout).toBe(42)
		createSpy.mockRestore()
	})
})
