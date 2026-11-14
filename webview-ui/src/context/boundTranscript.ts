// kilocode_change - new file
import type { ClineMessage } from "@roo-code/types"

/**
 * Bounded transcript projection for the webview (kilocode_change).
 *
 * 9.3.6 sliding 64-row pages broke scroll continuity. Keep every row in one
 * Virtuoso list. Host already cheap-previews historical payloads; this
 * projector only enforces the image budget so streaming `messageUpdated`
 * cannot re-inflate stripped blobs. Storage and model I/O stay full.
 *
 * Identity stability contract (critical for the incremental caches in
 * consolidateCommandsIncremental / consolidateTokenUsageIncremental /
 * filterVisibleMessagesIncremental):
 *   - Ordinary streaming appends keep every existing row's object identity.
 *   - Image-strip clones are cached per ts+source and rebuilt only when the
 *     source row object changes.
 *   - Shrink (task switch / rewind / branch replacement) resets the projector.
 */

/** Kept for tests/host alignment: newest rows stay 8k-truncated on the host. */
export const BOUND_TRANSCRIPT_TAIL = 64
/** Extra verbatim rows tolerated before compacting (unused; paging is gone). */
export const BOUND_TRANSCRIPT_HYSTERESIS = 16
// kilocode_change start: image budget — loop image-reading tasks stack hundreds of
// MB-scale base64 strings (UTF-16 doubles ASCII base64). Keep images on the
// most recent image-bearing rows only; older rows keep their text but drop blobs.
export const BOUND_TRANSCRIPT_IMAGE_ROWS = 4
// kilocode_change end

// kilocode_change start: stripImagesFor — clone a row without its images payload.
// Cached per-ts so identity stays stable across calls.
function stripImagesFor(message: ClineMessage): ClineMessage {
	const clone: Record<string, unknown> = { ...message }
	delete clone.images
	clone.webviewImagesStripped = true
	return clone as ClineMessage
}
// kilocode_change end

export interface BoundTranscriptProjector {
	project(messages: readonly ClineMessage[], omittedHint?: number): ClineMessage[]
	/** Always 0: the continuous list is not omitted. Host may still send 0. */
	readonly tombstonedCount: number
}

export function createBoundTranscriptProjector(
	_tail = BOUND_TRANSCRIPT_TAIL,
	_hysteresis = BOUND_TRANSCRIPT_HYSTERESIS,
	// kilocode_change: image budget is injectable for tests (default keeps the
	// newest BOUND_TRANSCRIPT_IMAGE_ROWS image-bearing rows with images).
	imageRows = BOUND_TRANSCRIPT_IMAGE_ROWS,
): BoundTranscriptProjector {
	let anchorHeadTs: number | undefined // conversation identity guard
	let tombstoned = 0

	const reset = (headTs: number | undefined) => {
		anchorHeadTs = headTs
		tombstoned = 0
		imageStripped = new Map()
		imageBudgetTs = undefined
	}

	// kilocode_change start: image-budget state. imageBudgetTs is the ts of the
	// OLDEST row whose images are still kept; rows with images and ts below it
	// are cloned without images (cached per-ts for identity stability).
	// Cache entries remember their SOURCE row object: messageUpdated replaces a
	// row with a new object (same ts), and the clone must then be rebuilt so the
	// panel shows fresh content, not a stale pre-update clone.
	let imageStripped = new Map<number, { source: ClineMessage; clone: ClineMessage }>()
	let imageBudgetTs: number | undefined
	const projectImages = (messages: readonly ClineMessage[]): ClineMessage[] => {
		const imageTsList: number[] = []
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i]!
			if ((m as { webviewTombstone?: boolean }).webviewTombstone === true) {
				continue
			}
			if ((m as { images?: unknown }).images !== undefined) {
				imageTsList.push(m.ts)
				if (imageTsList.length >= imageRows) break
			}
		}
		if (imageTsList.length < imageRows) {
			imageBudgetTs = undefined
		} else {
			imageBudgetTs = imageTsList[imageTsList.length - 1]
		}
		if (imageBudgetTs === undefined) {
			if (imageStripped.size > 0) {
				imageStripped = new Map()
			}
			return messages as ClineMessage[]
		}
		const out: ClineMessage[] = new Array(messages.length)
		for (let i = 0; i < messages.length; i++) {
			const message = messages[i]!
			if (message.ts < imageBudgetTs! && (message as { images?: unknown }).images !== undefined) {
				let entry = imageStripped.get(message.ts)
				if (!entry || entry.source !== message) {
					entry = { source: message, clone: stripImagesFor(message) }
					imageStripped.set(message.ts, entry)
				}
				out[i] = entry.clone
				continue
			}
			out[i] = message
		}
		return out
	}
	// kilocode_change end

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
				return messages as ClineMessage[]
			}

			const headTs = messages[0]!.ts
			if (anchorHeadTs === undefined) {
				anchorHeadTs = headTs
			} else if (headTs !== anchorHeadTs) {
				reset(headTs)
			}

			if (typeof omittedHint === "number") {
				tombstoned = omittedHint
			} else {
				tombstoned = 0
			}

			return projectImages(messages)
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
