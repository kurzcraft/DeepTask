import { describe, expect, it } from "vitest"
import type { ClineMessage } from "@roo-code/types"

import {
	imageFingerprint,
	IncrementalImageOmitter,
	mergeIncrementalClineMessage,
} from "../incrementalImageOmit"

const blob = (seed: string, size = 4_096) => `data:image/png;base64,${seed.repeat(size)}`

const row = (overrides: Partial<ClineMessage> = {}): ClineMessage =>
	({
		ts: 1,
		type: "say",
		say: "user_feedback",
		text: "look",
		images: [blob("A")],
		...overrides,
	}) as ClineMessage

describe("incrementalImageOmit", () => {
	it("keeps images on the first post of a ts", () => {
		const omitter = new IncrementalImageOmitter()
		const original = row()
		const posted = omitter.omitUnchanged(original)

		expect(posted).toBe(original)
		expect(posted.images).toEqual(original.images)
		expect(posted.webviewImagesOmitted).toBeUndefined()
	})

	it("strips unchanged images on a later same-ts post so JSON.parse never sees the blob", () => {
		const omitter = new IncrementalImageOmitter()
		const first = row({ text: "partial" })
		omitter.omitUnchanged(first)

		const second = row({ text: "updated-text" })
		const posted = omitter.omitUnchanged(second)

		expect(posted).not.toBe(second)
		expect(posted.text).toBe("updated-text")
		expect(posted.images).toBeUndefined()
		expect(posted.webviewImagesOmitted).toBe(true)
		expect(second.images?.[0]).toHaveLength(blob("A").length)
		expect(JSON.stringify(posted).length).toBeLessThan(JSON.stringify(second).length / 2)
	})

	it("resends images when the fingerprint changes", () => {
		const omitter = new IncrementalImageOmitter()
		omitter.omitUnchanged(row({ images: [blob("A")] }))

		const changed = row({ images: [blob("B")] })
		const posted = omitter.omitUnchanged(changed)

		expect(posted).toBe(changed)
		expect(posted.images).toEqual(changed.images)
		expect(posted.webviewImagesOmitted).toBeUndefined()
	})

	it("does not collide fingerprints across session keys", () => {
		const omitter = new IncrementalImageOmitter()
		omitter.omitUnchanged(row(), "session-a")

		const other = row({ text: "other-session" })
		const posted = omitter.omitUnchanged(other, "session-b")

		expect(posted).toBe(other)
		expect(posted.images).toEqual(other.images)
	})

	it("resends after invalidate so abort/overwrite cannot keep a stale omit", () => {
		const omitter = new IncrementalImageOmitter()
		omitter.omitUnchanged(row())
		omitter.invalidate()

		const next = row({ text: "after-abort" })
		expect(omitter.omitUnchanged(next)).toBe(next)
	})

	it("omits the first incremental update after rememberAll from a snapshot", () => {
		const omitter = new IncrementalImageOmitter()
		const snapshot = row({ text: "hydrated" })
		omitter.rememberAll([snapshot])

		const update = row({ text: "partial-tick" })
		const posted = omitter.omitUnchanged(update)

		expect(posted.images).toBeUndefined()
		expect(posted.webviewImagesOmitted).toBe(true)
		expect(posted.text).toBe("partial-tick")
	})

	it("webview replace merges omitted payloads back onto the existing images", () => {
		const existing = row({ text: "old" })
		const incoming = row({
			text: "updated-old-image-row",
			images: undefined,
			webviewImagesOmitted: true,
		})
		const merged = mergeIncrementalClineMessage(incoming, existing)

		expect(merged.text).toBe("updated-old-image-row")
		expect(merged.images).toBe(existing.images)
		expect(merged.webviewImagesOmitted).toBeUndefined()
	})

	it("does not invent images when an omitted payload has no resident row", () => {
		const incoming = row({ images: undefined, webviewImagesOmitted: true })
		const merged = mergeIncrementalClineMessage(incoming, undefined)

		expect(merged.images).toBeUndefined()
		expect(merged.webviewImagesOmitted).toBeUndefined()
	})

	it("fingerprints by length and edges, not the full blob", () => {
		const a = blob("A", 200)
		const b = blob("A", 200)
		expect(imageFingerprint([a])).toBe(imageFingerprint([b]))
		expect(imageFingerprint([a])).not.toBe(imageFingerprint([blob("B", 200)]))
		expect(imageFingerprint(undefined)).toBe("")
	})
})
