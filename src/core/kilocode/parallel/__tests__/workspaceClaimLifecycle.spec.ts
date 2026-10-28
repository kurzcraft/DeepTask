// kilocode_change - new file: transactional ownership and child settlement regressions
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { ParallelWorkspace } from "@roo-code/types"
import { Task } from "../../../task/Task"
import { ParallelManager } from "../ParallelManager"
import { WorkspaceRegistry } from "../WorkspaceRegistry"
import { FileParallelStateStore } from "../ParallelStateStore"

const entry = (name: string): ParallelWorkspace => ({
	name,
	path: `/repo/${name}`,
	branch: `deeptask/${name}`,
	baseBranch: "main",
	status: "available",
	createdAt: 1,
	updatedAt: 1,
})
const deferred = () => {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}
const setup = () => {
	const data = new Map<string, unknown>()
	const storage = {
		get: <T>(key: string) => data.get(key) as T | undefined,
		update: vi.fn(async (key: string, value: unknown) => {
			data.set(key, value)
		}),
	}
	const registry = new WorkspaceRegistry(storage)
	const provider = {
		context: { globalState: storage },
		cwd: "/repo",
		postMessageToWebview: vi.fn(async () => undefined),
		postStateToWebview: vi.fn(async () => undefined),
		removeBackgroundClineFromStack: vi.fn(() => true),
	}
	const manager = new ParallelManager(
		provider as unknown as ConstructorParameters<typeof ParallelManager>[0],
		registry,
	)
	vi.spyOn(manager, "broadcast").mockResolvedValue(undefined)
	const child = { taskId: "child" } as Task
	const run = deferred()
	vi.spyOn(Task, "create").mockReturnValue([child, run.promise])
	const parent = {
		taskId: "parent",
		cwd: "/repo",
		taskMode: "code",
		apiConfiguration: {},
		diffEnabled: false,
		enableCheckpoints: false,
		checkpointTimeout: 42,
	} as unknown as Task
	return { registry, storage, manager, provider, child, parent, run }
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe("transactional workspace ownership", () => {
	let dir: string
	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "deeptask-claim-"))
	})
	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})
	const registries = (dir: string) =>
		Array.from(
			{ length: 3 },
			() => new WorkspaceRegistry(new FileParallelStateStore({ filePath: path.join(dir, "state.json") })),
		)

	test("simultaneous windows cannot both claim the same workspace", async () => {
		const [a, b, c] = registries(dir)
		await a.register(entry("shared"))
		const claims = await Promise.all([a.claim("shared", "a"), b.claim("shared", "b"), c.claim("shared", "c")])
		expect(claims.filter(Boolean)).toHaveLength(1)
		await a.load(true)
		expect((await a.get("shared"))?.owner).toBe(claims.find(Boolean)?.owner)
	})

	test("simultaneous registrations and unrelated release compose", async () => {
		const [a, b, c] = registries(dir)
		await a.register(entry("old"))
		await a.claim("old", "owner")
		await Promise.all([a.release("old", "available", "owner"), b.register(entry("b")), c.register(entry("c"))])
		await a.load(true)
		expect(
			a
				.list()
				.map((ws) => ws.name)
				.sort(),
		).toEqual(["b", "c", "old"])
		expect((await a.get("old"))?.status).toBe("available")
	})

	test("late owner cleanup cannot release a replacement owner's claim", async () => {
		const [a, b] = registries(dir)
		await a.register(entry("shared"))
		await a.claim("shared", "first")
		await a.release("shared", "available", "first")
		await b.claim("shared", "second")
		await a.release("shared", "available", "first")
		expect((await a.get("shared"))?.owner).toBe("second")
		expect((await a.get("shared"))?.status).toBe("busy")
	})

	test("same-instance concurrent claims serialize without file storage", async () => {
		const { registry } = setup()
		await registry.register(entry("shared"))
		const claims = await Promise.all([registry.claim("shared", "a"), registry.claim("shared", "b")])
		expect(claims.filter(Boolean)).toHaveLength(1)
	})

	test("failed persistence rejects the caller but does not poison later mutations", async () => {
		const { registry, storage } = setup()
		storage.update.mockRejectedValueOnce(new Error("disk-full"))
		await expect(registry.register(entry("failed"))).rejects.toThrow("disk-full")
		await registry.register(entry("ok"))
		expect(registry.list().map((ws) => ws.name)).toEqual(["ok"])
	})

	test("incarnation guard is checked when queued cleanup executes", async () => {
		const { registry } = setup()
		await registry.register(entry("child"))
		await registry.claim("child", "task:child")
		let original = true
		const cleanup = registry.releaseOwnedBy("task:child", () => original)
		original = false
		await cleanup
		expect((await registry.get("child"))?.status).toBe("busy")
	})
})

describe("child settlement ownership", () => {
	test("done waits for dispatch release and clears task-created workspaces only", async () => {
		const { registry, manager, parent, run } = setup()
		for (const name of ["assigned", "relocated", "other"]) await registry.register(entry(name))
		await registry.claim("assigned", "dispatch:parent")
		await registry.claim("relocated", "task:child")
		await registry.claim("other", "task:other")
		const entered = deferred()
		const gate = deferred()
		const originalRelease = registry.release.bind(registry)
		vi.spyOn(registry, "release").mockImplementationOnce(async (...args) => {
			entered.resolve()
			await gate.promise
			await originalRelease(...args)
		})
		const spawned = manager.spawn(parent, { label: "child", task: "test", workspaceName: "assigned" })
		let done = false
		void spawned.done.then(() => {
			done = true
		})
		run.resolve()
		await entered.promise
		expect(done).toBe(false)
		gate.resolve()
		await spawned.done
		expect((await registry.get("assigned"))?.status).toBe("available")
		expect((await registry.get("relocated"))?.status).toBe("available")
		expect((await registry.get("other"))?.owner).toBe("task:other")
	})

	test("old settlement cannot release workspaces after explicit resume", async () => {
		const { registry, manager, parent, run, provider } = setup()
		await registry.register(entry("assigned"))
		await registry.claim("assigned", "dispatch:parent")
		const spawned = manager.spawn(parent, { label: "child", task: "test", workspaceName: "assigned" })
		manager.markSessionRunning("child", { taskId: "child" } as Task)
		run.resolve()
		await spawned.done
		expect((await registry.get("assigned"))?.status).toBe("busy")
		expect(provider.removeBackgroundClineFromStack).not.toHaveBeenCalled()
		expect(manager.getSession("child")?.info.status).toBe("running")
		expect(manager.getSession("child")?.info.endedAt).toBeUndefined()
	})

	test("release failure remains visible without losing the final result", async () => {
		const { registry, manager, parent, run } = setup()
		vi.spyOn(registry, "releaseOwnedBy").mockRejectedValue(new Error("storage unavailable"))
		const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
		const spawned = manager.spawn(parent, { label: "child", task: "test" })
		manager.getSession("child")?.messages.push({ ts: 1, type: "say", say: "completion_result", text: "complete" })
		run.resolve()
		await spawned.done
		expect(manager.getSession("child")?.info.result).toBe("complete")
		expect(manager.getSession("child")?.info.error).toContain("Workspace release failed")
		expect(logged).toHaveBeenCalled()
	})
})
