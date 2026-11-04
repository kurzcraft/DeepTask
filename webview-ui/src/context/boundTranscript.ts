// kilocode_change - new file
import type { ClineMessage } from "@roo-code/types"

/**
 * Bounded transcript projection for the webview (kilocode_change).
 *
 * The renderer heap previously grew without bound because the webview held
 * every ClineMessage verbatim for the lifetime of the conversation (full text,
 * reasoning, base64 images). Streaming `messageUpdated` appends plus full-state
 * snapshots both accumulate into the same slice, so a 7k-row session parked
 * gigabytes of strings inside the renderer zygote and pinned the heap at
 * jsHeapSizeLimit (90-91% memory banner, renderer RSS 4.2GB @ 2026-11-01).
 *
 * This projector keeps a fixed tail window verbatim and replaces older rows
 * with tombstones preserving ONLY fields downstream consumers read:
 *   - ts / type / say / ask / partial / isAnswered: visibility filters
 *     (visibleMessages), ask-state effects, rail ticks, computeItemKey.
 *   - `say: "api_req_started"` keeps text: consolidateTokenUsage parses it for
 *     cumulative token/cost totals; dropping it would reset the task totals.
 *   - checkpoint objects are small; kept so checkpoint pairing survives.
 *   - Row 0 (the `task` row) is NEVER tombstoned: KiloTaskHeader renders its
 *     text/metadata.
 *
 * Identity stability contract (critical for the incremental caches in
 * consolidateCommandsIncremental / consolidateTokenUsageIncremental /
 * filterVisibleMessagesIncremental):
 *   - Tombstones are cached per ts and returned by reference forever.
 *   - The verbatim/tombstone boundary (a ts high-water mark) advances in
 *     batches only when the verbatim region exceeds TAIL + HYSTERESIS rows, so
 *     ordinary streaming appends never change the identity of any existing
 *     row. Each batch advance invalidates the prefix exactly once.
 *   - Shrink (task switch / rewind / branch replacement) resets the projector
 *     instead of serving stale tombstones from another branch.
 *
 * Storage and model I/O are untouched — the host still persists and replays
 * full transcripts; only the webview's resident copy is bounded.
 */

/** Verbatim tail size. 800 messages ≈ a few MB worst case, covers any realistic scrollback. */
export const BOUND_TRANSCRIPT_TAIL = 800
/** Extra verbatim rows tolerated before the boundary advances (batch amortization). */
export const BOUND_TRANSCRIPT_HYSTERESIS = 256
// kilocode_change start: image budget — loop image-reading tasks stack hundreds of
// MB-scale base64 strings inside the verbatim window (UTF-16 doubles ASCII base64),
// so the tail window alone is not a bound. Keep images on the most recent
// image-bearing rows only; older rows keep their text but drop the blobs.
export const BOUND_TRANSCRIPT_IMAGE_ROWS = 24
// kilocode_change end

function isCheapRow(message: ClineMessage): boolean {
	// Rows that carry no heavy payloads at all — cloning them buys nothing.
	return message.text === undefined && message.images === undefined && message.reasoning === undefined
}

// kilocode_change start: stripImagesFor — clone a row without its images payload.
// Cached per-ts exactly like tombstones so identity stays stable across calls.
function stripImagesFor(message: ClineMessage): ClineMessage {
	const clone: Record<string, unknown> = { ...message }
	delete clone.images
	clone.webviewImagesStripped = true
	return clone as ClineMessage
}
// kilocode_change end

function tombstoneFor(message: ClineMessage): ClineMessage {
	const tombstone: Record<string, unknown> = {
		ts: message.ts,
		type: message.type,
		webviewTombstone: true,
	}
	if (message.ask !== undefined) tombstone.ask = message.ask
	if (message.say !== undefined) tombstone.say = message.say
	if (message.partial !== undefined) tombstone.partial = message.partial
	if (message.isAnswered !== undefined) tombstone.isAnswered = message.isAnswered
	if (message.checkpoint !== undefined) tombstone.checkpoint = message.checkpoint
	if (message.conversationHistoryIndex !== undefined) {
		tombstone.conversationHistoryIndex = message.conversationHistoryIndex
	}
	// Token/cost accounting sources. Small JSON (~200B); keep verbatim.
	if (message.type === "say" && message.say === "api_req_started" && message.text !== undefined) {
		tombstone.text = message.text
	}
	if (message.contextCondense !== undefined) {
		tombstone.contextCondense = message.contextCondense
	}
	return tombstone as ClineMessage
}

/** First index whose ts is >= the high-water mark (transcripts are ts-sorted). */
function boundaryIndex(messages: readonly ClineMessage[], highWaterTs: number | undefined): number {
	if (highWaterTs === undefined) {
		return 0
	}
	for (let i = 0; i < messages.length; i++) {
		if (messages[i]!.ts >= highWaterTs) {
			return i
		}
	}
	return messages.length
}

export interface BoundTranscriptProjector {
	project(messages: readonly ClineMessage[]): ClineMessage[]
	/** Number of distinct rows currently tombstoned (diagnostics). */
	readonly tombstonedCount: number
}

export function createBoundTranscriptProjector(
	tail = BOUND_TRANSCRIPT_TAIL,
	hysteresis = BOUND_TRANSCRIPT_HYSTERESIS,
	// kilocode_change: image budget is injectable for tests (default keeps the
	// newest BOUND_TRANSCRIPT_IMAGE_ROWS image-bearing rows with images).
	imageRows = BOUND_TRANSCRIPT_IMAGE_ROWS,
): BoundTranscriptProjector {
	let highWaterTs: number | undefined // rows with ts < highWaterTs are tombstoned
	let anchorHeadTs: number | undefined // conversation identity guard
	let tombstones = new Map<number, ClineMessage>()
	let tombstoned = 0

	const reset = (headTs: number | undefined) => {
		highWaterTs = undefined
		anchorHeadTs = headTs
		tombstones = new Map()
		tombstoned = 0
		// kilocode_change: image-strip cache follows the same lifecycle as tombstones
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
		// Find the ts boundary: keep images on the newest `imageRows` image-bearing
		// rows (verbatim window only; tombstoned rows already lost theirs).
		const imageTsList: number[] = []
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i]!
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
			// Everyone keeps images — but rows previously stripped must stay
			// stripped-object-stable if they re-enter the budget window on rewind?
			// Rewind resets below; treat budget-window growth as a reset too.
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
		project(messages: readonly ClineMessage[]): ClineMessage[] {
			if (messages.length === 0) {
				return messages as ClineMessage[]
			}

			// Task switch / branch replacement: a new head must not reuse
			// tombstones from the previous branch.
			const headTs = messages[0]!.ts
			if (anchorHeadTs === undefined) {
				anchorHeadTs = headTs
			} else if (headTs !== anchorHeadTs) {
				reset(headTs)
			}

			let start = boundaryIndex(messages, highWaterTs)
			const verbatimCount = messages.length - start

			if (verbatimCount > tail + hysteresis) {
				// Advance the boundary in one batch: recompute so exactly
				// `tail` verbatim rows remain behind the newest row region.
				start = messages.length - tail
				highWaterTs = messages[start]!.ts
			} else if (verbatimCount < tail && highWaterTs !== undefined && start >= messages.length) {
				// Boundary fell off the end of a shrinking transcript (rewind):
				// clear it so survivors render verbatim again.
				reset(headTs)
			}

			if (highWaterTs === undefined) {
				// kilocode_change: even without tombstones the image budget applies
				return projectImages(messages)
			}

			const out: ClineMessage[] = new Array(messages.length)
			for (let i = 0; i < messages.length; i++) {
				const message = messages[i]!
				if (i === 0 || message.ts >= highWaterTs!) {
					out[i] = message
					continue
				}
				if (isCheapRow(message)) {
					out[i] = message
					continue
				}
				let tombstone = tombstones.get(message.ts)
				if (!tombstone) {
					tombstone = tombstoneFor(message)
					tombstones.set(message.ts, tombstone)
					tombstoned++
				}
				out[i] = tombstone
			}
			// kilocode_change: rows below the tombstone boundary are replaced by
			// small tombstones now — drop their image-strip clones from the cache
			// or the clones keep pinning full `text` payloads forever.
			if (imageStripped.size > 0) {
				for (const ts of imageStripped.keys()) {
					if (ts < highWaterTs!) {
						imageStripped.delete(ts)
					}
				}
			}
			// kilocode_change: apply the image budget to the verbatim window
			return projectImages(out)
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
