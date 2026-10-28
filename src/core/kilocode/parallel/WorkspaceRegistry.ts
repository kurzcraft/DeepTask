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
	private mutationQueue: Promise<void> = Promise.resolve()

	constructor(private readonly storage: WorkspaceStorage | ParallelStateStorage) {}

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
		return await (this.storage as WorkspaceStorage).get<ParallelWorkspace[] | undefined>(STORAGE_KEY, undefined)
	}

	/** Read, validate and update inside the same inter-process transaction. */
	private mutate<T>(update: (current: Map<string, ParallelWorkspace>) => T): Promise<T> {
		const run = this.mutationQueue.then(async () => {
			let result!: T
			const apply = (stored: ParallelWorkspace[] | undefined): ParallelWorkspace[] => {
				const current = new Map(stored === undefined ? this.workspaces : stored.map((ws) => [ws.name, ws]))
				result = update(current)
				return [...current.values()]
			}
			let next: ParallelWorkspace[]
			if (this.isShared()) {
				next = await this.asShared().mutate<ParallelWorkspace[]>(STORAGE_KEY, apply)
			} else {
				next = apply(await this.readAll())
				await (this.storage as WorkspaceStorage).update(STORAGE_KEY, next)
			}
			this.workspaces = new Map(next.map((ws) => [ws.name, ws]))
			this.loaded = true
			return result
		})
		// Recover only the queue tail; the returned promise still reports failures.
		this.mutationQueue = run.then(
			() => undefined,
			() => undefined,
		)
		return run
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
		await this.mutate((current) => {
			current.set(entry.name, entry)
		})
	}

	/** Try to exclusively claim a workspace; return undefined when already busy. */
	async claim(name: string, owner: string): Promise<ParallelWorkspace | undefined> {
		return this.mutate((current) => {
			const ws = current.get(name)
			if (!ws || ws.status === "busy") return undefined
			const updated: ParallelWorkspace = { ...ws, status: "busy", owner, updatedAt: Date.now() }
			current.set(name, updated)
			return updated
		})
	}

	async release(
		name: string,
		status: ParallelWorkspace["status"] = "available",
		expectedOwner?: string,
		canRelease: () => boolean = () => true,
	): Promise<void> {
		await this.mutate((current) => {
			if (!canRelease()) return
			const ws = current.get(name)
			if (!ws || (expectedOwner !== undefined && (ws.owner !== expectedOwner || ws.status !== "busy"))) return
			current.set(name, { ...ws, status, owner: undefined, updatedAt: Date.now() })
		})
	}

	/** Release only claims still owned by the task that actually settled. */
	async releaseOwnedBy(owner: string, canRelease: () => boolean = () => true): Promise<void> {
		await this.mutate((current) => {
			if (!canRelease()) return
			for (const [name, ws] of current) {
				if (ws.status === "busy" && ws.owner === owner) {
					current.set(name, { ...ws, status: "available", owner: undefined, updatedAt: Date.now() })
				}
			}
		})
	}

	async mark(name: string, status: ParallelWorkspace["status"], extra?: Partial<ParallelWorkspace>): Promise<void> {
		await this.mutate((current) => {
			const ws = current.get(name)
			if (ws) current.set(name, { ...ws, ...extra, status, updatedAt: Date.now() })
		})
	}

	async remove(name: string): Promise<void> {
		await this.mutate((current) => {
			current.delete(name)
		})
	}

	/** Recheck missing paths inside the transaction before removing entries. */
	async prune(): Promise<string[]> {
		await this.load(true)
		if (!this.list().some((ws) => !fs.existsSync(path.resolve(ws.path)))) return []
		return this.mutate((current) => {
			const removed: string[] = []
			for (const [name, ws] of current) {
				if (!fs.existsSync(path.resolve(ws.path))) {
					current.delete(name)
					removed.push(name)
				}
			}
			return removed
		})
	}
}
