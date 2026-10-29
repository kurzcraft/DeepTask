import { RuntimeSensor, bytesToMb, clipText, collectHostMetrics } from "../RuntimeSensor"
import type { RuntimeSensorWriter } from "../RuntimeSensor"

describe("RuntimeSensor", () => {
	const createWriter = () => {
		const latest: string[] = []
		const events: string[] = []
		const gray: string[] = []
		const writer: RuntimeSensorWriter = {
			writeLatest: async (json) => {
				latest.push(json)
			},
			replaceEvents: async (jsonl) => {
				events.push(jsonl)
			},
			writeGray: async (json) => {
				gray.push(json)
			},
		}

		return { writer, latest, events, gray }
	}

	it("writes a host snapshot with heap and panel state", async () => {
		const { writer, latest, events } = createWriter()
		const sensor = new RuntimeSensor(
			writer,
			() => ({
				viewVisible: true,
				renderContext: "sidebar",
				taskId: "task-1",
				stackLength: 2,
				messageCount: 4,
			}),
			{ throttleMs: 0 },
		)

		await sensor.record("start", undefined, true)

		expect(latest).toHaveLength(1)
		const snapshot = JSON.parse(latest[0]!)
		expect(snapshot.source).toBe("host")
		expect(snapshot.kind).toBe("start")
		expect(snapshot.host.viewVisible).toBe(true)
		expect(snapshot.host.renderContext).toBe("sidebar")
		expect(snapshot.host.taskId).toBe("task-1")
		expect(snapshot.host.stackLength).toBe(2)
		expect(snapshot.host.messageCount).toBe(4)
		expect(typeof snapshot.host.rssMb).toBe("number")
		expect(events.at(-1)).toContain('"kind":"start"')
		sensor.dispose()
	})

	it("throttles routine writes and still records forced errors", async () => {
		let now = 1_000
		const { writer, latest } = createWriter()
		const sensor = new RuntimeSensor(writer, () => ({}), {
			throttleMs: 1_000,
			now: () => now,
		})

		await sensor.record("tick")
		await sensor.record("tick")
		expect(latest).toHaveLength(1)

		now = 1_500
		await sensor.ingestWebview({
			kind: "error",
			error: { type: "Error", message: "boom", stack: "stack" },
			webview: { hydrated: false, hasRoot: true },
		})
		expect(latest).toHaveLength(2)
		const errorSnapshot = JSON.parse(latest[1]!)
		expect(errorSnapshot.source).toBe("webview")
		expect(errorSnapshot.kind).toBe("error")
		expect(errorSnapshot.error.message).toBe("boom")
		expect(errorSnapshot.webview.hydrated).toBe(false)
		sensor.dispose()
	})

	it("keeps a bounded event log and stops writing after dispose", async () => {
		const { writer, latest, events } = createWriter()
		const sensor = new RuntimeSensor(writer, () => ({}), {
			throttleMs: 0,
			maxEvents: 2,
		})

		await sensor.record("one", undefined, true)
		await sensor.record("two", undefined, true)
		await sensor.record("three", undefined, true)

		const lastEvents = events.at(-1)!.trim().split("\n")
		expect(lastEvents).toHaveLength(2)
		expect(lastEvents[0]).toContain('"kind":"two"')
		expect(lastEvents[1]).toContain('"kind":"three"')

		sensor.dispose()
		await sensor.record("after-dispose", undefined, true)
		expect(latest).toHaveLength(3)
	})

	it("clips long error text and converts bytes to megabytes", () => {
		expect(bytesToMb(2 * 1024 * 1024)).toBe(2)
		expect(clipText("abc", 2)).toBe("ab…")
		expect(clipText(undefined)).toBeUndefined()
		const metrics = collectHostMetrics({ viewVisible: false, stackLength: 0 })
		expect(metrics.viewVisible).toBe(false)
		expect(metrics.stackLength).toBe(0)
	})

	it("classifies a hydrated empty root as blank and writes before/after gray snapshots", async () => {
		let now = 1_000
		const { writer, latest, gray } = createWriter()
		const sensor = new RuntimeSensor(writer, () => ({ viewVisible: true }), {
			throttleMs: 1_000,
			now: () => now,
		})

		await sensor.record("tick")
		now = 1_200
		await sensor.ingestWebview({
			kind: "tick",
			webview: { hydrated: true, hasRoot: true, rootChildCount: 0, visibility: "visible" },
		})

		expect(latest).toHaveLength(2)
		const blank = JSON.parse(latest[1]!)
		expect(blank.kind).toBe("blank")
		expect(blank.source).toBe("webview")
		expect(gray).toHaveLength(1)
		const capture = JSON.parse(gray[0]!)
		expect(capture.kind).toBe("blank")
		expect(capture.before.kind).toBe("tick")
		expect(capture.after.kind).toBe("blank")
		sensor.dispose()
	})

	it("forces missing-root and freeze writes through throttle", async () => {
		let now = 1_000
		const { writer, latest, gray } = createWriter()
		const sensor = new RuntimeSensor(writer, () => ({}), {
			throttleMs: 1_000,
			now: () => now,
		})

		await sensor.record("tick")
		now = 1_100
		await sensor.ingestWebview({
			kind: "tick",
			webview: { hydrated: true, hasRoot: false, rootChildCount: 0 },
		})
		now = 1_150
		await sensor.ingestWebview({
			kind: "freeze",
			webview: { hydrated: true, hasRoot: true, rootChildCount: 1 },
		})

		expect(latest).toHaveLength(3)
		expect(JSON.parse(latest[1]!).kind).toBe("missing-root")
		expect(JSON.parse(latest[2]!).kind).toBe("freeze")
		expect(gray).toHaveLength(2)
		sensor.dispose()
	})

	it("does not reclassify hydration when rootChildCount is omitted", async () => {
		const { writer, latest, gray } = createWriter()
		const sensor = new RuntimeSensor(writer, () => ({}), { throttleMs: 0 })

		await sensor.ingestWebview({
			kind: "hydrated",
			webview: { hydrated: true, hasRoot: true },
		})

		expect(latest).toHaveLength(1)
		expect(JSON.parse(latest[0]!).kind).toBe("hydrated")
		expect(gray).toHaveLength(0)
		sensor.dispose()
	})
})
