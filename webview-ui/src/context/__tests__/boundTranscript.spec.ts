// kilocode_change - new file
import type { ClineMessage } from "@roo-code/types"
import { describe, expect, it } from "vitest"

import {
	BOUND_TRANSCRIPT_IMAGE_ROWS,
	createBoundTranscriptProjector,
	getParallelProjector,
	pruneParallelProjectors,
} from "../boundTranscript"

function msg(ts: number, extra: Partial<ClineMessage> = {}): ClineMessage {
	return { ts, type: "say", say: "text", text: `payload-${ts}-`.padEnd(2000, "x"), ...extra } as ClineMessage
}

function bulk(count: number, startTs = 1): ClineMessage[] {
	return Array.from({ length: count }, (_, i) => msg(startTs + i))
}

function imgMsg(ts: number): ClineMessage {
	return msg(ts, { images: ["data:image/png;base64," + "A".repeat(64)] } as Partial<ClineMessage>)
}

describe("createBoundTranscriptProjector", () => {
	it("returns the input untouched below the tail window", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		const messages = bulk(9)
		const out = projector.project(messages)
		expect(out).toBe(messages)
		expect(projector.tombstonedCount).toBe(0)
	})

	it("omits rows older than the tail window and keeps row 0, two stubs, and the tail", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		const messages = bulk(30) // 30 > 10 + 4 triggers compact
		const out = projector.project(messages)

		expect(out.length).toBe(13)
		expect(out[0]).toBe(messages[0])
		expect((out[0] as { webviewTombstone?: boolean }).webviewTombstone).toBeUndefined()
		expect((out[1] as { webviewTombstone?: boolean }).webviewTombstone).toBe(true)
		expect(out[1]!.say).toBe("api_req_started")
		expect((out[2] as { webviewTombstone?: boolean }).webviewTombstone).toBe(true)
		expect(out[2]!.say).toBe("condense_context")
		for (let i = 0; i < 10; i++) {
			expect(out[3 + i]).toBe(messages[20 + i])
		}
		expect(projector.tombstonedCount).toBe(19)
	})

	it("folds dropped-prefix token totals into the api_req stub", () => {
		const projector = createBoundTranscriptProjector(4, 2)
		const taskRow = { ts: 1, type: "say", say: "text", text: "do the thing" } as ClineMessage
		const apiReq = {
			ts: 2,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ tokensIn: 100, tokensOut: 50, cost: 0.5 }),
		} as ClineMessage
		const messages = [taskRow, apiReq, ...bulk(10, 3)]
		const out = projector.project(messages)
		expect(out.length).toBe(7)
		expect((out[1] as { webviewTombstone?: boolean }).webviewTombstone).toBe(true)
		expect(out[1]!.say).toBe("api_req_started")
		expect(JSON.parse(out[1]!.text!)).toMatchObject({ tokensIn: 100, tokensOut: 50, cost: 0.5 })
	})

	it("folds dropped-prefix condense cost into the accounting stubs", () => {
		const projector = createBoundTranscriptProjector(4, 2)
		const taskRow = { ts: 1, type: "say", say: "text", text: "do the thing" } as ClineMessage
		const condense = {
			ts: 2,
			type: "say",
			say: "condense_context",
			text: "long summary".padEnd(5000, "y"),
			contextCondense: { cost: 0.25, newContextTokens: 1200 },
		} as unknown as ClineMessage
		const messages = [taskRow, condense, ...bulk(10, 3)]
		const out = projector.project(messages)
		expect(out.length).toBe(7)
		expect((out[1] as { webviewTombstone?: boolean }).webviewTombstone).toBe(true)
		expect(out[1]!.say).toBe("api_req_started")
		expect(JSON.parse(out[1]!.text!)).toMatchObject({ cost: 0.25 })
		expect((out[2] as { webviewTombstone?: boolean }).webviewTombstone).toBe(true)
		expect(out[2]!.say).toBe("condense_context")
		expect(condense.text).toContain("long summary")
	})

	it("keeps compact identity across messageUpdated appends below hysteresis", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		const first = projector.project(bulk(30))
		// messageUpdated appends onto the already-compact resident array, not
		// the original 30-row snapshot (that would rebuild stubs every tick).
		const appended = [...first, msg(31)]
		const second = projector.project(appended)
		expect(second.length).toBe(first.length + 1)
		for (let i = 0; i < first.length; i++) {
			expect(second[i]).toBe(first[i])
		}
		expect(second[second.length - 1]).toBe(appended[appended.length - 1])
	})

	it("does not recompact on a single messageUpdated append at the hysteresis edge", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		const first = projector.project(bulk(30))
		expect(first.length).toBe(13)
		const second = projector.project([...first, msg(31)])
		expect(second.slice(0, first.length)).toEqual(first)
		expect(second.length).toBe(14)
	})

	it("honors the host omittedHint for the collapse banner across streaming appends", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		const compact = projector.project(bulk(30), 19)
		expect(projector.tombstonedCount).toBe(19)
		projector.project([...compact, msg(31)])
		expect(projector.tombstonedCount).toBe(19)
	})

	it("resets on task switch (new head)", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		projector.project(bulk(30, 1))
		const nextTask = bulk(5, 1000)
		const out = projector.project(nextTask)
		expect(out).toBe(nextTask) // verbatim again, no stale tombstones
	})

	it("resets on rewind to inside the window", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		projector.project(bulk(30, 1))
		const rewound = bulk(5, 1) // same head, shorter
		const out = projector.project(rewound)
		expect(out).toBe(rewound)
	})

	it("never tombstones row 0 even when the window slides far past it", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		const messages = bulk(500, 1)
		const out = projector.project(messages)
		expect(out.length).toBe(13)
		expect(out[0]).toBe(messages[0])
		expect((out[0] as { webviewTombstone?: boolean }).webviewTombstone).toBeUndefined()
		expect(projector.tombstonedCount).toBe(489)
	})

	// kilocode_change start: image budget within the verbatim window
	it("keeps images only on the newest IMAGE_ROWS image-bearing rows", () => {
		const projector = createBoundTranscriptProjector(10, 4, 5)
		// 62 rows all carrying images: 62 > 14 → the tail window tombstones the
		// prefix; then the image budget caps image rows at 5.
		const messages = [...bulk(2), ...Array.from({ length: 60 }, (_, i) => imgMsg(3 + i))]
		const out = projector.project(messages)
		const withImages = out.filter((m) => (m as { images?: unknown }).images !== undefined)
		const stripped = out.filter((m) => (m as { webviewImagesStripped?: boolean }).webviewImagesStripped === true)
		expect(withImages.length).toBeLessThanOrEqual(5)
		expect(stripped.length).toBeGreaterThan(0)
		// Stripped rows keep their text so the row still renders meaningfully.
		for (const row of stripped) {
			expect(row.text).toContain("payload-")
			expect((row as { images?: unknown }).images).toBeUndefined()
		}
		// Tombstoned rows are excluded from the image budget entirely.
		const tombstonedWithImages = out.filter(
			(m) =>
				(m as { webviewTombstone?: boolean }).webviewTombstone === true &&
				(m as { images?: unknown }).images !== undefined,
		)
		expect(tombstonedWithImages).toHaveLength(0)
	})

	it("image-strip clones keep stable identity across messageUpdated appends", () => {
		const projector = createBoundTranscriptProjector(10, 4, 5)
		const base = [...bulk(2), ...Array.from({ length: 40 }, (_, i) => imgMsg(3 + i))]
		const first = projector.project(base)
		const appended = [...first, imgMsg(43)]
		const second = projector.project(appended)
		let changed = 0
		for (let i = 0; i < first.length; i++) {
			if (second[i] !== first[i]) {
				changed++
				expect((second[i] as { webviewImagesStripped?: boolean }).webviewImagesStripped).toBe(true)
			}
		}
		expect(changed).toBeLessThanOrEqual(1)
	})

	it("applies the image budget even below the tail window (no tombstones yet)", () => {
		const projector = createBoundTranscriptProjector(10, 4, 5)
		// 12 rows < 14 → no tombstones, but more image rows than the budget of 5.
		const messages = Array.from({ length: 12 }, (_, i) => imgMsg(1 + i))
		const out = projector.project(messages)
		const withImages = out.filter((m) => (m as { images?: unknown }).images !== undefined)
		expect(withImages.length).toBeLessThanOrEqual(5)
	})

	it("prunes parallel projectors when sessions disappear", () => {
		const p1 = getParallelProjector("sa-1")
		const p2 = getParallelProjector("sa-2")
		expect(getParallelProjector("sa-1")).toBe(p1)
		pruneParallelProjectors(["sa-2"])
		// sa-1's projector was dropped; asking again builds a fresh one.
		expect(getParallelProjector("sa-1")).not.toBe(p1)
		expect(getParallelProjector("sa-2")).toBe(p2)
	})
	// kilocode_change end
})
