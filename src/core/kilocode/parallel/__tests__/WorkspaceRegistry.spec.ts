import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { WorkspaceRegistry } from "../WorkspaceRegistry"
import type { ParallelWorkspace } from "@roo-code/types"

const makeEntry = (name: string, status: ParallelWorkspace["status"] = "available"): ParallelWorkspace => ({
	name,
	path: `/tmp/workspaces/${name}`,
	branch: `deeptask/${name}`,
	baseBranch: "main",
	status,
	createdAt: Date.now(),
	updatedAt: Date.now(),
})

const createStorage = () => {
	const store = new Map<string, unknown>()
	return {
		get: async <T>(key: string): Promise<T | undefined> => store.get(key) as T | undefined,
		update: async (key: string, value: unknown) => {
			store.set(key, value)
		},
		_store: store,
	}
}

describe("WorkspaceRegistry", () => {
	let storage: ReturnType<typeof createStorage>
	let registry: WorkspaceRegistry

	beforeEach(() => {
		storage = createStorage()
		registry = new WorkspaceRegistry(storage)
	})

	test("registers and lists entries newest first", async () => {
		await registry.register(makeEntry("a"))
		await new Promise((resolve) => setTimeout(resolve, 5))
		await registry.register(makeEntry("b"))
		expect(registry.list().map((w) => w.name)).toEqual(["b", "a"])
	})

	test("claim is exclusive while busy", async () => {
		await registry.register(makeEntry("ws"))
		const first = await registry.claim("ws", "agent-1")
		expect(first?.status).toBe("busy")
		expect(first?.owner).toBe("agent-1")

		const second = await registry.claim("ws", "agent-2")
		expect(second).toBeUndefined()

		await registry.release("ws")
		const reclaimed = await registry.claim("ws", "agent-2")
		expect(reclaimed?.owner).toBe("agent-2")
	})

	test("claiming an unknown workspace returns undefined", async () => {
		expect(await registry.claim("missing", "agent")).toBeUndefined()
	})

	test("mark updates status and persists", async () => {
		await registry.register(makeEntry("ws"))
		await registry.mark("ws", "merged")
		expect((await registry.get("ws"))?.status).toBe("merged")
		const persisted = (await storage.get("parallelWorkspaceRegistry")) as ParallelWorkspace[]
		expect(persisted.find((w) => w.name === "ws")?.status).toBe("merged")
	})

	test("registry state survives reload from storage", async () => {
		await registry.register(makeEntry("persisted"))
		const reloaded = new WorkspaceRegistry(storage)
		expect((await reloaded.get("persisted"))?.branch).toBe("deeptask/persisted")
	})

	test("prune removes entries whose directory no longer exists", async () => {
		const keptDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "deeptask-registry-kept-"))
		await registry.register({ ...makeEntry("gone"), path: "/tmp/definitely-missing-workspace-xyz" })
		await registry.register({ ...makeEntry("kept"), path: keptDir })
		const removed = await registry.prune()
		expect(removed).toEqual(["gone"])
		expect(await registry.get("kept")).toBeDefined()
		expect(await registry.get("gone")).toBeUndefined()
	})
})
