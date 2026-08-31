// kilocode_change - new file: tests for the parallel conversation registry
import type { ExtensionMessage, ParallelConversation } from "@roo-code/types"

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

	test("createConversation reuses an existing session instead of duplicating the rail row", async () => {
		const { manager } = setup()
		const first = await manager.createConversation("/repo", { sessionId: "same-task", title: "first" })
		const second = await manager.createConversation("/repo", { sessionId: "same-task", title: "second" })
		expect(second.id).toBe(first.id)
		expect((await manager.listConversations()).filter((conversation) => conversation.sessionId === "same-task")).toHaveLength(1)
	})

	test("ensureTaskConversation reuses an existing session and activates it", async () => {
		const { manager } = setup()
		const created = await manager.createConversation("/repo", { sessionId: "hist-1", title: "old" })
		await manager.createConversation("/other")
		const ensured = await manager.ensureTaskConversation({
			sessionId: "hist-1",
			title: "old",
			workspacePath: "/repo",
		})
		expect(ensured.id).toBe(created.id)
		expect(manager.getActiveConversationId()).toBe(created.id)
	})

	// kilocode_change start: reopening a completed task must clear its stale
	// completedAt marker so the rail spinner and broadcast backfill treat it as
	// running again instead of skipping it.
	test("ensureTaskConversation clears a stale completedAt marker on reopen", async () => {
		const { manager } = setup()
		const created = await manager.createConversation("/repo", { sessionId: "hist-2", title: "done once" })
		await manager.markConversationCompleted("hist-2")
		expect((await manager.getConversation(created.id))?.completedAt).toBeTruthy()
		const ensured = await manager.ensureTaskConversation({
			sessionId: "hist-2",
			title: "done once",
			workspacePath: "/repo",
		})
		expect(ensured.id).toBe(created.id)
		expect(ensured.completedAt).toBeUndefined()
		expect((await manager.getConversation(created.id))?.completedAt).toBeUndefined()
	})
	// kilocode_change end

	test("ensureTaskConversation creates a conversation for a history task", async () => {
		const { manager } = setup()
		const created = await manager.ensureTaskConversation({
			sessionId: "hist-new",
			title: "from history",
			workspacePath: "/repo",
		})
		expect(created.sessionId).toBe("hist-new")
		expect(created.title).toBe("from history")
		expect(created.folderPath).toBe("/repo")
		expect(manager.getActiveConversationId()).toBe(created.id)
		expect((await manager.getFolders()).some((folder) => folder.path === "/repo")).toBe(true)
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

	test("bindConversation merges a placeholder row into the existing session row", async () => {
		const { manager } = setup()
		await manager.createConversation("/repo", { sessionId: "task-dup", title: "real" })
		const placeholder = await manager.createConversation("/repo")

		await manager.bindConversation(placeholder.id, "task-dup", "real")
		const list = await manager.listConversations()
		expect(list.filter((conversation) => conversation.sessionId === "task-dup")).toHaveLength(1)
		expect(manager.conversationForSession("task-dup")?.title).toBe("real")
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

	test("syncSessionWorkspace creates a conversation for an unbound session under the new workspace", async () => {
		const { manager } = setup()
		await manager.registerMainFolder("/repo")

		await manager.syncSessionWorkspace("task-9", "/repo/.kilocode/worktrees/ws-9")

		const conversation = manager.conversationForSession("task-9")
		expect(conversation).toBeDefined()
		expect(conversation?.folderPath).toBe("/repo")
		expect(conversation?.workspacePath).toBe("/repo/.kilocode/worktrees/ws-9")
	})

	test("syncSessionWorkspace re-parents an already bound session conversation", async () => {
		const { manager } = setup()
		await manager.registerMainFolder("/repo")
		await manager.ensureTaskConversation({ sessionId: "task-10", folderPath: "/repo" })

		await manager.syncSessionWorkspace("task-10", "/repo/.kilocode/worktrees/ws-10")

		const conversations = manager.conversationForSession("task-10")
		expect(conversations?.folderPath).toBe("/repo")
		expect(conversations?.workspacePath).toBe("/repo/.kilocode/worktrees/ws-10")
		const listed = await manager.listConversations(true)
		expect(listed.filter((c) => c.sessionId === "task-10")).toHaveLength(1)
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

	// kilocode_change start: reopening a task from history must unarchive its
	// rail conversation so the rail (which filters on archivedAt) shows it.
	test("ensureTaskConversation unarchives an archived conversation on reopen", async () => {
		const { manager } = setup()
		const created = await manager.createConversation("/repo", { sessionId: "task-9", title: "archived chat" })
		await manager.setConversationArchived(created.id, true)
		expect((await manager.listConversations()).map((c) => c.id)).toEqual([])

		const ensured = await manager.ensureTaskConversation({
			sessionId: "task-9",
			title: "archived chat",
			workspacePath: "/repo",
		})

		expect(ensured.id).toBe(created.id)
		expect(ensured.archivedAt).toBeUndefined()
		expect((await manager.listConversations()).map((c) => c.id)).toContain(created.id)
	})
	// kilocode_change end

	// kilocode_change start: loadConversations must not clobber a dirty
	// in-memory list with a stale storage snapshot when the load suspends on
	// globalState.get while attachSubagentConversation inserts synchronously.
	// This reproduced subagent conversations vanishing from the rail.
	test("forced reload keeps dirty in-memory conversations added while the load was suspended", async () => {
		const { manager, store } = setup()
		await manager.createConversation("/repo", { sessionId: "t1", title: "base" })
		// Storage snapshot is now "t1 only".
		expect(store.get("parallelConversations")).toHaveLength(1)

		// Start a forced reload that suspends on globalState.get...
		let releaseGet!: () => void
		let gate: Promise<void> | undefined = new Promise<void>((resolve) => {
			releaseGet = resolve
		})
		const store2 = store as Map<string, unknown>
		const originalGet = store2.get.bind(store2) as (key?: unknown) => unknown
		store2.get = ((key: unknown) => {
			if (key === "parallelConversations" && gate) {
				const pending = gate
				gate = undefined
				return Promise.resolve(pending).then(() => originalGet(key))
			}
			return originalGet(key)
		}) as typeof store2.get

		const reload = manager.reloadConversationsFromStorage()
		await Promise.resolve()
		await Promise.resolve()

		// ...simulate the synchronous attach that happens in spawn() while
		// the reload is suspended: insert directly + mark dirty, exactly like
		// attachSubagentConversation does.
		const dirtyList: ParallelConversation[] = [
			{
				id: "cv-race-subagent",
				folderPath: "/repo",
				workspacePath: "/repo/.kilocode/worktrees/ws-race",
				title: "race subagent",
				sessionId: "sa-race",
				createdAt: Date.now(),
				lastActiveAt: Date.now(),
			},
		]
		// Access privates through the same path production code uses.
		const internals = manager as unknown as {
			conversations: ParallelConversation[] | undefined
			conversationsDirty: boolean
		}
		internals.conversations = [...dirtyList, ...(internals.conversations ?? [])]
		internals.conversationsDirty = true

		releaseGet()
		await reload

		// The dirty subagent conversation must survive the reload and be
		// persisted, not overwritten by the stale "t1 only" snapshot.
		const stored = store.get("parallelConversations") as Array<{ id: string }>
		expect(stored.map((c) => c.id)).toContain("cv-race-subagent")
		expect((await manager.listConversations(true)).map((c) => c.id)).toContain("cv-race-subagent")
	})
	// kilocode_change end

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

	test("registerMainFolder unarchives the current window folder", async () => {
		const { manager } = setup()
		await manager.registerMainFolder("/repo")
		await manager.setFolderArchived("/repo", true)
		expect((await manager.getFolders()).find((f) => f.path === "/repo")?.archivedAt).toBeTruthy()

		await manager.registerMainFolder("/repo")
		expect((await manager.getFolders()).find((f) => f.path === "/repo")?.archivedAt).toBeUndefined()
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

	test("broadcast prunes missing worktrees after the first hydrate", async () => {
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
		const registry = new WorkspaceRegistry(makeStorage(store) as never)
		const prune = vi.spyOn(registry, "prune").mockResolvedValue(["feature"])
		const manager = new ParallelManager(provider, registry)

		await manager.broadcast()
		hydrateFromDisk.mockClear()
		posted.length = 0
		await manager.broadcast()

		expect(hydrateFromDisk).not.toHaveBeenCalled()
		expect(prune).toHaveBeenCalled()
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

	test("deleteConversationsForSession removes the matching rail conversation", async () => {
		const { manager } = setup()
		await manager.registerMainFolder("/repo")
		const keep = await manager.createConversation("/repo", { sessionId: "keep-task", title: "keep" })
		await manager.createConversation("/repo", { sessionId: "gone-task", title: "gone" })

		const removed = await manager.deleteConversationsForSession("gone-task")
		expect(removed).toHaveLength(1)
		expect(removed[0]?.sessionId).toBe("gone-task")
		expect((await manager.listConversations()).map((conversation) => conversation.id)).toEqual([keep.id])
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

	test("spawn immediately attaches a conversation under the worktree", async () => {
		const { manager } = setup()
		await manager.registerMainFolder("/repo")
		const createSpy = vi.spyOn(Task, "create").mockImplementation((options) => {
			const child = { taskId: "child-task" } as Task
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

		manager.spawn(parent, {
			label: "term-a",
			task: "write files",
			workspaceName: "term-a",
			workspacePath: "/repo/.kilocode/worktrees/term-a",
		})

		const conversation = manager.conversationForSession("child-task")
		expect(conversation?.title).toBe("term-a")
		expect(conversation?.workspacePath).toBe("/repo/.kilocode/worktrees/term-a")
		expect(conversation?.folderPath).toBe("/repo")
		createSpy.mockRestore()
	})
})
