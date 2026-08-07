import { Task } from "../task/Task"
import { ClineMessage } from "@roo-code/types"
import { ApiMessage } from "../task-persistence/apiMessages"
import { cleanupAfterTruncation, sanitizeNativeToolHistory } from "../condense"

export interface RewindOptions {
	/** Whether to include the target message in deletion (edit=true, delete=false) */
	includeTargetMessage?: boolean
	/** Skip cleanup for special cases (default: false) */
	skipCleanup?: boolean
	/**
	 * Remove every API message at or after the UI cutoff, even when timestamps are
	 * skewed by streaming races. Required for edited resends because all content
	 * after the edited message belongs to the discarded branch.
	 */
	strictCutoff?: boolean
	/** Exact API-history index of the replaced UI message, when available. */
	apiCutoffIndex?: number
}

interface ContextEventIds {
	condenseIds: Set<string>
	truncationIds: Set<string>
}

/**
 * MessageManager provides centralized handling for all conversation rewind operations.
 *
 * This ensures that whenever UI chat history is rewound (delete, edit, checkpoint restore, etc.),
 * the API conversation history is properly maintained, including:
 * - Removing orphaned Summary messages when their condense_context is removed
 * - Removing orphaned truncation markers when their sliding_window_truncation is removed
 * - Cleaning up orphaned condenseParent/truncationParent tags
 *
 * Usage (always access via Task.messageManager getter):
 * ```typescript
 * await task.messageManager.rewindToTimestamp(messageTs, { includeTargetMessage: false })
 * ```
 *
 * @see Task.messageManager - The getter that provides lazy-initialized access to this manager
 */
export class MessageManager {
	constructor(private task: Task) {}

	/**
	 * Rewind conversation to a specific timestamp.
	 * This is the SINGLE entry point for all message deletion operations.
	 *
	 * @param ts - The timestamp to rewind to
	 * @param options - Rewind options
	 * @throws Error if timestamp not found in clineMessages
	 */
	async rewindToTimestamp(ts: number, options: RewindOptions = {}): Promise<void> {
		const { includeTargetMessage = false, skipCleanup = false, strictCutoff = false, apiCutoffIndex } = options

		// Find the index in clineMessages
		const clineIndex = this.task.clineMessages.findIndex((m) => m.ts === ts)
		if (clineIndex === -1) {
			throw new Error(`Message with timestamp ${ts} not found in clineMessages`)
		}

		// Calculate the actual cutoff index
		const cutoffIndex = includeTargetMessage ? clineIndex + 1 : clineIndex

		await this.performRewind(cutoffIndex, ts, { skipCleanup, strictCutoff, apiCutoffIndex })
	}

	/**
	 * Rewind conversation to a specific index in clineMessages.
	 * Keeps messages [0, toIndex) and removes [toIndex, end].
	 *
	 * @param toIndex - The index to rewind to (exclusive)
	 * @param options - Rewind options
	 */
	async rewindToIndex(toIndex: number, options: RewindOptions = {}): Promise<void> {
		const cutoffTs = this.task.clineMessages[toIndex]?.ts ?? Date.now()
		await this.performRewind(toIndex, cutoffTs, options)
	}

	/**
	 * Internal method that performs the actual rewind operation.
	 */
	private async performRewind(toIndex: number, cutoffTs: number, options: RewindOptions): Promise<void> {
		const { skipCleanup = false, strictCutoff = false, apiCutoffIndex } = options

		// An edited resend discards a branch while its stream or tool promise can
		// still be resolving. Freeze normal writes before computing or persisting the
		// prefix; only this rewind's explicit force writes may commit afterwards.
		if (strictCutoff) {
			this.task.freezeHistoryPersistenceForBranchReplacement?.()
		}

		// Step 1: Collect context event IDs from messages being removed
		const removedIds = this.collectRemovedContextEventIds(toIndex)

		// Step 2: Truncate clineMessages
		await this.truncateClineMessages(toIndex, strictCutoff)

		// Step 3: Truncate and clean API history (combined with cleanup for efficiency)
		await this.truncateApiHistoryWithCleanup(cutoffTs, removedIds, skipCleanup, strictCutoff, apiCutoffIndex)
	}

	/**
	 * Collect condenseIds and truncationIds from context-management events
	 * that will be removed during the rewind.
	 *
	 * This is critical for maintaining the linkage between:
	 * - condense_context (clineMessage) ↔ Summary (apiMessage)
	 * - sliding_window_truncation (clineMessage) ↔ Truncation marker (apiMessage)
	 */
	private collectRemovedContextEventIds(fromIndex: number): ContextEventIds {
		const condenseIds = new Set<string>()
		const truncationIds = new Set<string>()

		for (let i = fromIndex; i < this.task.clineMessages.length; i++) {
			const msg = this.task.clineMessages[i]

			// Collect condenseIds from condense_context events
			if (msg.say === "condense_context" && msg.contextCondense?.condenseId) {
				condenseIds.add(msg.contextCondense.condenseId)
				console.log(`[MessageManager] Found condense_context to remove: ${msg.contextCondense.condenseId}`)
			}

			// Collect truncationIds from sliding_window_truncation events
			if (msg.say === "sliding_window_truncation" && msg.contextTruncation?.truncationId) {
				truncationIds.add(msg.contextTruncation.truncationId)
				console.log(
					`[MessageManager] Found sliding_window_truncation to remove: ${msg.contextTruncation.truncationId}`,
				)
			}
		}

		return { condenseIds, truncationIds }
	}

	/**
	 * Truncate clineMessages to the specified index.
	 */
	private async truncateClineMessages(toIndex: number, force: boolean): Promise<void> {
		const messages = this.task.clineMessages.slice(0, toIndex)
		if (force) {
			await this.task.overwriteClineMessages(messages, { force: true })
		} else {
			await this.task.overwriteClineMessages(messages)
		}
	}

	/**
	 * Truncate API history by timestamp, remove orphaned summaries/markers,
	 * and clean up orphaned tags - all in a single write operation.
	 *
	 * This combined approach:
	 * 1. Avoids multiple writes to API history
	 * 2. Only writes if the history actually changed
	 * 3. Handles both truncation and cleanup atomically
	 *
	 * Note on timestamp handling:
	 * Due to async execution during streaming, clineMessage timestamps may not
	 * perfectly align with API message timestamps. Specifically, a "user_feedback"
	 * clineMessage can have a timestamp BEFORE the assistant API message that
	 * triggered it (because tool execution happens concurrently with stream
	 * completion). To handle this race condition, we find the first API user
	 * message at or after the cutoff and use its timestamp as the actual boundary.
	 */
	private async truncateApiHistoryWithCleanup(
		cutoffTs: number,
		removedIds: ContextEventIds,
		skipCleanup: boolean,
		strictCutoff: boolean,
		apiCutoffIndex?: number,
	): Promise<void> {
		const originalHistory = this.task.apiConversationHistory
		let apiHistory = [...originalHistory]

		// An exact API index is safer than timestamps for edits: timestamp races and
		// legacy entries without `ts` must not allow discarded-branch context through.
		const hasValidApiCutoffIndex =
			strictCutoff &&
			typeof apiCutoffIndex === "number" &&
			apiCutoffIndex >= 0 &&
			apiCutoffIndex <= apiHistory.length
		if (hasValidApiCutoffIndex) {
			apiHistory = apiHistory.slice(0, apiCutoffIndex)
		}

		// Step 1: Determine the actual cutoff timestamp
		// Check if there's an API message with an exact timestamp match
		const hasExactMatch = apiHistory.some((m) => m.ts === cutoffTs)
		// Check if there are any messages before the cutoff that would be preserved
		const hasMessageBeforeCutoff = apiHistory.some((m) => m.ts !== undefined && m.ts < cutoffTs)

		let actualCutoff: number = cutoffTs

		if (!hasValidApiCutoffIndex && !strictCutoff && !hasExactMatch && hasMessageBeforeCutoff) {
			// No exact match but there are earlier messages means we might have a race
			// condition where the clineMessage timestamp is earlier than any API message
			// due to async execution. In this case, look for the first API user message
			// at or after the cutoff to use as the actual boundary.
			// This preserves assistant messages that preceded the user's response for
			// ordinary delete/rewind operations. Edited resends opt into strictCutoff so
			// no assistant output from the discarded branch can leak into the new turn.
			const firstUserMsgIndexToRemove = apiHistory.findIndex(
				(m) => m.ts !== undefined && m.ts >= cutoffTs && m.role === "user",
			)

			if (firstUserMsgIndexToRemove !== -1) {
				// Use the user message's timestamp as the actual cutoff
				actualCutoff = apiHistory[firstUserMsgIndexToRemove].ts!
			}
			// else: no user message found, use original cutoffTs (fallback)
		}

		// Step 2: Filter by timestamp unless an exact structural boundary was used.
		// A non-timestamped message cannot be proven to predate an edited branch, so
		// strict edit rewinds discard it instead of allowing stale context to leak.
		if (!hasValidApiCutoffIndex) {
			apiHistory = apiHistory.filter((m) =>
				strictCutoff ? m.ts !== undefined && m.ts < actualCutoff : !m.ts || m.ts < actualCutoff,
			)
		}

		// Step 3: Remove Summaries whose condense_context was removed
		if (removedIds.condenseIds.size > 0) {
			apiHistory = apiHistory.filter((msg) => {
				if (msg.isSummary && msg.condenseId && removedIds.condenseIds.has(msg.condenseId)) {
					console.log(`[MessageManager] Removing orphaned Summary with condenseId: ${msg.condenseId}`)
					return false
				}
				return true
			})
		}

		// Step 4: Remove truncation markers whose sliding_window_truncation was removed
		if (removedIds.truncationIds.size > 0) {
			apiHistory = apiHistory.filter((msg) => {
				if (msg.isTruncationMarker && msg.truncationId && removedIds.truncationIds.has(msg.truncationId)) {
					console.log(
						`[MessageManager] Removing orphaned truncation marker with truncationId: ${msg.truncationId}`,
					)
					return false
				}
				return true
			})
		}

		// Step 5: Cleanup orphaned tags (unless skipped)
		if (!skipCleanup) {
			apiHistory = cleanupAfterTruncation(apiHistory)
		}

		// Step 6: Rewind can cut between an assistant tool_use and its following
		// user tool_result. Never persist that orphaned protocol boundary: the next
		// resend would otherwise be rejected by native-tool providers.
		apiHistory = sanitizeNativeToolHistory(apiHistory)

		// A strict edit must always commit and await an API-history write, even when
		// the calculated prefix happens to equal the in-memory array. An earlier
		// asynchronous save from the discarded instance may already be running; without
		// this forced, ordered commit, task rehydration can read that stale disk snapshot
		// before the replacement Task is created.
		const historyChanged =
			apiHistory.length !== originalHistory.length || apiHistory.some((msg, i) => msg !== originalHistory[i])

		if (strictCutoff) {
			await this.task.overwriteApiConversationHistory(apiHistory, { force: true })
		} else if (historyChanged) {
			await this.task.overwriteApiConversationHistory(apiHistory)
		}
	}
}
