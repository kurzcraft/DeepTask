// kilocode_change - new file
import type { ClineMessage } from "@roo-code/types"

/**
 * Bounded transcript projection for the webview (kilocode_change).
 *
 * 9.3.6 sliding 64-row pages broke scroll continuity. Keep every row in one
 * Virtuoso list. Host cheap-previews historical payloads on full snapshots,
 * but streaming `messageUpdated` leaves each 8k tail row resident forever.
 * This projector therefore:
 *   - keeps every row (no paging, no tombstones)
 *   - cheap-previews rows that have left the newest tail
 *   - caps images so streaming cannot re-inflate stripped blobs
 *   - caches ONLY the final clone (never the full source). Pinning `source`
 *     kept every historical 8k/base64 payload alive after React state had
 *     already switched to the cheap preview — the 90% renderer leak.
 *
 * Storage and model I/O stay full.
 *
 * Identity stability contract (critical for the incremental caches in
 * consolidateCommandsIncremental / consolidateTokenUsageIncremental /
 * filterVisibleMessagesIncremental):
 *   - Ordinary streaming appends keep already-projected identities.
 *   - The row that just left the tail is cloned once (cheap preview), then reused.
 *   - The row that just left the image budget is cloned once (blobs dropped).
 *   - Rebuild only when the input object is not our clone, or compact/image
 *     flags change. Shrink (task switch / rewind / branch) resets the cache.
 */

/** Newest rows stay 8k-truncated (host). Older rows drop to a cheap preview. */
export const BOUND_TRANSCRIPT_TAIL = 64
/** Extra verbatim rows tolerated before compacting (unused; paging is gone). */
export const BOUND_TRANSCRIPT_HYSTERESIS = 16
/** Align with host WEBVIEW_TRANSCRIPT_HISTORICAL_CHAR_LIMIT. */
export const BOUND_TRANSCRIPT_HISTORICAL_CHAR_LIMIT = 120
// kilocode_change start: image budget — loop image-reading tasks stack hundreds of
// MB-scale base64 strings (UTF-16 doubles ASCII base64). Keep images on the
// most recent image-bearing rows only; older rows keep their text but drop blobs.
export const BOUND_TRANSCRIPT_IMAGE_ROWS = 4
// kilocode_change end

function cheapPreviewText(text: string, limit = BOUND_TRANSCRIPT_HISTORICAL_CHAR_LIMIT): string {
	if (text.length <= limit) {
		return text
	}
	// Already compacted (content + ellipsis). Re-slicing would shrink again.
	if (text.length === limit + 1 && text.endsWith("…")) {
		return text
	}
	return `${text.slice(0, limit)}…`
}

function compactApiReqText(text: string): string {
	try {
		const parsed = JSON.parse(text) as Record<string, unknown>
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.request !== undefined) {
			const { request: _request, ...rest } = parsed
			const projected = JSON.stringify(rest)
			if (projected.length < text.length) {
				return cheapPreviewText(projected)
			}
		}
	} catch {
		// Not JSON — fall through to a cheap preview.
	}
	return cheapPreviewText(text)
}

/**
 * One clone, one payload. Compact text and/or drop images in a single object
 * so we never materialize an intermediate historical row that still holds
 * base64 blobs (the previous two-pass projector did exactly that).
 */
function projectRow(message: ClineMessage, compact: boolean, stripImages: boolean): ClineMessage {
	if ((message as { webviewTombstone?: boolean }).webviewTombstone === true) {
		return message
	}

	const doStrip = stripImages && (message as { images?: unknown }).images !== undefined
	let mutated = doStrip
	let text = message.text
	let reasoning = message.reasoning
	let contextCondense = message.contextCondense

	if (compact) {
		if (message.type === "say" && message.say === "api_req_started" && text) {
			const projectedText = compactApiReqText(text)
			if (projectedText !== text) {
				text = projectedText
				mutated = true
			}
			if (!mutated) {
				return message
			}
			const clone: Record<string, unknown> = { ...message, text }
			if (doStrip) {
				delete clone.images
				clone.webviewImagesStripped = true
			}
			return clone as ClineMessage
		}

		if (contextCondense !== undefined && contextCondense.summary) {
			contextCondense = { ...contextCondense, summary: "" }
			mutated = true
		}
		if (text && text.length > BOUND_TRANSCRIPT_HISTORICAL_CHAR_LIMIT) {
			const projectedText = cheapPreviewText(text)
			if (projectedText !== text) {
				text = projectedText
				mutated = true
			}
		}
		if (reasoning && reasoning.length > BOUND_TRANSCRIPT_HISTORICAL_CHAR_LIMIT) {
			const projectedReasoning = cheapPreviewText(reasoning)
			if (projectedReasoning !== reasoning) {
				reasoning = projectedReasoning
				mutated = true
			}
		}
	}

	if (!mutated) {
		return message
	}

	const clone: Record<string, unknown> = { ...message, text, reasoning }
	if (contextCondense !== message.contextCondense) {
		clone.contextCondense = contextCondense
	}
	if (doStrip) {
		delete clone.images
		clone.webviewImagesStripped = true
	}
	return clone as ClineMessage
}

export interface BoundTranscriptProjector {
	project(messages: readonly ClineMessage[], omittedHint?: number): ClineMessage[]
	/** Always 0: the continuous list is not omitted. Host may still send 0. */
	readonly tombstonedCount: number
}

export function createBoundTranscriptProjector(
	tail = BOUND_TRANSCRIPT_TAIL,
	_hysteresis = BOUND_TRANSCRIPT_HYSTERESIS,
	// kilocode_change: image budget is injectable for tests (default keeps the
	// newest BOUND_TRANSCRIPT_IMAGE_ROWS image-bearing rows with images).
	imageRows = BOUND_TRANSCRIPT_IMAGE_ROWS,
): BoundTranscriptProjector {
	let anchorHeadTs: number | undefined // conversation identity guard
	let lastCount = 0
	let tombstoned = 0
	// Final projected row only. Storing the pre-projection `source` pinned every
	// historical 8k/base64 payload after React had already swapped to the clone.
	let rowCache = new Map<number, { clone: ClineMessage; compact: boolean }>()

	const reset = (headTs: number | undefined) => {
		anchorHeadTs = headTs
		lastCount = 0
		tombstoned = 0
		rowCache = new Map()
	}

	const projectAll = (messages: readonly ClineMessage[]): ClineMessage[] => {
		const keepImages = new Set<number>()
		if (imageRows > 0) {
			for (let i = messages.length - 1; i >= 0; i--) {
				const candidate = messages[i]!
				if ((candidate as { webviewTombstone?: boolean }).webviewTombstone === true) {
					continue
				}
				if ((candidate as { images?: unknown }).images !== undefined) {
					keepImages.add(candidate.ts)
					if (keepImages.size >= imageRows) {
						break
					}
				}
			}
		}

		const start = messages.length > tail ? messages.length - tail : 0
		let changed = false
		const out: ClineMessage[] = new Array(messages.length)
		const liveTs = new Set<number>()

		for (let i = 0; i < messages.length; i++) {
			const message = messages[i]!
			liveTs.add(message.ts)
			const compact = i < start
			const wantImages =
				keepImages.has(message.ts) && (message as { images?: unknown }).images !== undefined
			const stripImages = !wantImages && (message as { images?: unknown }).images !== undefined

			const cached = rowCache.get(message.ts)
			if (cached && cached.clone === message && cached.compact === compact) {
				const cloneHasImages = (message as { images?: unknown }).images !== undefined
				if (cloneHasImages === wantImages) {
					out[i] = cached.clone
					continue
				}
			}

			const clone = projectRow(message, compact, stripImages)
			rowCache.set(message.ts, { clone, compact })
			out[i] = clone
			if (clone !== message) {
				changed = true
			}
		}

		if (rowCache.size > liveTs.size) {
			for (const ts of [...rowCache.keys()]) {
				if (!liveTs.has(ts)) {
					rowCache.delete(ts)
				}
			}
		}

		return changed ? out : (messages as ClineMessage[])
	}

	return {
		get tombstonedCount() {
			return tombstoned
		},
		project(messages: readonly ClineMessage[], omittedHint?: number): ClineMessage[] {
			if (messages.length === 0) {
				if (typeof omittedHint === "number") {
					tombstoned = omittedHint
				} else {
					tombstoned = 0
				}
				reset(undefined)
				return messages as ClineMessage[]
			}

			const headTs = messages[0]!.ts
			if (anchorHeadTs === undefined) {
				anchorHeadTs = headTs
			} else if (headTs !== anchorHeadTs || messages.length < lastCount) {
				reset(headTs)
			}
			lastCount = messages.length

			if (typeof omittedHint === "number") {
				tombstoned = omittedHint
			} else {
				tombstoned = 0
			}

			return projectAll(messages)
		},
	}
}

// kilocode_change start: per-session projector registry for parallel subagent
// conversations. Each subagent session gets its own projector (its own head
// identity / boundary); removing the session releases the projector and its
// identity caches. The webview used to push subagent messages verbatim into
// parallelSessionMessages[sessionId] forever — a 3-day image-reading run
// pushed the renderer to 5.4GB (2026-11-04 field sample) because 9.3.1 only
// bounded the MAIN conversation transcript.
const boundTranscriptProjectors = new Map<string, BoundTranscriptProjector>()

export function getParallelProjector(sessionId: string): BoundTranscriptProjector {
	let projector = boundTranscriptProjectors.get(sessionId)
	if (!projector) {
		projector = createBoundTranscriptProjector()
		boundTranscriptProjectors.set(sessionId, projector)
	}
	return projector
}

/** Drop projectors (and their caches) for sessions that no longer exist. */
export function pruneParallelProjectors(liveSessionIds: Iterable<string>): void {
	for (const sessionId of [...boundTranscriptProjectors.keys()]) {
		let live = false
		for (const id of liveSessionIds) {
			if (id === sessionId) {
				live = true
				break
			}
		}
		if (!live) {
			boundTranscriptProjectors.delete(sessionId)
		}
	}
}
// kilocode_change end
