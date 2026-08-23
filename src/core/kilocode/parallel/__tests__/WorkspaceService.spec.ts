import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import simpleGit from "simple-git"

import { WorkspaceRegistry } from "../WorkspaceRegistry"
import { WorkspaceService } from "../WorkspaceService"

async function makeTempRepo(): Promise<string> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "deeptask-ws-"))
	const git = simpleGit(dir)
	await git.init()
	await git.addConfig("user.email", "test@example.com")
	await git.addConfig("user.name", "Test")
	await fs.promises.writeFile(path.join(dir, "a.txt"), "line1\nline2\n")
	await git.add(".")
	await git.commit("initial")
	// Ensure the default branch resolves to what the service detects.
	const branch = await git.revparse(["--abbrev-ref", "HEAD"])
	if (branch.trim() !== "main") {
		await git.branch(["-m", branch.trim(), "main"])
	}
	return dir
}

describe("WorkspaceService", () => {
	let repo: string
	let registry: WorkspaceRegistry
	let service: WorkspaceService

	beforeEach(async () => {
		repo = await makeTempRepo()
		registry = new WorkspaceRegistry({
			get: async (key: string) => undefined,
			update: async () => undefined,
		})
		service = new WorkspaceService(repo, registry)
	})

	test("create registers a worktree on its own branch from the base", async () => {
		const ws = await service.create({ name: "feature x!", description: "do things" })
		expect(ws.name).toBe("feature-x")
		expect(ws.branch).toBe("deeptask/feature-x")
		expect(ws.baseBranch).toBe("main")
		expect(fs.existsSync(ws.path)).toBe(true)

		const git = simpleGit(ws.path)
		expect((await git.revparse(["--abbrev-ref", "HEAD"])).trim()).toBe("deeptask/feature-x")
		expect(fs.existsSync(path.join(ws.path, "a.txt"))).toBe(true)
		expect(ws.folderPath).toBe(repo)
	})

	test("create records the requested parent folderPath", async () => {
		const ws = await service.create({ name: "owned", folderPath: repo })
		expect(ws.folderPath).toBe(repo)
	})

	test("create keeps the requested name and only suffixes numeric collisions", async () => {
		const first = await service.create({ name: "new" })
		expect(first.name).toBe("new")
		expect(first.branch).toBe("deeptask/new")
		expect(first.path).toBe(path.join(repo, ".kilocode", "worktrees", "new"))

		const second = await service.create({ name: "new" })
		expect(second.name).toBe("new-2")
		expect(second.branch).toBe("deeptask/new-2")
		expect(second.path).toBe(path.join(repo, ".kilocode", "worktrees", "new-2"))
	})

	test("create initializes git in a non-git folder", async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "deeptask-nongit-"))
		await fs.promises.writeFile(path.join(dir, "notes.txt"), "hello\n")
		const localRegistry = new WorkspaceRegistry({
			get: async () => undefined,
			update: async () => undefined,
		})
		const localService = new WorkspaceService(dir, localRegistry)
		const ws = await localService.create({ name: "first", folderPath: dir })
		expect(ws.name).toBe("first")
		expect(ws.branch).toBe("deeptask/first")
		expect(fs.existsSync(path.join(dir, ".git"))).toBe(true)
		expect(fs.existsSync(path.join(ws.path, "notes.txt"))).toBe(true)
		expect((await simpleGit(ws.path).revparse(["--abbrev-ref", "HEAD"])).trim()).toBe("deeptask/first")
	})

	test("fork creates another worktree under the same folder", async () => {
		const source = await service.create({ name: "source", folderPath: repo })
		const forked = await service.fork(source.name)
		expect(forked.folderPath).toBe(repo)
		expect(forked.name).toContain("source-fork")
		expect(forked.path).not.toBe(source.path)
		expect(fs.existsSync(forked.path)).toBe(true)
	})

	test("deleteWorkspace removes the worktree and registry entry", async () => {
		const ws = await service.create({ name: "gone", folderPath: repo })
		expect(fs.existsSync(ws.path)).toBe(true)
		await service.deleteWorkspace(ws.name)
		expect(await registry.get(ws.name)).toBeUndefined()
		expect(fs.existsSync(ws.path)).toBe(false)
	})

	test("deleteWorkspace force-deletes a busy workspace", async () => {
		const ws = await service.create({ name: "busy-delete", folderPath: repo })
		await service.claim("busy-delete", "agent")
		await service.deleteWorkspace(ws.name)
		expect(await registry.get(ws.name)).toBeUndefined()
		expect(fs.existsSync(ws.path)).toBe(false)
	})

	test("hydrateFromDisk re-registers Deeptask worktrees missing from the registry", async () => {
		const ws = await service.create({ name: "persisted", folderPath: repo })
		expect(fs.existsSync(ws.path)).toBe(true)
		await registry.remove(ws.name)
		expect(await registry.get(ws.name)).toBeUndefined()

		const added = await service.hydrateFromDisk()
		expect(added.map((entry) => entry.name)).toContain("persisted")
		expect((await registry.get("persisted"))?.path).toBe(ws.path)
		expect((await registry.get("persisted"))?.folderPath).toBe(repo)
	})

	test("create branches from the currently checked-out branch, not origin/HEAD", async () => {
		const git = simpleGit(repo)
		await git.checkoutLocalBranch("feature/local")
		await fs.promises.writeFile(path.join(repo, "local.txt"), "from-local\n")
		await git.add(".")
		await git.commit("local work")

		const ws = await service.create({ name: "from-local" })
		expect(ws.baseBranch).toBe("feature/local")
		expect(ws.branch).toBe("deeptask/from-local")
		expect(fs.existsSync(path.join(ws.path, "local.txt"))).toBe(true)
		expect((await simpleGit(ws.path).revparse(["--abbrev-ref", "HEAD"])).trim()).toBe("deeptask/from-local")
	})

	test("merge lands workspace commits on the base branch without dirtying state", async () => {
		const ws = await service.create({ name: "changes" })
		await fs.promises.writeFile(path.join(ws.path, "b.txt"), "new file\n")
		// Leave changes uncommitted to exercise the auto-commit path.
		const result = await service.merge({ name: "changes" })
		expect(result.ok).toBe(true)

		const root = simpleGit(repo)
		const status = await root.status()
		expect(status.isClean()).toBe(true)
		const blob = await root.show(["main:b.txt"])
		expect(blob).toBe("new file\n")
		expect((await registry.get("changes"))?.status).toBe("merged")
	})

	test("merge reports conflicts, aborts cleanly, andks the workspace conflicted", async () => {
		const ws = await service.create({ name: "conflicter" })
		await fs.promises.writeFile(path.join(ws.path, "a.txt"), "workspace version\n")
		const wtGit = simpleGit(ws.path)
		await wtGit.add(".")
		await wtGit.commit("workspace change")

		// Diverge the base branch.
		const root = simpleGit(repo)
		await fs.promises.writeFile(path.join(repo, "a.txt"), "main version\n")
		await root.add(".")
		await root.commit("main change")

		const result = await service.merge({ name: "conflicter" })
		expect(result.ok).toBe(false)
		expect(result.conflicts).toContain("a.txt")

		const rootStatus = await root.status()
		expect(rootStatus.isClean()).toBe(true)
		expect((await root.show(["main:a.txt"])).trim()).toBe("main version")
		expect((await registry.get("conflicter"))?.status).toBe("conflicted")
	})

	test("merge refuses a busy workspace to avoid write conflicts", async () => {
		await service.create({ name: "busy-ws" })
		await service.claim("busy-ws", "some-agent")
		const result = await service.merge({ name: "busy-ws" })
		expect(result.ok).toBe(false)
		expect(result.reason).toContain("busy")
	})

	test("merge lets the occupying owner leave and continue", async () => {
		await service.create({ name: "self-busy" })
		await service.claim("self-busy", "task:task-1")
		const result = await service.merge({ name: "self-busy", allowOwner: "task-1" })
		expect(result.ok).toBe(true)
	})

	test("merge with no new commits is a no-op success", async () => {
		await service.create({ name: "empty" })
		const result = await service.merge({ name: "empty" })
		expect(result.ok).toBe(true)
		expect(result.mergedCommits).toBe("0")
	})

	test("summaries include dirty file counts and busy state", async () => {
		await service.create({ name: "sum" })
		await service.claim("sum", "owner")
		await fs.promises.writeFile(path.join((await registry.get("sum"))!.path, "dirty.txt"), "x")
		const summaries = await service.summaries()
		const summary = summaries.find((s) => s.name === "sum")
		expect(summary?.status).toBe("busy")
		expect(summary?.owner).toBe("owner")
		expect(summary?.dirtyFiles).toBeGreaterThan(0)
	})
})
