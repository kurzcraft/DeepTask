import { describe, expect, it } from "vitest"

import { appendBoundedBuffer, MAX_TERMINAL_BUFFER_CHARS } from "../BaseTerminalProcess"

// kilocode_change: ring-cap unit tests for the long-running terminal fix.
// A training watcher streaming gigabytes must never grow these buffers
// without bound, and eviction must be observable (tombstone counts).
describe("appendBoundedBuffer", () => {
	it("returns simple concatenation while under the cap", () => {
		expect(appendBoundedBuffer("abc", "def", 10)).toBe("abcdef")
	})

	it("keeps the newest characters once the cap is exceeded", () => {
		// "0123456789" + "ABCDEF" = 16 chars, cap 10 keeps the last 10: "6789ABCDEF"
		expect(appendBoundedBuffer("0123456789", "ABCDEF", 10)).toBe("6789ABCDEF")
	})

	it("caps a single chunk larger than the buffer", () => {
		const big = "x".repeat(MAX_TERMINAL_BUFFER_CHARS + 500)
		const capped = appendBoundedBuffer("", big)
		expect(capped.length).toBe(MAX_TERMINAL_BUFFER_CHARS)
		expect(capped.endsWith("x")).toBe(true)
	})

	it("is idempotent at steady state (always exactly maxChars after overflow)", () => {
		let buffer = ""
		for (let i = 0; i < 5; i++) {
			buffer = appendBoundedBuffer(buffer, "y".repeat(MAX_TERMINAL_BUFFER_CHARS / 2))
		}
		expect(buffer.length).toBe(MAX_TERMINAL_BUFFER_CHARS)
	})

	it("preserves chunk order in the retained window", () => {
		const capped = appendBoundedBuffer("AAAA", "BBBB", 6)
		expect(capped).toBe("AABBBB")
	})
})
