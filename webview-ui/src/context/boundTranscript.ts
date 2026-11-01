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

function isCheapRow(message: ClineMessage): boolean {
	// Rows that carry no heavy payloads at all — cloning them buys nothing.
	return message.text === undefined && message.images === undefined && message.reasoning === undefined
}

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
	}

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
				return messages as ClineMessage[]
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
			return out
		},
	}
}
