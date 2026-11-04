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

	it("tombstones rows older than the tail window and keeps the tail verbatim", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		const messages = bulk(30) // 30 > 10 + 4 triggers the first batch advance
		const out = projector.project(messages)

		expect(out.length).toBe(30)
		// Tail (last 10) stays verbatim (same object references).
		for (let i = 20; i < 30; i++) {
			expect(out[i]).toBe(messages[i])
		}
		// Old rows are tombstones: heavy fields dropped, identity fields kept.
		for (let i = 1; i < 20; i++) {
			expect((out[i] as { webviewTombstone?: boolean }).webviewTombstone).toBe(true)
			expect(out[i]!.text).toBeUndefined()
			expect(out[i]!.ts).toBe(messages[i]!.ts)
			expect(out[i]!.say).toBe(messages[i]!.say)
		}
		// Row 0 (task row) is never tombstoned.
		expect(out[0]).toBe(messages[0])
		expect(projector.tombstonedCount).toBeGreaterThan(0)
	})

	it("keeps api_req_started text (token/cost accounting source)", () => {
		const projector = createBoundTranscriptProjector(4, 2)
		// Row 0 is the task header row and is never tombstoned; the api_req row
		// must sit deeper in history to exercise the tombstone-with-text path.
		const taskRow = { ts: 1, type: "say", say: "text", text: "do the thing" } as ClineMessage
		const apiReq = {
			ts: 2,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ tokensIn: 100, tokensOut: 50, cost: 0.5 }),
		} as ClineMessage
		const messages = [taskRow, apiReq, ...bulk(10, 3)]
		const out = projector.project(messages)
		expect((out[1] as { webviewTombstone?: boolean }).webviewTombstone).toBe(true)
		expect(out[1]!.text).toBe(apiReq.text)
	})

	it("keeps condense context cost data", () => {
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
		expect((out[1] as { webviewTombstone?: boolean }).webviewTombstone).toBe(true)
		expect(out[1]!.text).toBeUndefined()
		expect(out[1]!.contextCondense).toEqual({ cost: 0.25, newContextTokens: 1200 })
	})

	it("returns stable tombstone identity across calls (prefix identity invariant)", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		// Reuse ONE base array: the identity contract is about the same input
		// objects flowing through repeated project() calls, not fresh clones.
		const base = bulk(30)
		const first = projector.project(base)
		// Streaming append below the hysteresis threshold must not disturb
		// any existing row identity.
		const appended = [...base, msg(31)]
		const second = projector.project(appended)
		for (let i = 0; i < 30; i++) {
			expect(second[i]).toBe(first[i])
		}
	})

	it("advances the boundary in batches, not on every append", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		let messages = bulk(30)
		const first = projector.project(messages)
		// Append 3 rows: verbatim count = 10 - 1 (row0 excluded from tombstones
		// but still counted in verbatim region boundary math) + 3 < tail+hyst,
		// so no re-tombstoning and prefix identity holds.
		messages = [...messages, msg(31), msg(32), msg(33)]
		const second = projector.project(messages)
		expect(second.slice(0, 30)).toEqual(first)
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
		expect(out[0]).toBe(messages[0])
		expect((out[0] as { webviewTombstone?: boolean }).webviewTombstone).toBeUndefined()
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

	it("image-strip clones keep stable identity across appends (except rows falling out of budget)", () => {
		const projector = createBoundTranscriptProjector(10, 4, 5)
		const base = [...bulk(2), ...Array.from({ length: 40 }, (_, i) => imgMsg(3 + i))]
		const first = projector.project(base)
		const appended = [...base, imgMsg(43)]
		const second = projector.project(appended)
		let changed = 0
		for (let i = 0; i < base.length; i++) {
			if (second[i] !== first[i]) {
				changed++
				// Only rows that fell out of the image budget may change identity,
				// and they must change into a stripped clone (no images).
				expect((second[i] as { webviewImagesStripped?: boolean }).webviewImagesStripped).toBe(true)
			}
		}
		// One append pushes the budget by at most one image row.
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
