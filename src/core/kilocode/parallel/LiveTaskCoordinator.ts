/**
 * Cross-window live-task coordinator (kilocode_change - new file)
 *
 * Each VS Code / VSCodium window runs its own extension host. Running Task
 * instances therefore cannot be shared in memory. This coordinator persists a
 * heartbeat file in globalStorage so occupancy, new-task lists, and "keep
 * inference alive while any window exists" decisions are visible to every
 * window of the same user profile.
 */

import { randomUUID } from "crypto"
import * as fs from "fs"
import * as path from "path"

export interface LiveTaskSnapshot {
	taskId: string
	cwd: string
	conversationId?: string
	title?: string
	abort: boolean
	abandoned: boolean
	updatedAt: number
}

export interface LiveWindowSnapshot {
	windowId: string
	pid: number
	updatedAt: number
	tasks: LiveTaskSnapshot[]
}

export interface LiveTaskFile {
	windows: LiveWindowSnapshot[]
}

export interface LiveTaskCoordinatorOptions {
	storageDir: string
	windowId?: string
	heartbeatMs?: number
	staleMs?: number
	now?: () => number
}

const FILE_NAME = "parallel-live-tasks.json"
const DEFAULT_HEARTBEAT_MS = 2000
const DEFAULT_STALE_MS = 8000

export class LiveTaskCoordinator {
	readonly windowId: string
	private readonly filePath: string
	private readonly heartbeatMs: number
	private readonly staleMs: number
	private readonly now: () => number
	private readonly localTasks = new Map<string, LiveTaskSnapshot>()
	private timer?: NodeJS.Timeout
	private watcher?: fs.FSWatcher
	private disposed = false
	private writeChain: Promise<void> = Promise.resolve()
	private listeners = new Set<() => void>()

	constructor(options: LiveTaskCoordinatorOptions) {
		this.windowId = options.windowId ?? randomUUID()
		this.filePath = path.join(options.storageDir, FILE_NAME)
		this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
		this.staleMs = options.staleMs ?? DEFAULT_STALE_MS
		this.now = options.now ?? Date.now
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	start(): void {
		if (this.disposed || this.timer) {
			return
		}
		void this.flush()
		this.timer = setInterval(() => {
			void this.flush()
		}, this.heartbeatMs)
		this.timer.unref?.()
		this.watch()
	}

	upsertTask(task: Omit<LiveTaskSnapshot, "updatedAt">): Promise<void> {
		this.localTasks.set(task.taskId, { ...task, updatedAt: this.now() })
		return this.flush()
	}

	removeTask(taskId: string): Promise<void> {
		if (this.localTasks.delete(taskId)) {
			return this.flush()
		}
		return Promise.resolve()
	}

	listLocalTasks(): LiveTaskSnapshot[] {
		return [...this.localTasks.values()]
	}

	listRemoteTasks(): LiveTaskSnapshot[] {
		return this.readFile()
			.windows.filter((window) => window.windowId !== this.windowId && !this.isStale(window))
			.flatMap((window) => window.tasks.filter((task) => !task.abort && !task.abandoned))
	}

	listAllLiveTasks(): LiveTaskSnapshot[] {
		const byId = new Map<string, LiveTaskSnapshot>()
		for (const task of this.listRemoteTasks()) {
			byId.set(task.taskId, task)
		}
		for (const task of this.localTasks.values()) {
			if (!task.abort && !task.abandoned) {
				byId.set(task.taskId, task)
			}
		}
		return [...byId.values()]
	}

	isLiveElsewhere(taskId: string): boolean {
		return this.listRemoteTasks().some((task) => task.taskId === taskId)
	}

	hasAnyLiveTasks(): boolean {
		return this.listAllLiveTasks().length > 0
	}

	stopWatching(): void {
		this.disposed = true
		if (this.timer) {
			clearInterval(this.timer)
			this.timer = undefined
		}
		this.watcher?.close()
		this.watcher = undefined
	}

	async dispose(): Promise<void> {
		this.stopWatching()
		this.localTasks.clear()
		await this.flush()
	}

	private watch(): void {
		try {
			fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
			if (!fs.existsSync(this.filePath)) {
				fs.writeFileSync(this.filePath, JSON.stringify({ windows: [] }, null, 2))
			}
			this.watcher = fs.watch(this.filePath, () => {
				for (const listener of this.listeners) {
					listener()
				}
			})
		} catch (error) {
			console.warn("[LiveTaskCoordinator] failed to watch live-task file:", error)
		}
	}

	private isStale(window: LiveWindowSnapshot): boolean {
		return this.now() - window.updatedAt > this.staleMs
	}

	private readFile(): LiveTaskFile {
		try {
			const raw = fs.readFileSync(this.filePath, "utf8")
			const parsed = JSON.parse(raw) as LiveTaskFile
			if (!parsed || !Array.isArray(parsed.windows)) {
				return { windows: [] }
			}
			return parsed
		} catch {
			return { windows: [] }
		}
	}

	private flush(): Promise<void> {
		this.writeChain = this.writeChain
			.catch(() => undefined)
			.then(() => this.writeNow())
		return this.writeChain
	}

	private async writeNow(): Promise<void> {
		await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true })
		const current = this.readFile()
		const stamp = this.now()
		const others = current.windows.filter(
			(window) => window.windowId !== this.windowId && !this.isStale(window),
		)
		if (!this.disposed && this.localTasks.size > 0) {
			others.push({
				windowId: this.windowId,
				pid: process.pid,
				updatedAt: stamp,
				tasks: [...this.localTasks.values()].map((task) => ({ ...task, updatedAt: stamp })),
			})
		}
		const payload: LiveTaskFile = { windows: others }
		const tempPath = `${this.filePath}.${this.windowId}.tmp`
		await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2))
		await fs.promises.rename(tempPath, this.filePath)
	}
}
