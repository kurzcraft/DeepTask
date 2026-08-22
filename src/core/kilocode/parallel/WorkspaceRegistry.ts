/**
 * WorkspaceRegistry - persisted registry of parallel agent workspaces (kilocode_change - new file)
 *
 * Tracks every git worktree workspace created for parallel agents so that:
 * - models can query which workspaces are busy before dispatching (write-conflict prevention)
 * - each workspace can be exclusively claimed by one running subagent
 * - merge state (merged / conflicted) survives extension restarts
 */

import * as fs from "fs"
import * as path from "path"
import type { ParallelWorkspace } from "@roo-code/types"

const STORAGE_KEY = "parallelWorkspaceRegistry"

export interface WorkspaceStorage {
	/** Accepts both sync (vscode Memento) and async storages. */
	get<T>(key: string, defaultValue?: T): T | undefined | Promise<T | undefined>
	update<T>(key: string, value: T): unknown
}

export class WorkspaceRegistry {
	private workspaces: Map<string, ParallelWorkspace> = new Map()
	private loaded = false

	constructor(private readonly storage: WorkspaceStorage) {}

	private async ensureLoaded(): Promise<void> {
		if (this.loaded) {
			return
		}
		try {
			const stored = await this.storage.get<ParallelWorkspace[]>(STORAGE_KEY, [])
			for (const ws of stored ?? []) {
				this.workspaces.set(ws.name, ws)
			}
		} catch (error) {
			console.error("[WorkspaceRegistry] failed to load registry:", error)
		}
		this.loaded = true
	}

	private async persist(): Promise<void> {
		try {
			await this.storage.update(STORAGE_KEY, [...this.workspaces.values()])
		} catch (error) {
			console.error("[WorkspaceRegistry] failed to persist registry:", error)
		}
	}

	async load(): Promise<void> {
		await this.ensureLoaded()
	}

	list(): ParallelWorkspace[] {
		return [...this.workspaces.values()].sort((a, b) => b.createdAt - a.createdAt)
	}

	async get(name: string): Promise<ParallelWorkspace | undefined> {
		await this.ensureLoaded()
		return this.workspaces.get(name)
	}

	isBusy(name: string): boolean {
		const ws = this.workspaces.get(name)
		return ws?.status === "busy"
	}

	async register(entry: ParallelWorkspace): Promise<void> {
		await this.ensureLoaded()
		this.workspaces.set(entry.name, entry)
		await this.persist()
	}

	/** Try to exclusively claim a workspace for an owner. Returns false when already busy. */
	async claim(name: string, owner: string): Promise<ParallelWorkspace | undefined> {
		await this.ensureLoaded()
		const ws = this.workspaces.get(name)
		if (!ws) {
			return undefined
		}
		if (ws.status === "busy") {
			return undefined
		}
		const updated: ParallelWorkspace = { ...ws, status: "busy", owner, updatedAt: Date.now() }
		this.workspaces.set(name, updated)
		await this.persist()
		return updated
	}

	async release(name: string, status: ParallelWorkspace["status"] = "available"): Promise<void> {
		await this.ensureLoaded()
		const ws = this.workspaces.get(name)
		if (!ws) {
			return
		}
		this.workspaces.set(name, { ...ws, status, owner: undefined, updatedAt: Date.now() })
		await this.persist()
	}

	async mark(name: string, status: ParallelWorkspace["status"], extra?: Partial<ParallelWorkspace>): Promise<void> {
		await this.ensureLoaded()
		const ws = this.workspaces.get(name)
		if (!ws) {
			return
		}
		this.workspaces.set(name, { ...ws, ...extra, status, updatedAt: Date.now() })
		await this.persist()
	}

	async remove(name: string): Promise<void> {
		await this.ensureLoaded()
		this.workspaces.delete(name)
		await this.persist()
	}

	/** Drop entries whose worktree directory no longer exists on disk. */
	async prune(): Promise<string[]> {
		await this.ensureLoaded()
		const removed: string[] = []
		for (const [name, ws] of [...this.workspaces.entries()]) {
			if (!fs.existsSync(path.resolve(ws.path))) {
				this.workspaces.delete(name)
				removed.push(name)
			}
		}
		if (removed.length > 0) {
			await this.persist()
		}
		return removed
	}
}
