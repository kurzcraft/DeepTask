// kilocode_change - new file
import fs from "fs/promises"
import os from "os"
import path from "path"

import { Package } from "../../shared/package"

export const RUNTIME_SENSOR_DIR_NAME = "deeptask-runtime-sensor"
export const RUNTIME_SENSOR_LATEST_FILE = "latest.json"
export const RUNTIME_SENSOR_EVENTS_FILE = "events.jsonl"
export const RUNTIME_SENSOR_GRAY_FILE = "gray.json"
export const DEFAULT_INTERVAL_MS = 15_000
export const DEFAULT_THROTTLE_MS = 1_000
export const DEFAULT_MAX_EVENTS = 200
export const DEFAULT_MAX_ERROR_CHARS = 1_500
export const GRAY_KINDS = [
	"blank",
	"missing-root",
	"unhydrated",
	"error",
	"unhandledrejection",
	"pagehide",
	"freeze",
	"unload",
] as const

export type RuntimeSensorSource = "host" | "webview"

export interface RuntimeSensorHostMetrics {
	rssMb: number
	heapUsedMb: number
	heapTotalMb: number
	externalMb: number
	arrayBuffersMb: number
	viewVisible?: boolean
	renderContext?: string
	taskId?: string
	stackLength?: number
	messageCount?: number
}

export interface RuntimeSensorWebviewMetrics {
	heapUsedMb?: number
	heapTotalMb?: number
	hydrated?: boolean
	visibility?: string
	hidden?: boolean
	hasRoot?: boolean
	rootChildCount?: number
}

export interface RuntimeSensorError {
	type: string
	message: string
	stack?: string
}

export interface RuntimeSensorSnapshot {
	ts: string
	source: RuntimeSensorSource
	kind: string
	pid: number
	version: string
	host?: RuntimeSensorHostMetrics
	webview?: RuntimeSensorWebviewMetrics
	error?: RuntimeSensorError
}

export interface RuntimeSensorHostState {
	viewVisible?: boolean
	renderContext?: string
	taskId?: string
	stackLength?: number
	messageCount?: number
}

export interface RuntimeSensorWriter {
	writeLatest(json: string): Promise<void>
	replaceEvents(jsonl: string): Promise<void>
	writeGray?(json: string): Promise<void>
}

export interface RuntimeSensorOptions {
	intervalMs?: number
	throttleMs?: number
	maxEvents?: number
	now?: () => number
	enabled?: boolean
}

export function bytesToMb(bytes: number): number {
	return Math.round((bytes / 1024 / 1024) * 100) / 100
}

export function clipText(value: string | undefined, max = DEFAULT_MAX_ERROR_CHARS): string | undefined {
	if (!value) {
		return undefined
	}

	return value.length <= max ? value : `${value.slice(0, max)}…`
}

export function defaultSensorDirectories(globalStoragePath?: string, workspacePath?: string): string[] {
	const dirs = [path.join(os.tmpdir(), RUNTIME_SENSOR_DIR_NAME)]

	if (globalStoragePath) {
		dirs.push(path.join(globalStoragePath, RUNTIME_SENSOR_DIR_NAME))
	}

	if (workspacePath) {
		dirs.push(path.join(workspacePath, "EXTRA", "output", RUNTIME_SENSOR_DIR_NAME))
	}

	return dirs
}

export function createFileWriter(directories: string[]): RuntimeSensorWriter {
	let ready: Promise<void> | undefined

	const ensure = () => {
		ready ??= Promise.all(directories.map((dir) => fs.mkdir(dir, { recursive: true }))).then(() => undefined)
		return ready
	}

	return {
		async writeLatest(json: string) {
			await ensure()
			await Promise.all(
				directories.map((dir) => fs.writeFile(path.join(dir, RUNTIME_SENSOR_LATEST_FILE), json, "utf8")),
			)
		},
		async replaceEvents(jsonl: string) {
			await ensure()
			await Promise.all(
				directories.map((dir) => fs.writeFile(path.join(dir, RUNTIME_SENSOR_EVENTS_FILE), jsonl, "utf8")),
			)
		},
		async writeGray(json: string) {
			await ensure()
			await Promise.all(
				directories.map((dir) => fs.writeFile(path.join(dir, RUNTIME_SENSOR_GRAY_FILE), json, "utf8")),
			)
		},
	}
}

export function collectHostMetrics(state: RuntimeSensorHostState): RuntimeSensorHostMetrics {
	const mem = process.memoryUsage()

	return {
		rssMb: bytesToMb(mem.rss),
		heapUsedMb: bytesToMb(mem.heapUsed),
		heapTotalMb: bytesToMb(mem.heapTotal),
		externalMb: bytesToMb(mem.external),
		arrayBuffersMb: bytesToMb(mem.arrayBuffers ?? 0),
		viewVisible: state.viewVisible,
		renderContext: state.renderContext,
		taskId: state.taskId,
		stackLength: state.stackLength,
		messageCount: state.messageCount,
	}
}

export function isGrayKind(kind: string): boolean {
	return (GRAY_KINDS as readonly string[]).includes(kind)
}

export function classifyWebviewGray(webview?: RuntimeSensorWebviewMetrics): string | undefined {
	if (!webview) {
		return undefined
	}

	if (webview.hasRoot === false) {
		return "missing-root"
	}

	if (webview.hydrated === true && webview.hasRoot === true && webview.rootChildCount === 0) {
		return "blank"
	}

	return undefined
}

export class RuntimeSensor {
	private intervalId?: ReturnType<typeof setInterval>
	private disposed = false
	private lastWriteAt = 0
	private writeChain: Promise<void> = Promise.resolve()
	private events: string[] = []
	private previousSnapshot?: RuntimeSensorSnapshot

	constructor(
		private readonly writer: RuntimeSensorWriter,
		private readonly getHostState: () => RuntimeSensorHostState,
		private readonly options: RuntimeSensorOptions = {},
	) {}

	get isDisposed(): boolean {
		return this.disposed
	}

	start(): void {
		if (this.intervalId || this.disposed || this.options.enabled === false) {
			return
		}

		void this.record("start", undefined, true)
		this.intervalId = setInterval(() => {
			void this.record("tick")
		}, this.options.intervalMs ?? DEFAULT_INTERVAL_MS)
		this.intervalId.unref?.()
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId)
			this.intervalId = undefined
		}
	}

	dispose(): void {
		if (this.disposed) {
			return
		}

		this.disposed = true
		this.stop()
	}

	record(kind: string, extra?: Partial<RuntimeSensorSnapshot>, force = false): Promise<void> {
		if (this.disposed || this.options.enabled === false) {
			return Promise.resolve()
		}

		const now = (this.options.now ?? Date.now)()
		const throttleMs = this.options.throttleMs ?? DEFAULT_THROTTLE_MS

		if (!force && now - this.lastWriteAt < throttleMs) {
			return Promise.resolve()
		}

		this.lastWriteAt = now
		const snapshot = this.buildSnapshot(kind, extra)
		const json = `${JSON.stringify(snapshot)}\n`
		this.writeChain = this.writeChain.then(() => this.persist(snapshot, json)).catch(() => undefined)
		return this.writeChain
	}

	ingestWebview(values: Record<string, unknown> | undefined): Promise<void> {
		const error = isSensorError(values?.error) ? values.error : undefined
		const webview = isWebviewMetrics(values?.webview) ? values.webview : undefined
		const kind = typeof values?.kind === "string" && values.kind ? values.kind : "webview"
		const classified = classifyWebviewGray(webview)
		const shouldReclassify = kind === "tick" || kind === "visibility" || kind === "webview"
		const effectiveKind = isGrayKind(kind) ? kind : shouldReclassify ? (classified ?? kind) : kind

		return this.record(
			effectiveKind,
			{
				source: "webview",
				webview,
				error,
			},
			Boolean(error) || isGrayKind(effectiveKind) || Boolean(classified),
		)
	}

	private buildSnapshot(kind: string, extra?: Partial<RuntimeSensorSnapshot>): RuntimeSensorSnapshot {
		return {
			ts: new Date((this.options.now ?? Date.now)()).toISOString(),
			source: extra?.source ?? "host",
			kind,
			pid: process.pid,
			version: Package.version,
			host: collectHostMetrics(this.getHostState()),
			webview: extra?.webview,
			error: extra?.error
				? {
						type: extra.error.type,
						message: clipText(extra.error.message) ?? "",
						stack: clipText(extra.error.stack),
					}
				: undefined,
		}
	}

	private async persist(snapshot: RuntimeSensorSnapshot, json: string): Promise<void> {
		const maxEvents = this.options.maxEvents ?? DEFAULT_MAX_EVENTS
		this.events.push(json)

		if (this.events.length > maxEvents) {
			this.events.splice(0, this.events.length - maxEvents)
		}

		await this.writer.writeLatest(json)
		await this.writer.replaceEvents(this.events.join(""))

		if (isGrayKind(snapshot.kind) && this.writer.writeGray) {
			await this.writer.writeGray(
				`${JSON.stringify({
					ts: snapshot.ts,
					kind: snapshot.kind,
					before: this.previousSnapshot,
					after: snapshot,
				})}\n`,
			)
		}

		this.previousSnapshot = snapshot
	}
}

function isSensorError(value: unknown): value is RuntimeSensorError {
	if (!value || typeof value !== "object") {
		return false
	}

	const error = value as RuntimeSensorError
	return typeof error.type === "string" && typeof error.message === "string"
}

function isWebviewMetrics(value: unknown): value is RuntimeSensorWebviewMetrics {
	return Boolean(value) && typeof value === "object"
}
