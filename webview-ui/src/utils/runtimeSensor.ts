// kilocode_change - new file
import { vscode } from "./vscode"

export const WEBVIEW_SENSOR_INTERVAL_MS = 15_000
export const WEBVIEW_SENSOR_THROTTLE_MS = 1_000
export const WEBVIEW_SENSOR_MAX_ERROR_CHARS = 1_500
export const WEBVIEW_GRAY_KINDS = [
	"blank",
	"missing-root",
	"unhydrated",
	"error",
	"unhandledrejection",
	"pagehide",
	"freeze",
	"unload",
] as const

export interface WebviewSensorMetrics {
	heapUsedMb?: number
	heapTotalMb?: number
	hydrated?: boolean
	visibility?: string
	hidden?: boolean
	hasRoot?: boolean
	rootChildCount?: number
}

export interface WebviewSensorError {
	type: string
	message: string
	stack?: string
}

export interface WebviewSensorPayload {
	kind: string
	webview: WebviewSensorMetrics
	error?: WebviewSensorError
}

export interface WebviewSensorClock {
	now(): number
}

export interface WebviewSensorOptions {
	intervalMs?: number
	throttleMs?: number
	now?: () => number
	post?: (payload: WebviewSensorPayload) => void
	collect?: () => WebviewSensorMetrics
}

function clipText(value: string | undefined, max = WEBVIEW_SENSOR_MAX_ERROR_CHARS): string | undefined {
	if (!value) {
		return undefined
	}

	return value.length <= max ? value : `${value.slice(0, max)}…`
}

function bytesToMb(bytes: number): number {
	return Math.round((bytes / 1024 / 1024) * 100) / 100
}

export function isWebviewGrayKind(kind: string): boolean {
	return (WEBVIEW_GRAY_KINDS as readonly string[]).includes(kind)
}

export function classifyWebviewGray(metrics: WebviewSensorMetrics): string | undefined {
	if (metrics.hasRoot === false) {
		return "missing-root"
	}

	if (metrics.hydrated === true && metrics.hasRoot === true && metrics.rootChildCount === 0) {
		return "blank"
	}

	return undefined
}

function shouldReclassifyKind(kind: string): boolean {
	return kind === "tick" || kind === "visibility" || kind === "webview"
}

export function collectWebviewMetrics(hydrated = false): WebviewSensorMetrics {
	const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } })
		.memory
	const root = typeof document === "undefined" ? null : document.getElementById("root")

	return {
		heapUsedMb: memory ? bytesToMb(memory.usedJSHeapSize) : undefined,
		heapTotalMb: memory ? bytesToMb(memory.totalJSHeapSize) : undefined,
		hydrated,
		visibility: typeof document === "undefined" ? undefined : document.visibilityState,
		hidden: typeof document === "undefined" ? undefined : document.hidden,
		hasRoot: Boolean(root),
		rootChildCount: root?.childElementCount,
	}
}

function defaultPost(payload: WebviewSensorPayload): void {
	vscode.postMessage({
		type: "runtimeSensor",
		values: payload,
	})
}

export class WebviewRuntimeSensor {
	private intervalId?: ReturnType<typeof setInterval>
	private disposed = false
	private lastWriteAt = 0
	private hydrated = false

	constructor(private readonly options: WebviewSensorOptions = {}) {}

	get isDisposed(): boolean {
		return this.disposed
	}

	start(): void {
		if (this.intervalId || this.disposed) {
			return
		}

		this.report("start", undefined, true)
		this.intervalId = setInterval(() => {
			this.report("tick")
		}, this.options.intervalMs ?? WEBVIEW_SENSOR_INTERVAL_MS)
	}

	setHydrated(hydrated: boolean): void {
		this.hydrated = hydrated
		this.report(hydrated ? "hydrated" : "unhydrated", undefined, true)
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
		this.detachWindowListeners()
	}

	report(kind: string, error?: WebviewSensorError, force = false): void {
		if (this.disposed) {
			return
		}

		const metrics = (this.options.collect ?? (() => collectWebviewMetrics(this.hydrated)))()
		const grayKind = classifyWebviewGray(metrics)
		const effectiveKind = isWebviewGrayKind(kind)
			? kind
			: shouldReclassifyKind(kind)
				? (grayKind ?? kind)
				: kind
		const now = (this.options.now ?? Date.now)()
		const throttleMs = this.options.throttleMs ?? WEBVIEW_SENSOR_THROTTLE_MS
		const shouldForce = force || isWebviewGrayKind(effectiveKind) || Boolean(grayKind)

		if (!shouldForce && now - this.lastWriteAt < throttleMs) {
			return
		}

		this.lastWriteAt = now
		const payload: WebviewSensorPayload = {
			kind: effectiveKind,
			webview: metrics,
			error: error
				? {
						type: error.type,
						message: clipText(error.message) ?? "",
						stack: clipText(error.stack),
					}
				: undefined,
		}
		;(this.options.post ?? defaultPost)(payload)
	}

	private onError = (event: ErrorEvent) => {
		this.report(
			"error",
			{
				type: event.error?.name ?? "Error",
				message: event.message || String(event.error ?? "error"),
				stack: event.error?.stack,
			},
			true,
		)
	}

	private onUnhandledRejection = (event: PromiseRejectionEvent) => {
		const reason = event.reason
		const message =
			reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "unhandledrejection"
		this.report(
			"unhandledrejection",
			{
				type: reason instanceof Error ? reason.name : "unhandledrejection",
				message,
				stack: reason instanceof Error ? reason.stack : undefined,
			},
			true,
		)
	}

	private onVisibilityChange = () => {
		this.report("visibility")
	}

	private onPageHide = () => {
		this.report("pagehide", undefined, true)
	}

	private onFreeze = () => {
		this.report("freeze", undefined, true)
	}

	private onUnload = () => {
		this.report("unload", undefined, true)
	}

	attachWindowListeners(target: Window = window): void {
		target.addEventListener("error", this.onError)
		target.addEventListener("unhandledrejection", this.onUnhandledRejection)
		target.addEventListener("pagehide", this.onPageHide)
		target.addEventListener("freeze", this.onFreeze)
		target.addEventListener("unload", this.onUnload)
		target.document?.addEventListener("visibilitychange", this.onVisibilityChange)
		this.listenersTarget = target
	}

	private listenersTarget?: Window

	private detachWindowListeners(): void {
		const target = this.listenersTarget
		if (!target) {
			return
		}

		target.removeEventListener("error", this.onError)
		target.removeEventListener("unhandledrejection", this.onUnhandledRejection)
		target.removeEventListener("pagehide", this.onPageHide)
		target.removeEventListener("freeze", this.onFreeze)
		target.removeEventListener("unload", this.onUnload)
		target.document?.removeEventListener("visibilitychange", this.onVisibilityChange)
		this.listenersTarget = undefined
	}
}

let singleton: WebviewRuntimeSensor | undefined

export function startWebviewRuntimeSensor(): WebviewRuntimeSensor {
	if (!singleton) {
		singleton = new WebviewRuntimeSensor()
		singleton.attachWindowListeners()
		singleton.start()
	}

	return singleton
}

export function setWebviewSensorHydrated(hydrated: boolean): void {
	singleton?.setHydrated(hydrated)
}
