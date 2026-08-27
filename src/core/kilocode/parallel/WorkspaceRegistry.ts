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

import { isParallelStateStorage, type ParallelStateStorage } from "./ParallelStateStore"

const STORAGE_KEY = "parallelWorkspaceRegistry"

export interface WorkspaceStorage {
	/** Accepts both sync (vscode Memento) and async storages. */
	get<T>(key: string, defaultValue?: T): T | undefined | Promise<T | undefined>
	update<T>(key: string, value: T): unknown
}

/**
 * Minimal per-key persistence contract the registry needs. Both Memento-style
 * storages and the shared file store implement it.
 */
export interface RegistryPersistence {
	load(force?: boolean): Promise<void>
	list(): ParallelWorkspace[]
}

export class WorkspaceRegistry implements RegistryPersistence {
	private workspaces: Map<string, ParallelWorkspace> = new Map()
	private loaded = false

	constructor(
		private readonly storage: WorkspaceStorage | ParallelStateStorage,
	) {}

	private isShared(): boolean {
		return isParallelStateStorage(this.storage)
	}

	private asShared(): ParallelStateStorage {
		return this.storage as ParallelStateStorage
	}

	/** Undefined = key absent (keep in-memory state); [] = genuinely empty. */
	private async readAll(): Promise<ParallelWorkspace[] | undefined> {
		if (this.isShared()) {
			return await this.asShared().read<ParallelWorkspace[]>(STORAGE_KEY)
		}
		return await (this.storage as WorkspaceStorage).get<ParallelWorkspace[] | undefined>(
			STORAGE_KEY,
			undefined,
		)
	}

	private async writeAll(next: Map<string, ParallelWorkspace>): Promise<void> {
		if (this.isShared()) {
			// Lock-protected read-modify-write: fresh file read, replace only
			// this key, atomic rename. Other windows' keys are untouched.
			await this.asShared().mutate(STORAGE_KEY, () => [...next.values()])
			return
		}
		await (this.storage as WorkspaceStorage).update(STORAGE_KEY, [...next.values()])
	}

	async load(force = false): Promise<void> {
		if (this.loaded && !force) {
			return
		}
		try {
			const stored = await this.readAll()
			if (stored !== undefined) {
				this.workspaces = new Map(stored.map((ws) => [ws.name, ws]))
			}
			// undefined (key absent / non-persisting storage): keep in-memory
			// state so a transient read miss cannot drop live registrations.
			this.loaded = true
		} catch (error) {
			console.error("[WorkspaceRegistry] failed to load registry:", error)
		}
	}

	list(): ParallelWorkspace[] {
		return [...this.workspaces.values()].sort((a, b) => b.createdAt - a.createdAt)
	}

	async get(name: string): Promise<ParallelWorkspace | undefined> {
		await this.load()
		return this.workspaces.get(name)
	}

	isBusy(name: string): boolean {
		const ws = this.workspaces.get(name)
		return ws?.status === "busy"
	}

	async register(entry: ParallelWorkspace): Promise<void> {
		await this.load(true) // fresh read so concurrent windows compose instead of clobber
		this.workspaces.set(entry.name, entry)
		await this.writeAll(this.workspaces)
	}

	/** Try to exclusively claim a workspace for an owner. Returns false when already busy. */
	async claim(name: string, owner: string): Promise<ParallelWorkspace | undefined> {
		await this.load(true) // fresh read so concurrent windows cannot double-claim
		const ws = this.workspaces.get(name)
		if (!ws) {
			return undefined
		}
		if (ws.status === "busy") {
			return undefined
		}
		const updated: ParallelWorkspace = { ...ws, status: "busy", owner, updatedAt: Date.now() }
		this.workspaces.set(name, updated)
		await this.writeAll(this.workspaces)
		return updated
	}

	async release(name: string, status: ParallelWorkspace["status"] = "available"): Promise<void> {
		await this.load(true)
		const ws = this.workspaces.get(name)
		if (!ws) {
			return
		}
		this.workspaces.set(name, { ...ws, status, owner: undefined, updatedAt: Date.now() })
		await this.writeAll(this.workspaces)
	}

	async mark(name: string, status: ParallelWorkspace["status"], extra?: Partial<ParallelWorkspace>): Promise<void> {
		await this.load(true)
		const ws = this.workspaces.get(name)
		if (!ws) {
			return
		}
		this.workspaces.set(name, { ...ws, ...extra, status, updatedAt: Date.now() })
		await this.writeAll(this.workspaces)
	}

	async remove(name: string): Promise<void> {
		await this.load(true)
		this.workspaces.delete(name)
		await this.writeAll(this.workspaces)
	}

	/** Drop entries whose worktree directory no longer exists on disk. */
	async prune(): Promise<string[]> {
		await this.load(true)
		const removed: string[] = []
		for (const [name, ws] of [...this.workspaces.entries()]) {
			if (!fs.existsSync(path.resolve(ws.path))) {
				this.workspaces.delete(name)
				removed.push(name)
			}
		}
		if (removed.length > 0) {
			await this.writeAll(this.workspaces)
		}
		return removed
	}
}
