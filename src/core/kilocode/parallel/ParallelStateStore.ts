/**
 * ParallelStateStore - cross-window shared file storage for parallel state (kilocode_change - new file)
 *
 * Why: VS Code persists extension `globalState` as ONE JSON blob per extension
 * (ItemTable key `<publisher>.<id>`), and every window's extension host keeps
 * its own in-memory copy of that whole blob. Any `globalState.update()` from
 * any window rewrites the ENTIRE blob from that window's possibly-stale cache,
 * so keys written by other windows (parallel workspaces, conversation
 * re-parenting, ...) are silently rolled back — last writer wins on data they
 * never intended to touch.
 *
 * Fix: move the parallel keys into a small dedicated JSON file under the
 * extension's globalStorage directory. Every read hits the file directly and
 * every mutation is a lock-serialized read-modify-write (proper-lockfile +
 * temp-file + atomic rename), so concurrent windows compose instead of
 * clobbering each other.
 */

import * as fs from "fs/promises"
import * as path from "path"
import * as lockfile from "proper-lockfile"

/** Keys migrated out of the globalState blob into the shared file. */
export const PARALLEL_STATE_KEYS = [
	"parallelFolders",
	"parallelConversations",
	"parallelActiveConversationId",
	"parallelArchivedFolders",
	"parallelWorkspaceRegistry",
] as const

export type ParallelStateKey = (typeof PARALLEL_STATE_KEYS)[number]

/** Storage interface used by WorkspaceRegistry / ParallelManager. */
export interface ParallelStateStorage {
	read<T>(key: ParallelStateKey | string): Promise<T | undefined>
	write<T>(key: ParallelStateKey | string, value: T): Promise<void>
	mutate<T>(key: ParallelStateKey | string, fn: (current: T | undefined) => T): Promise<T>
}

/** Legacy minimal storage shape (globalState / test doubles). */
export interface WorkspaceStorageLike {
	get<T>(key: string, defaultValue?: T): T | undefined | Promise<T | undefined>
	update<T>(key: string, value: T): unknown
}

export function isParallelStateStorage(storage: unknown): storage is ParallelStateStorage {
	return (
		typeof storage === "object" &&
		storage !== null &&
		typeof (storage as ParallelStateStorage).read === "function" &&
		typeof (storage as ParallelStateStorage).mutate === "function" &&
		typeof (storage as ParallelStateStorage).write === "function"
	)
}

/**
 * Adapter over a Memento-style storage. Preserves the historical (per-window,
 * non-serialized) semantics; used as the fallback so existing tests and non
 * file-backed hosts keep working unchanged.
 */
export class MementoParallelStateStore implements ParallelStateStorage {
	constructor(private readonly storage: WorkspaceStorageLike) {}

	async read<T>(key: string): Promise<T | undefined> {
		return this.storage.get<T>(key, undefined)
	}

	async write<T>(key: string, value: T): Promise<void> {
		await this.storage.update(key, value)
	}

	async mutate<T>(key: string, fn: (current: T | undefined) => T): Promise<T> {
		const current = await this.storage.get<T>(key, undefined)
		const next = fn(current)
		await this.storage.update(key, next)
		return next
	}
}

interface FileStateShape {
	version: number
	state: Record<string, unknown>
}

const LOCK_OPTIONS: lockfile.LockOptions = {
	stale: 31000,
	update: 10000,
	realpath: false, // the file may not exist yet, which is acceptable
	retries: {
		retries: 5,
		factor: 2,
		minTimeout: 100,
		maxTimeout: 1000,
	},
} as lockfile.LockOptions

/**
 * File-backed store shared by every window of the extension host. All reads
 * are direct file reads (atomic rename guarantees a consistent snapshot), all
 * writes run under an inter-process advisory lock as read-modify-write so a
 * writer can never roll back keys it did not touch.
 */
export class FileParallelStateStore implements ParallelStateStorage {
	readonly filePath: string
	private readonly legacy?: WorkspaceStorageLike
	private migration?: Promise<void>

	constructor(params: { filePath: string; legacy?: WorkspaceStorageLike }) {
		this.filePath = params.filePath
		this.legacy = params.legacy
	}

	// ---------------------------------------------------------------- reading

	async read<T>(key: string): Promise<T | undefined> {
		await this.ensureMigrated()
		const raw = await this.readRaw()
		return raw?.state?.[key] as T | undefined
	}

	async write<T>(key: string, value: T): Promise<void> {
		await this.ensureMigrated()
		await this.withLock(async () => {
			const raw = await this.readRaw()
			await this.writeRaw({
				version: 1,
				state: { ...(raw?.state ?? {}), [key]: value },
			})
		})
	}

	async mutate<T>(key: string, fn: (current: T | undefined) => T): Promise<T> {
		await this.ensureMigrated()
		return this.withLock(async () => {
			const raw = await this.readRaw()
			const current = raw?.state?.[key] as T | undefined
			const next = fn(current)
			await this.writeRaw({
				version: 1,
				state: { ...(raw?.state ?? {}), [key]: next },
			})
			return next
		})
	}

	// ---------------------------------------------------------------- internals

	/** One-time import of the legacy globalState keys into the shared file. */
	private ensureMigrated(): Promise<void> {
		if (!this.migration) {
			this.migration = (async () => {
				const legacy = this.legacy
				if (!legacy) {
					return
				}
				try {
					await this.withLock(async () => {
						const existing = await this.readRaw()
						if (existing) {
							return // another window already migrated
						}
						const state: Record<string, unknown> = {}
						for (const key of PARALLEL_STATE_KEYS) {
							const value = await legacy.get<unknown>(key, undefined)
							if (value !== undefined) {
								state[key] = value
							}
						}
						await this.writeRaw({ version: 1, state })
					})
				} catch (error) {
					// Never block parallel features on migration failure.
					console.error("[ParallelStateStore] legacy migration failed:", error)
				}
			})()
		}
		return this.migration
	}

	private async withLock<T>(fn: () => Promise<T>): Promise<T> {
		await fs.mkdir(path.dirname(this.filePath), { recursive: true }).catch(() => undefined)
		const release = await lockfile.lock(this.filePath, {
			...LOCK_OPTIONS,
			onCompromised: (err) => {
				throw err
			},
		})
		try {
			return await fn()
		} finally {
			await release().catch(() => undefined)
		}
	}

	private async readRaw(): Promise<FileStateShape | undefined> {
		let text: string
		try {
			text = await fs.readFile(this.filePath, "utf8")
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (code === "ENOENT") {
				return undefined
			}
			throw error
		}
		try {
			const parsed = JSON.parse(text)
			if (parsed && typeof parsed === "object" && parsed.state && typeof parsed.state === "object") {
				return parsed as FileStateShape
			}
			throw new Error("unexpected parallel-state shape")
		} catch (error) {
			// Quarantine the corrupt file and start fresh rather than crash.
			const backup = `${this.filePath}.corrupt-${Date.now()}`
			console.error(`[ParallelStateStore] corrupt state file, quarantined to ${backup}:`, error)
			await fs.rename(this.filePath, backup).catch(() => undefined)
			return undefined
		}
	}

	private async writeRaw(state: FileStateShape): Promise<void> {
		const dir = path.dirname(this.filePath)
		await fs.mkdir(dir, { recursive: true })
		const tmp = path.join(
			dir,
			`.${path.basename(this.filePath)}.new_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`,
		)
		const serialized = JSON.stringify(state)
		await fs.writeFile(tmp, serialized, "utf8")
		// fsync the temp file so a crash right after rename cannot leave an
		// empty/truncated state file behind.
		const fd = await fs.open(tmp, "r+").catch(() => undefined)
		if (fd) {
			await fd.sync().catch(() => undefined)
			await fd.close().catch(() => undefined)
		}
		await fs.rename(tmp, this.filePath)
	}
}
