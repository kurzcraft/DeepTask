/**
 * WorkspaceService - git worktree workspace operations for parallel agents (kilocode_change - new file)
 *
 * Conflict-safety rules:
 * - a workspace must be claimed (busy) before any agent writes to it
 * - merges never touch the user's checked-out branch state directly: when the
 *   base branch is checked out in the main worktree we merge in place only if
 *   that tree is clean, otherwise we merge through a temporary worktree of the
 *   base branch so the user's working copy is never disturbed
 * - conflicts abort cleanly and are reported back to the model with the
 *   conflicted file list so it can resolve them in the workspace worktree
 */

import * as fs from "fs"
import * as path from "path"
import simpleGit, { type SimpleGit } from "simple-git"
import type { ParallelWorkspace } from "@roo-code/types"

import { WorkspaceRegistry } from "./WorkspaceRegistry"

export interface WorkspaceSummary {
	name: string
	path: string
	branch: string
	baseBranch: string
	status: ParallelWorkspace["status"]
	owner?: string
	createdAt: number
	dirtyFiles: number
	aheadOfBase: number
}

export interface MergeResult {
	ok: boolean
	mergedCommits?: string
	conflicts?: string[]
	reason?: string
}

const WORKTREES_DIR = [".kilocode", "worktrees"]

export class WorkspaceService {
	constructor(
		private readonly projectRoot: string,
		private readonly registry: WorkspaceRegistry,
	) {}

	private git(dir: string = this.projectRoot): SimpleGit {
		return simpleGit(dir)
	}

	/** Resolves the main working tree so creating from a worktree still lands under the repo root. */
	private async gitRoot(): Promise<string> {
		try {
			const common = (await this.git().raw(["rev-parse", "--git-common-dir"])).trim().replace(/[\\/]+$/, "")
			if (common) {
				const gitDir = path.resolve(this.projectRoot, common)
				const marker = `${path.sep}.git`
				const idx = gitDir.lastIndexOf(marker)
				if (idx >= 0) {
					return gitDir.slice(0, idx)
				}
			}
		} catch {
			// fall through to show-toplevel
		}
		try {
			const root = (await this.git().raw(["rev-parse", "--show-toplevel"])).trim()
			return root || this.projectRoot
		} catch {
			return this.projectRoot
		}
	}

	private worktreePath(name: string): string {
		return path.join(this.projectRoot, ...WORKTREES_DIR, name)
	}

	static sanitizeName(input: string): string {
		const sanitized = input
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.replace(/-+/g, "-")
			.slice(0, 40)
		return sanitized || `workspace-${Date.now()}`
	}

	async detectDefaultBranch(): Promise<string> {
		const git = this.git()
		try {
			const current = (await git.raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim()
			if (current && current !== "HEAD") {
				return current
			}
		} catch {
			// detached HEAD or not a repo
		}
		try {
			const remoteHead = await git.raw(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
			const match = remoteHead.trim().match(/^origin\/(.+)$/)
			if (match) {
				return match[1]
			}
		} catch {
			// no remote HEAD configured
		}
		try {
			const branches = await git.branch()
			if (branches.all.includes("main")) return "main"
			if (branches.all.includes("master")) return "master"
		} catch {
			// ignore
		}
		return "HEAD"
	}

	private async isGitRepository(gitAtRoot: SimpleGit): Promise<boolean> {
		try {
			const inside = (await gitAtRoot.raw(["rev-parse", "--is-inside-work-tree"])).trim()
			return inside === "true"
		} catch {
			return false
		}
	}

	private async ensureGitRepository(repoRoot: string): Promise<SimpleGit> {
		const gitAtRoot = this.git(repoRoot)
		if (await this.isGitRepository(gitAtRoot)) {
			return gitAtRoot
		}
		await gitAtRoot.init()
		const userName = (await gitAtRoot.getConfig("user.name")).value
		const userEmail = (await gitAtRoot.getConfig("user.email")).value
		if (!userName) {
			await gitAtRoot.addConfig("user.name", "Deeptask")
		}
		if (!userEmail) {
			await gitAtRoot.addConfig("user.email", "deeptask@local")
		}
		const status = await gitAtRoot.status()
		const hasHead = Boolean(await gitAtRoot.raw(["rev-parse", "--verify", "HEAD"]).catch(() => ""))
		if (status.files.length > 0 || !hasHead) {
			try {
				await gitAtRoot.raw(["add", "-A"])
				await gitAtRoot.commit("chore: initialize repository for Deeptask workspaces")
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error)
				throw new Error(`Failed to initialize git in "${repoRoot}": ${detail}`)
			}
		}
		return gitAtRoot
	}

	private async uniqueWorkspaceName(repoRoot: string, baseName: string): Promise<{ name: string; path: string }> {
		let name = baseName
		let suffix = 2
		while (true) {
			const wtPath = path.join(repoRoot, ...WORKTREES_DIR, name)
			if (!(await this.registry.get(name)) && !fs.existsSync(wtPath)) {
				return { name, path: wtPath }
			}
			name = `${baseName}-${suffix}`
			suffix += 1
		}
	}

	async create(params: { name?: string; description?: string; folderPath?: string }): Promise<ParallelWorkspace> {
		const repoRoot = params.folderPath ?? (await this.gitRoot())
		const gitAtRoot = await this.ensureGitRepository(repoRoot)

		const currentBranch = (await gitAtRoot.raw(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD")).trim()
		const startPoint = currentBranch && currentBranch !== "HEAD" ? currentBranch : "HEAD"
		const baseBranch = startPoint === "HEAD" ? await this.detectDefaultBranch() : startPoint
		const baseName = WorkspaceService.sanitizeName(params.name || params.description || "workspace")
		const unique = await this.uniqueWorkspaceName(repoRoot, baseName)
		const name = unique.name
		const wtPath = unique.path

		const worktreesDir = path.join(repoRoot, ...WORKTREES_DIR)
		await fs.promises.mkdir(worktreesDir, { recursive: true })
		await this.ensureGitExclude(repoRoot)

		const branch = `deeptask/${name}`
		try {
			await gitAtRoot.raw(["worktree", "add", "-b", branch, wtPath, startPoint])
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error)
			throw new Error(
				`Failed to add git worktree "${name}" (branch ${branch} from ${startPoint}) at ${wtPath}: ${detail}`,
			)
		}

		const entry: ParallelWorkspace = {
			name,
			path: wtPath,
			branch,
			baseBranch: baseBranch === "HEAD" ? startPoint : baseBranch,
			status: "available",
			folderPath: params.folderPath ?? repoRoot,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		}
		await this.registry.register(entry)
		return entry
	}

	async claim(name: string, owner: string): Promise<ParallelWorkspace | undefined> {
		return this.registry.claim(name, owner)
	}

	async release(name: string, status: ParallelWorkspace["status"] = "available"): Promise<void> {
		await this.registry.release(name, status)
	}

	/**
	 * Register Deeptask worktrees that already exist on disk but are missing
	 * from the in-memory registry (e.g. after a window reload before create).
	 */
	async hydrateFromDisk(): Promise<ParallelWorkspace[]> {
		await this.registry.prune()
		const worktreesDir = path.join(this.projectRoot, ...WORKTREES_DIR)
		const added: ParallelWorkspace[] = []
		let dirents: fs.Dirent[]
		try {
			dirents = await fs.promises.readdir(worktreesDir, { withFileTypes: true })
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (code === "ENOENT") {
				return added
			}
			console.error("[WorkspaceService] failed to read worktrees directory:", error)
			return added
		}

		const existingPaths = new Set(this.registry.list().map((workspace) => path.resolve(workspace.path)))
		const baseBranch = await this.detectDefaultBranch()

		for (const dirent of dirents) {
			if (!dirent.isDirectory() || dirent.name.startsWith(".")) {
				continue
			}
			const wtPath = path.resolve(worktreesDir, dirent.name)
			if ((await this.registry.get(dirent.name)) || existingPaths.has(wtPath)) {
				continue
			}
			if (!fs.existsSync(path.join(wtPath, ".git"))) {
				continue
			}

			let branch = `deeptask/${dirent.name}`
			try {
				const current = (await this.git(wtPath).raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim()
				if (current && current !== "HEAD") {
					branch = current
				}
			} catch (error) {
				console.warn("[WorkspaceService] failed to read worktree branch:", error)
			}

			let createdAt = Date.now()
			try {
				createdAt = Math.floor((await fs.promises.stat(wtPath)).mtimeMs)
			} catch (error) {
				console.warn("[WorkspaceService] failed to stat worktree directory:", error)
			}

			const entry: ParallelWorkspace = {
				name: dirent.name,
				path: wtPath,
				branch,
				baseBranch,
				status: "available",
				folderPath: this.projectRoot,
				createdAt,
				updatedAt: Date.now(),
			}
			await this.registry.register(entry)
			existingPaths.add(wtPath)
			added.push(entry)
		}

		return added
	}

	async summaries(): Promise<WorkspaceSummary[]> {
		await this.registry.prune()
		const result: WorkspaceSummary[] = []
		for (const ws of this.registry.list()) {
			let dirtyFiles = 0
			let aheadOfBase = 0
			try {
				const wt = this.git(ws.path)
				const status = await wt.status()
				dirtyFiles = status.files.length
				const ahead = await wt.raw(["rev-list", "--count", `${ws.baseBranch}..HEAD`]).catch(() => "0")
				aheadOfBase = parseInt(ahead.trim(), 10) || 0
			} catch {
				// workspace dir missing or git failure; keep zeroed counters
			}
			result.push({
				name: ws.name,
				path: ws.path,
				branch: ws.branch,
				baseBranch: ws.baseBranch,
				status: ws.status,
				owner: ws.owner,
				createdAt: ws.createdAt,
				dirtyFiles,
				aheadOfBase,
			})
		}
		return result
	}

	async merge(params: { name: string; removeAfter?: boolean }): Promise<MergeResult> {
		const entry = await this.registry.get(params.name)
		if (!entry) {
			return { ok: false, reason: `Unknown workspace "${params.name}".` }
		}
		if (entry.status === "busy") {
			return {
				ok: false,
				reason: `Workspace "${params.name}" is busy (owner: ${entry.owner ?? "unknown"}). Wait for it to finish before merging.`,
			}
		}
		if (!fs.existsSync(entry.path)) {
			await this.registry.remove(entry.name)
			return { ok: false, reason: `Workspace directory no longer exists: ${entry.path}` }
		}

		const rootGit = this.git()
		const wtGit = this.git(entry.path)

		// Commit any pending work in the agent workspace so nothing is lost.
		try {
			const status = await wtGit.status()
			if (status.files.length > 0) {
				await wtGit.add("-A")
				await wtGit.commit(`chore: auto-commit parallel workspace ${entry.name} before merge`)
			}
		} catch (error) {
			return { ok: false, reason: `Failed to commit pending changes: ${String(error)}` }
		}

		let ahead = 0
		try {
			const aheadRaw = await wtGit.raw(["rev-list", "--count", `${entry.baseBranch}..HEAD`]).catch(() => "0")
			// simple-git exposes rev-list via raw(["rev-list", ...])
			ahead = parseInt(aheadRaw.trim(), 10) || 0
		} catch {
			ahead = 0
		}
		if (ahead === 0) {
			await this.registry.mark(entry.name, "merged")
			return { ok: true, mergedCommits: "0", reason: "Nothing to merge (no commits ahead of base branch)." }
		}

		// Decide merge location: merge in the main worktree only when the user
		// has the base branch checked out AND the tree is clean; otherwise use
		// a temporary worktree of the base branch to leave the user untouched.
		const rootStatus = await rootGit.status()
		const rootBranch = rootStatus.current ?? ""
		let mergeDir = this.projectRoot
		let tmpMergeDir: string | undefined
		if (rootBranch !== entry.baseBranch || rootStatus.files.length > 0) {
			tmpMergeDir = path.join(this.projectRoot, ...WORKTREES_DIR, `.tmp-merge-${Date.now().toString(36)}`)
			try {
				await rootGit.raw(["worktree", "add", "--detach", tmpMergeDir, entry.baseBranch])
				mergeDir = tmpMergeDir
			} catch (error) {
				return { ok: false, reason: `Failed to prepare merge worktree: ${String(error)}` }
			}
		}

		try {
			const mergeGit = this.git(mergeDir)
			await mergeGit.merge(["--no-ff", "--no-edit", entry.branch])
			// simple-git conflict parsing depends on git's output language, so
			// detect unmerged paths directly (locale-independent).
			const unmerged = await mergeGit.diff(["--name-only", "--diff-filter=U"])
			const conflictFiles = unmerged
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
			if (conflictFiles.length > 0) {
				throw new Error(`CONFLICT: ${conflictFiles.join(", ")}`)
			}
			const head = await mergeGit.revparse(["--short", "HEAD"])
			if (tmpMergeDir) {
				await rootGit.raw(["worktree", "remove", "--force", tmpMergeDir])
			}
			if (params.removeAfter) {
				await this.removeWorktree(entry.path)
			}
			await this.registry.mark(entry.name, "merged")
			return {
				ok: true,
				mergedCommits: String(ahead),
				reason: `Merged ${entry.branch} into ${entry.baseBranch} (${head.trim()}).`,
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			const conflicts: string[] = []
			const conflictMatch = message.match(/CONFLICT: (.*)/)
			if (conflictMatch) {
				conflicts.push(...conflictMatch[1].split(", ").filter((f) => f && f !== "?"))
			}
			try {
				const status = await this.git(mergeDir).status()
				for (const file of status.files) {
					if (file.index && file.index !== " " && file.index !== "?" && !conflicts.includes(file.path)) {
						conflicts.push(file.path)
					}
				}
			} catch {
				// status unavailable; fall through with parsed list
			}
			try {
				await this.git(mergeDir).merge(["--abort"])
			} catch {
				// merge already aborted or nothing to abort
			}
			if (tmpMergeDir) {
				try {
					await rootGit.raw(["worktree", "remove", "--force", tmpMergeDir])
				} catch {
					// best effort cleanup
				}
			}
			await this.registry.mark(entry.name, "conflicted")
			return {
				ok: false,
				conflicts: conflicts.length > 0 ? conflicts : undefined,
				reason: `Merge conflict while merging ${entry.branch} into ${entry.baseBranch}. The merge was aborted; resolve conflicts in the workspace worktree (${entry.path}), commit, then retry the merge. ${message}`,
			}
		}
	}

	async fork(sourceName: string): Promise<ParallelWorkspace> {
		const source = await this.registry.get(sourceName)
		if (!source) {
			throw new Error(`Unknown workspace "${sourceName}".`)
		}
		return this.create({
			name: `${source.name}-fork`,
			folderPath: source.folderPath ?? (await this.gitRoot()),
		})
	}

	async deleteWorkspace(name: string): Promise<void> {
		const entry = await this.registry.get(name)
		if (!entry) {
			throw new Error(`Unknown workspace "${name}".`)
		}
		if (entry.status === "busy") {
			await this.registry.release(name, "available")
		}
		await this.removeWorktree(entry.path)
		await this.registry.remove(name)
	}

	async removeWorktree(worktreePath: string): Promise<void> {
		const repoRoot = await this.gitRoot()
		await this.git(repoRoot)
			.raw(["worktree", "remove", "--force", worktreePath])
			.catch(() => undefined)
		try {
			await fs.promises.rm(worktreePath, { recursive: true, force: true })
		} catch (error) {
			console.warn("[WorkspaceService] failed to remove leftover worktree directory:", error)
		}
	}

	private async ensureGitExclude(repoRoot: string = this.projectRoot): Promise<void> {
		const entry = ".kilocode/worktrees/"
		try {
			const gitDir = path.join(repoRoot, ".git")
			const stat = await fs.promises.stat(gitDir)
			const resolved = stat.isDirectory()
				? gitDir
				: path.resolve(
						path.dirname(gitDir),
						fs
							.readFileSync(gitDir, "utf-8")
							.match(/^gitdir:\s*(.+)$/m)?.[1]
							?.trim() ?? "",
						"..",
						"..",
					)
			const excludePath = path.join(resolved, "info", "exclude")
			await fs.promises.mkdir(path.dirname(excludePath), { recursive: true })
			const content = fs.existsSync(excludePath) ? await fs.promises.readFile(excludePath, "utf-8") : ""
			if (!content.includes(entry)) {
				await fs.promises.appendFile(
					excludePath,
					`${content.endsWith("\n") || content === "" ? "" : "\n"}\n# Deeptask parallel agent worktrees\n${entry}\n`,
				)
			}
		} catch (error) {
			console.warn("[WorkspaceService] failed to update git exclude:", error)
		}
	}
}
