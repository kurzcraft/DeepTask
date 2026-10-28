import { LRUCache } from "lru-cache"

// kilocode_change start - bound retained string payload, not just entry count.
// UTF-16 estimate includes both key and value; it is not a heap measurement.
export const ESCAPE_HTML_CACHE_MAX_TOTAL_BYTES = 1024 * 1024
export const ESCAPE_HTML_CACHE_MAX_ITEM_BYTES = 64 * 1024
const estimatePayloadBytes = (value: string, key: string) => Math.max(1, 2 * (key.length + value.length))
const escapeHtmlCache = new LRUCache<string, string>({
	max: 500,
	maxSize: ESCAPE_HTML_CACHE_MAX_TOTAL_BYTES,
	maxEntrySize: ESCAPE_HTML_CACHE_MAX_ITEM_BYTES,
	sizeCalculation: estimatePayloadBytes,
})
export const getEscapeHtmlCacheStatsForTests = () => ({
	size: escapeHtmlCache.size,
	calculatedSize: escapeHtmlCache.calculatedSize,
})
export const resetEscapeHtmlCacheForTests = () => escapeHtmlCache.clear()
// kilocode_change end

export function escapeHtml(text: string): string {
	// Check cache first
	const cached = escapeHtmlCache.get(text)
	if (cached !== undefined) {
		return cached
	}

	// Compute escaped text
	const escaped = text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")

	// kilocode_change start - large results remain complete, but are not retained.
	if (estimatePayloadBytes(escaped, text) <= ESCAPE_HTML_CACHE_MAX_ITEM_BYTES) {
		escapeHtmlCache.set(text, escaped)
	}
	// kilocode_change end

	return escaped
}

export function highlightFzfMatch(
	text: string,
	positions: number[],
	highlightClassName: string = "history-item-highlight",
) {
	if (!positions.length) return text

	const parts: { text: string; highlight: boolean }[] = []
	let lastIndex = 0

	// Sort positions to ensure we process them in order
	positions.sort((a, b) => a - b)

	positions.forEach((pos) => {
		// Add non-highlighted text before this position
		if (pos > lastIndex) {
			parts.push({
				text: text.substring(lastIndex, pos),
				highlight: false,
			})
		}

		// Add highlighted character
		parts.push({
			text: text[pos],
			highlight: true,
		})

		lastIndex = pos + 1
	})

	// Add any remaining text
	if (lastIndex < text.length) {
		parts.push({
			text: text.substring(lastIndex),
			highlight: false,
		})
	}

	// Build final string
	return parts
		.map((part) => {
			const escapedText = escapeHtml(part.text)
			return part.highlight ? `<span class="${highlightClassName}">${escapedText}</span>` : escapedText
		})
		.join("")
}
