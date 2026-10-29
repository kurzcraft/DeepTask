import { WebviewRuntimeSensor, classifyWebviewGray, collectWebviewMetrics } from "../runtimeSensor"
import type { WebviewSensorPayload } from "../runtimeSensor"

describe("WebviewRuntimeSensor", () => {
	it("writes a start snapshot with panel metrics", () => {
		const posted: WebviewSensorPayload[] = []
		const sensor = new WebviewRuntimeSensor({
			throttleMs: 0,
			post: (payload) => posted.push(payload),
			collect: () => ({
				hydrated: false,
				hasRoot: true,
				rootChildCount: 1,
				visibility: "visible",
				hidden: false,
			}),
		})

		sensor.start()

		expect(posted).toHaveLength(1)
		expect(posted[0]?.kind).toBe("start")
		expect(posted[0]?.webview.hydrated).toBe(false)
		expect(posted[0]?.webview.hasRoot).toBe(true)
		expect(posted[0]?.webview.rootChildCount).toBe(1)
		sensor.dispose()
	})

	it("throttles routine writes and still records forced errors", () => {
		let now = 1_000
		const posted: WebviewSensorPayload[] = []
		const sensor = new WebviewRuntimeSensor({
			throttleMs: 1_000,
			now: () => now,
			post: (payload) => posted.push(payload),
			collect: () => ({ hydrated: false, hasRoot: true }),
		})

		sensor.report("tick")
		sensor.report("tick")
		expect(posted).toHaveLength(1)

		now = 1_500
		sensor.report("error", { type: "Error", message: "boom", stack: "stack" }, true)
		expect(posted).toHaveLength(2)
		expect(posted[1]?.kind).toBe("error")
		expect(posted[1]?.error?.message).toBe("boom")
		sensor.dispose()
	})

	it("reports hydration and stops writing after dispose", () => {
		const posted: WebviewSensorPayload[] = []
		const sensor = new WebviewRuntimeSensor({
			throttleMs: 0,
			post: (payload) => posted.push(payload),
			collect: () => ({ hydrated: true, hasRoot: true, rootChildCount: 1 }),
		})

		sensor.setHydrated(true)
		expect(posted.at(-1)?.kind).toBe("hydrated")

		sensor.dispose()
		sensor.report("after-dispose", undefined, true)
		expect(posted).toHaveLength(1)
		expect(sensor.isDisposed).toBe(true)
	})

	it("collects root presence without throwing when document is present", () => {
		const metrics = collectWebviewMetrics(false)
		expect(metrics.hydrated).toBe(false)
		expect(typeof metrics.hasRoot).toBe("boolean")
	})

	it("classifies a hydrated empty root as blank and a missing root as missing-root", () => {
		expect(classifyWebviewGray({ hydrated: true, hasRoot: true, rootChildCount: 0 })).toBe("blank")
		expect(classifyWebviewGray({ hydrated: true, hasRoot: false, rootChildCount: 0 })).toBe("missing-root")
		expect(classifyWebviewGray({ hydrated: true, hasRoot: true, rootChildCount: 1 })).toBeUndefined()
		expect(classifyWebviewGray({ hydrated: true, hasRoot: true })).toBeUndefined()
	})

	it("forces blank and freeze reports through throttle", () => {
		let now = 1_000
		const posted: WebviewSensorPayload[] = []
		const sensor = new WebviewRuntimeSensor({
			throttleMs: 1_000,
			now: () => now,
			post: (payload) => posted.push(payload),
			collect: () => ({ hydrated: true, hasRoot: true, rootChildCount: 0 }),
		})

		sensor.report("tick")
		expect(posted).toHaveLength(1)
		expect(posted[0]?.kind).toBe("blank")

		now = 1_200
		sensor.report("tick")
		expect(posted).toHaveLength(2)
		expect(posted[1]?.kind).toBe("blank")

		now = 1_250
		const freezeSensor = new WebviewRuntimeSensor({
			throttleMs: 1_000,
			now: () => now,
			post: (payload) => posted.push(payload),
			collect: () => ({ hydrated: true, hasRoot: true, rootChildCount: 1 }),
		})
		freezeSensor.report("tick")
		freezeSensor.report("freeze", undefined, true)
		expect(posted.at(-1)?.kind).toBe("freeze")
		sensor.dispose()
		freezeSensor.dispose()
	})
})
