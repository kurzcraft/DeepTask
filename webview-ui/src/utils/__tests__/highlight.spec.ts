// kilocode_change - new file
import {
	escapeHtml,
	highlightFzfMatch,
	resetEscapeHtmlCacheForTests,
	getEscapeHtmlCacheStatsForTests,
	ESCAPE_HTML_CACHE_MAX_TOTAL_BYTES,
	ESCAPE_HTML_CACHE_MAX_ITEM_BYTES,
} from "../highlight"

const amp = String.fromCharCode(38)
const quote = String.fromCharCode(34)
const apos = String.fromCharCode(39)
const ltEntity = amp + "lt;"
const gtEntity = amp + "gt;"
const ampEntity = amp + "amp;"

describe("bounded escape cache", () => {
	beforeEach(() => resetEscapeHtmlCacheForTests())
	it("preserves escaping and cache hits including Unicode and empty text", () => {
		const input = "<>" + amp + quote + apos + "中文😀"
		const expected = ltEntity + gtEntity + ampEntity + amp + "quot;" + amp + "#39;中文😀"
		for (const [text, output] of [
			[input, expected],
			["", ""],
		]) {
			expect(escapeHtml(text)).toBe(output)
			expect(escapeHtml(text)).toBe(output)
		}
		expect(getEscapeHtmlCacheStatsForTests().size).toBe(2)
	})
	it("does not retain large strings but returns their entire escaped content", () => {
		const input = ("<" + amp + "😀").repeat(ESCAPE_HTML_CACHE_MAX_ITEM_BYTES)
		const expected = (ltEntity + ampEntity + "😀").repeat(ESCAPE_HTML_CACHE_MAX_ITEM_BYTES)
		expect(escapeHtml(input)).toBe(expected)
		expect(escapeHtml(input)).toBe(expected)
		expect(getEscapeHtmlCacheStatsForTests().size).toBe(0)
	})
	it("accounts for keys and expanded values across repeated streaming versions", () => {
		for (let i = 0; i < 1500; i++) {
			const input = amp.repeat(2000) + i
			expect(escapeHtml(input)).toBe(ampEntity.repeat(2000) + i)
			expect(getEscapeHtmlCacheStatsForTests().calculatedSize).toBeLessThanOrEqual(
				ESCAPE_HTML_CACHE_MAX_TOTAL_BYTES,
			)
		}
		expect(getEscapeHtmlCacheStatsForTests().size).toBeLessThan(500)
	})
	it("preserves fuzzy highlight output", () => {
		expect(highlightFzfMatch("<ab>", [1, 2])).toBe(
			ltEntity +
				'<span class="history-item-highlight">a</span><span class="history-item-highlight">b</span>' +
				gtEntity,
		)
	})
})
