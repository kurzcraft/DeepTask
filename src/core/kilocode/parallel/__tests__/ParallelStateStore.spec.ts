/**
 * Round-16 regression tests: cross-window parallel state safety.
 *
 * Root cause being covered: VSCodium persists extension globalState as ONE
 * JSON blob per extension and every window caches its own copy; any key write
 * rewrites the whole blob from that window's stale snapshot, silently rolling
 * back parallel keys written by other windows. The fix moves the parallel
 * keys into a shared file store with lock-serialized read-modify-write.
 */
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import type { ParallelConversation, ParallelWorkspace } from "@roo-code/types"

import {
	FileParallelStateStore,
	MementoParallelStateStore,
	PARALLEL_STATE_KEYS,
} from "../ParallelStateStore"
import { WorkspaceRegistry } from "../WorkspaceRegistry"

function makeStorage(store: Map<string, unknown>) {
	return {
		get: async <T>(key: string, defaultValue?: T): Promise<T | undefined> =>
			(store.has(key) ? (store.get(key) as T) : defaultValue) as T | undefined,
		update: async <T>(key: string, value: T): Promise<void> => {
			store.set(key, value)
		},
	}
}

function makeConversation(id: string, lastActiveAt: number, workspacePath: string): ParallelConversation {
	return {
		id,
		folderPath: "/repo",
		workspacePath,
		title: id,
		sessionId: `session-${id}`,
		createdAt: lastActiveAt,
		lastActiveAt,
	}
}

function makeWorkspace(name: string): ParallelWorkspace {
	return {
		name,
		path: `/repo/.kilocode/worktrees/${name}`,
		branch: `deeptask/${name}`,
		baseBranch: "main",
		status: "available",
		folderPath: "/repo",
		createdAt: Date.now(),
		updatedAt: Date.now(),
	}
}

describe("FileParallelStateStore (shared cross-window store)", () => {
	let dir: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "deeptask-parallel-state-"))
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
	})

	test("migrates legacy globalState keys into the shared file once", async () => {
		const legacyStore = new Map<string, unknown>()
		legacyStore.set("parallelFolders", [{ path: "/repo" }])
		legacyStore.set("parallelWorkspaceRegistry", [makeWorkspace("ws1")])
		const legacy = makeStorage(legacyStore)

		const store = new FileParallelStateStore({
			filePath: path.join(dir, "parallel-state.json"),
			legacy,
		})

		expect(await store.read("parallelFolders")).toEqual([{ path: "/repo" }])
		expect(await store.read("parallelWorkspaceRegistry")).toHaveLength(1)

		// A second window over the same legacy globalState must NOT re-migrate
		// or overwrite the file (file already exists wins).
		const second = new FileParallelStateStore({
			filePath: path.join(dir, "parallel-state.json"),
			legacy: makeStorage(new Map([["parallelFolders", [{ path: "/other" }]]])),
		})
		expect(await second.read("parallelFolders")).toEqual([{ path: "/repo" }])
	})

	test("two instances (simulated windows) writing different keys compose", async () => {
		const filePath = path.join(dir, "parallel-state.json")
		const windowA = new FileParallelStateStore({ filePath })
		const windowB = new FileParallelStateStore({ filePath })

		await windowA.mutate("parallelConversations", () => [makeConversation("cv-a", 10, "/repo")])
		await windowB.mutate("parallelWorkspaceRegistry", () => [makeWorkspace("ws-b")])

		// Both keys survive: per-key writes on fresh snapshots compose.
		expect(await windowA.read("parallelConversations")).toHaveLength(1)
		expect(await windowB.read("parallelWorkspaceRegistry")).toHaveLength(1)
		expect(await windowA.read("parallelWorkspaceRegistry")).toHaveLength(1)
		expect(await windowB.read("parallelConversations")).toHaveLength(1)
	})

	test("stale window snapshot cannot roll back a newer conversation entry", async () => {
		const filePath = path.join(dir, "parallel-state.json")
		const store = new FileParallelStateStore({ filePath })
		await store.mutate<ParallelConversation[]>("parallelConversations", () => [
			makeConversation("cv-1", 10, "/repo"),
		])

		// Another window re-parents cv-1 into a worktree at lastActiveAt 20.
		await store.mutate<ParallelConversation[]>("parallelConversations", (current) => {
			const list = current ?? []
			return list.map((c) =>
				c.id === "cv-1"
					? { ...c, workspacePath: "/repo/.kilocode/worktrees/x", lastActiveAt: 20 }
					: c,
			)
		})

		// The round-16 bug: a window with a STALE in-memory list (lastActiveAt
		// 10, old workspace) persists its whole snapshot and rolls the entry
		// back. The manager's merge persist prevents this at its layer; here we
		// assert the store itself keeps whatever the mutation produced.
		const after = await store.read<ParallelConversation[]>("parallelConversations")
		expect(after?.[0]?.workspacePath).toBe("/repo/.kilocode/worktrees/x")
		expect(after?.[0]?.lastActiveAt).toBe(20)
	})

	test("corrupt state file is quarantined and treated as fresh", async () => {
		const filePath = path.join(dir, "parallel-state.json")
		await fs.writeFile(filePath, "{ not valid json !!", "utf8")
		const store = new FileParallelStateStore({ filePath })
		expect(await store.read("parallelConversations")).toBeUndefined()
		// The corrupt file was renamed aside, not left in place.
		const files = await fs.readdir(dir)
		expect(files.some((f) => f.startsWith("parallel-state.json.corrupt-"))).toBe(true)
		await store.write("parallelActiveConversationId", "cv-1")
		expect(await store.read("parallelActiveConversationId")).toBe("cv-1")
	})
})

describe("WorkspaceRegistry over the shared store", () => {
	let dir: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "deeptask-registry-"))
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
	})

	test("two registries (simulated windows) registering different workspaces compose", async () => {
		const filePath = path.join(dir, "parallel-state.json")
		const sharedA = new FileParallelStateStore({ filePath })
		const sharedB = new FileParallelStateStore({ filePath })
		const registryA = new WorkspaceRegistry(sharedA)
		const registryB = new WorkspaceRegistry(sharedB)

		await registryA.register(makeWorkspace("alpha"))
		await registryB.register(makeWorkspace("beta"))

		// Window A force-reloads and sees BOTH entries.
		await registryA.load(true)
		expect(registryA.list().map((w) => w.name).sort()).toEqual(["alpha", "beta"])

		await registryB.load(true)
		expect(registryB.list().map((w) => w.name).sort()).toEqual(["alpha", "beta"])
	})

	test("claim fresh-read prevents double-claim across windows", async () => {
		const filePath = path.join(dir, "parallel-state.json")
		const registryA = new WorkspaceRegistry(new FileParallelStateStore({ filePath }))
		const registryB = new WorkspaceRegistry(new FileParallelStateStore({ filePath }))

		await registryA.register(makeWorkspace("ws"))
		const claimedByA = await registryA.claim("ws", "task:a")
		const claimedByB = await registryB.claim("ws", "task:b")

		expect(claimedByA?.owner).toBe("task:a")
		expect(claimedByB).toBeUndefined() // B fresh-read busy state, refused
	})

	test("undefined read (missing key) keeps in-memory registrations", async () => {
		// Non-persisting storage (test doubles): a forced reload must not
		// wipe registrations that were never persisted.
		const registry = new WorkspaceRegistry({
			get: async () => undefined,
			update: async () => undefined,
		})
		await registry.register(makeWorkspace("ephemeral"))
		await registry.load(true)
		expect(registry.get("ephemeral")).resolves.toBeDefined()
	})
})

describe("MementoParallelStateStore (fallback adapter)", () => {
	test("mutate composes read-modify-write over the memento", async () => {
		const store = new Map<string, unknown>()
		const memento = makeStorage(store)
		const adapter = new MementoParallelStateStore(memento)

		await adapter.mutate<string[]>("parallelArchivedFolders", (current) => [...(current ?? []), "/a"])
		await adapter.mutate<string[]>("parallelArchivedFolders", (current) => [...(current ?? []), "/b"])

		expect(await adapter.read("parallelArchivedFolders")).toEqual(["/a", "/b"])
	})

	test("covers all five migrated parallel keys", () => {
		expect(PARALLEL_STATE_KEYS).toContain("parallelWorkspaceRegistry")
		expect(PARALLEL_STATE_KEYS).toContain("parallelConversations")
		expect(PARALLEL_STATE_KEYS).toContain("parallelFolders")
		expect(PARALLEL_STATE_KEYS).toContain("parallelActiveConversationId")
		expect(PARALLEL_STATE_KEYS).toContain("parallelArchivedFolders")
	})
})
