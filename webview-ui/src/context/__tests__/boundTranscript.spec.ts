// kilocode_change - new file
import type { ClineMessage } from "@roo-code/types"
import { describe, expect, it } from "vitest"

import {
	BOUND_TRANSCRIPT_IMAGE_ROWS,
	BOUND_TRANSCRIPT_TAIL,
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
	it("keeps the default webview bound aligned with the host tail/image budget", () => {
		expect(BOUND_TRANSCRIPT_TAIL).toBe(64)
		expect(BOUND_TRANSCRIPT_IMAGE_ROWS).toBe(4)
	})

	it("returns the input untouched when no images need stripping", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		const messages = bulk(9)
		const out = projector.project(messages)
		expect(out).toBe(messages)
		expect(projector.tombstonedCount).toBe(0)
	})

	it("keeps every historical row in one continuous list", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		const messages = bulk(30)
		const out = projector.project(messages)

		expect(out).toHaveLength(30)
		expect(out).toBe(messages)
		expect(out[0]).toBe(messages[0])
		expect((out[0] as { webviewTombstone?: boolean }).webviewTombstone).toBeUndefined()
		expect(projector.tombstonedCount).toBe(0)
	})

	it("does not fold historical api_req rows into prefix stubs", () => {
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
		expect(out).toHaveLength(12)
		expect(out[1]).toBe(apiReq)
		expect((out[1] as { webviewTombstone?: boolean }).webviewTombstone).toBeUndefined()
		expect(JSON.parse(out[1]!.text!)).toMatchObject({ tokensIn: 100, tokensOut: 50, cost: 0.5 })
	})

	it("does not fold historical condense rows into prefix stubs", () => {
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
		expect(out).toHaveLength(12)
		expect(out[1]).toBe(condense)
		expect((out[1] as { webviewTombstone?: boolean }).webviewTombstone).toBeUndefined()
		expect(out[1]!.say).toBe("condense_context")
		expect(condense.text).toContain("long summary")
	})

	it("keeps row identity across messageUpdated appends", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		const first = projector.project(bulk(30))
		const appended = [...first, msg(31)]
		const second = projector.project(appended)
		expect(second).toHaveLength(first.length + 1)
		for (let i = 0; i < first.length; i++) {
			expect(second[i]).toBe(first[i])
		}
		expect(second[second.length - 1]).toBe(appended[appended.length - 1])
	})

	it("does not drop rows on a single messageUpdated append", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		const first = projector.project(bulk(30))
		expect(first).toHaveLength(30)
		const second = projector.project([...first, msg(31)])
		expect(second.slice(0, first.length)).toEqual(first)
		expect(second).toHaveLength(31)
	})

	it("honors the host omittedHint for the collapse banner across streaming appends", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		const compact = projector.project(bulk(30), 0)
		expect(projector.tombstonedCount).toBe(0)
		projector.project([...compact, msg(31)])
		expect(projector.tombstonedCount).toBe(0)
	})

	it("resets on task switch (new head)", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		projector.project(bulk(30, 1))
		const nextTask = bulk(5, 1000)
		const out = projector.project(nextTask)
		expect(out).toBe(nextTask)
	})

	it("resets on rewind to a shorter prefix", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		projector.project(bulk(30, 1))
		const rewound = bulk(5, 1)
		const out = projector.project(rewound)
		expect(out).toBe(rewound)
	})

	it("never drops row 0 from a long continuous list", () => {
		const projector = createBoundTranscriptProjector(10, 4)
		const messages = bulk(500, 1)
		const out = projector.project(messages)
		expect(out).toHaveLength(500)
		expect(out[0]).toBe(messages[0])
		expect((out[0] as { webviewTombstone?: boolean }).webviewTombstone).toBeUndefined()
		expect(projector.tombstonedCount).toBe(0)
	})

	// kilocode_change start: image budget within the verbatim window
	it("keeps images only on the newest IMAGE_ROWS image-bearing rows", () => {
		const projector = createBoundTranscriptProjector(10, 4, 5)
		// Continuous list keeps every row; the image budget still caps blobs at 5.
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

	it("re-strips images when messageUpdated replaces an older row in place", () => {
		const projector = createBoundTranscriptProjector(10, 4, 5)
		const messages = Array.from({ length: 12 }, (_, i) => imgMsg(1 + i))
		const first = projector.project(messages)
		const stripped = first.find((m) => (m as { webviewImagesStripped?: boolean }).webviewImagesStripped === true)
		expect(stripped).toBeDefined()

		const replaced = [...first]
		const index = replaced.findIndex((m) => m.ts === stripped!.ts)
		replaced[index] = imgMsg(stripped!.ts)
		const second = projector.project(replaced)
		const row = second.find((m) => m.ts === stripped!.ts)!

		expect((row as { images?: unknown }).images).toBeUndefined()
		expect((row as { webviewImagesStripped?: boolean }).webviewImagesStripped).toBe(true)
		expect(second.filter((m) => (m as { images?: unknown }).images !== undefined).length).toBeLessThanOrEqual(5)
	})

	it("applies the image budget on a short continuous list", () => {
		const projector = createBoundTranscriptProjector(10, 4, 5)
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
