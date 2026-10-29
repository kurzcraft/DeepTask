import type { ClineAsk, ClineMessage } from "@roo-code/types"

const ALWAYS_HIDDEN_ONCE_PROCESSED_ASK: readonly ClineAsk[] = [
	"api_req_failed",
	"resume_task",
	"resume_completed_task",
]

const ALWAYS_HIDDEN_ONCE_PROCESSED_SAY = [
	"api_req_finished",
	"api_req_retried",
	"api_req_deleted",
	"mcp_server_request_started",
] as const

export type EverVisibleCache = {
	has(ts: number): boolean
	set(ts: number, value: boolean): void
}

function collectUserMessageCheckpointHashes(
	messages: readonly ClineMessage[],
	from = 0,
	into?: Set<string>,
): Set<string> {
	const hashes = into ?? new Set<string>()
	for (let i = from; i < messages.length; i++) {
		const msg = messages[i]
		if (
			msg?.say === "user_feedback" &&
			msg.checkpoint &&
			(msg.checkpoint as { type?: string; hash?: string }).type === "user_message" &&
			(msg.checkpoint as { hash?: string }).hash
		) {
			hashes.add((msg.checkpoint as { hash: string }).hash)
		}
	}
	return hashes
}

function shouldShowMessage(
	message: ClineMessage,
	messages: readonly ClineMessage[],
	taskTs: number | undefined,
	userMessageCheckpointHashes: Set<string>,
	everVisible: EverVisibleCache,
): boolean {
	if (taskTs !== undefined && message.ts === taskTs) {
		return false
	}

	if (message.say === "checkpoint_saved") {
		if (
			message.checkpoint &&
			typeof message.checkpoint === "object" &&
			"suppressMessage" in message.checkpoint &&
			message.checkpoint.suppressMessage
		) {
			return false
		}
		if (message.text && userMessageCheckpointHashes.has(message.text)) {
			return false
		}
	}

	if (everVisible.has(message.ts)) {
		if (message.ask && ALWAYS_HIDDEN_ONCE_PROCESSED_ASK.includes(message.ask)) return false
		if (message.say && (ALWAYS_HIDDEN_ONCE_PROCESSED_SAY as readonly string[]).includes(message.say)) {
			return false
		}
		if (message.say === "text" && (message.text ?? "") === "" && (message.images?.length ?? 0) === 0) {
			return false
		}
		return true
	}

	switch (message.ask) {
		case "completion_result":
			if (message.text === "") return false
			break
		case "api_req_failed":
		case "resume_task":
		case "resume_completed_task":
			return false
	}
	switch (message.say) {
		case "api_req_finished":
		case "api_req_retried":
		case "api_req_deleted":
			return false
		case "api_req_retry_delayed":
		case "api_req_rate_limit_wait": {
			const last1 = messages.at(-1)
			const last2 = messages.at(-2)
			if (last1?.ask === "resume_task" && last2 === message) {
				return true
			} else if (message !== last1) {
				return false
			}
			break
		}
		case "text":
			if ((message.text ?? "") === "" && (message.images?.length ?? 0) === 0) return false
			break
		case "mcp_server_request_started":
			return false
	}
	return true
}

function markViewportVisible(visible: readonly ClineMessage[], everVisible: EverVisibleCache): void {
	const viewportStart = Math.max(0, visible.length - 100)
	for (let i = viewportStart; i < visible.length; i++) {
		everVisible.set(visible[i].ts, true)
	}
}

function findCommonPrefixLength(current: readonly ClineMessage[], previous: readonly ClineMessage[]): number {
	const max = Math.min(current.length, previous.length)
	let i = 0
	while (i < max && current[i] === previous[i]) {
		i++
	}
	return i
}

function prefixHidesExistingCheckpoint(
	messages: readonly ClineMessage[],
	prefixLength: number,
	newHashes: Set<string>,
): boolean {
	if (newHashes.size === 0) {
		return false
	}
	for (let i = 0; i < prefixLength; i++) {
		const msg = messages[i]
		if (msg.say === "checkpoint_saved" && msg.text && newHashes.has(msg.text)) {
			return true
		}
	}
	return false
}

function reusedVisiblePrefixCount(
	previousInput: readonly ClineMessage[],
	previousOutput: readonly ClineMessage[],
	prefixLength: number,
): number {
	let keep = 0
	let src = 0
	for (let i = 0; i < previousOutput.length; i++) {
		const out = previousOutput[i]
		while (src < prefixLength && previousInput[src] !== out) {
			src++
		}
		if (src >= prefixLength) {
			break
		}
		keep++
		src++
	}
	return keep
}

function prefixNeedsDelayedReeval(
	previousInput: readonly ClineMessage[],
	commonPrefixLength: number,
	messages: readonly ClineMessage[],
): boolean {
	const last1 = messages.at(-1)
	const last2 = messages.at(-2)
	const start = Math.max(0, commonPrefixLength - 2)
	for (let i = start; i < commonPrefixLength; i++) {
		const msg = previousInput[i]
		if (msg?.say !== "api_req_retry_delayed" && msg?.say !== "api_req_rate_limit_wait") {
			continue
		}
		const stillVisible = msg === last1 || (last1?.ask === "resume_task" && msg === last2)
		if (!stillVisible) {
			return true
		}
	}
	return false
}

export function filterVisibleMessages(
	messages: readonly ClineMessage[],
	taskTs: number | undefined,
	everVisible: EverVisibleCache,
): ClineMessage[] {
	const userMessageCheckpointHashes = collectUserMessageCheckpointHashes(messages)
	const visible: ClineMessage[] = []
	for (const message of messages) {
		if (shouldShowMessage(message, messages, taskTs, userMessageCheckpointHashes, everVisible)) {
			visible.push(message)
		}
	}
	markViewportVisible(visible, everVisible)
	return visible
}

/**
 * Streaming ticks keep prefix object identity. Reuse the already-filtered
 * prefix instead of allocating a new visible list from the whole transcript.
 * Task switches, rewinds, and checkpoint hashes that hide earlier rows still
 * take the full path so visibility stays identical.
 */
export function filterVisibleMessagesIncremental(
	messages: readonly ClineMessage[],
	previousInput: readonly ClineMessage[],
	previousOutput: readonly ClineMessage[],
	taskTs: number | undefined,
	everVisible: EverVisibleCache,
): ClineMessage[] {
	if (previousInput.length === 0 || (previousOutput.length === 0 && previousInput.length > 0)) {
		return filterVisibleMessages(messages, taskTs, everVisible)
	}

	if (messages.length < previousInput.length) {
		return filterVisibleMessages(messages, taskTs, everVisible)
	}

	const commonPrefixLength = findCommonPrefixLength(messages, previousInput)
	if (commonPrefixLength === 0) {
		return filterVisibleMessages(messages, taskTs, everVisible)
	}

	if (commonPrefixLength === messages.length && messages.length === previousInput.length) {
		markViewportVisible(previousOutput, everVisible)
		return previousOutput as ClineMessage[]
	}

	if (prefixNeedsDelayedReeval(previousInput, commonPrefixLength, messages)) {
		return filterVisibleMessages(messages, taskTs, everVisible)
	}

	const newHashes = collectUserMessageCheckpointHashes(messages, commonPrefixLength)
	if (prefixHidesExistingCheckpoint(messages, commonPrefixLength, newHashes)) {
		return filterVisibleMessages(messages, taskTs, everVisible)
	}

	const keep = reusedVisiblePrefixCount(previousInput, previousOutput, commonPrefixLength)
	const hashes = collectUserMessageCheckpointHashes(messages, 0, newHashes)
	const suffixVisible: ClineMessage[] = []
	for (let i = commonPrefixLength; i < messages.length; i++) {
		const message = messages[i]
		if (shouldShowMessage(message, messages, taskTs, hashes, everVisible)) {
			suffixVisible.push(message)
		}
	}

	if (keep === previousOutput.length && suffixVisible.length === 0) {
		markViewportVisible(previousOutput, everVisible)
		return previousOutput as ClineMessage[]
	}

	const next =
		keep === 0 ? suffixVisible : keep === previousOutput.length ? previousOutput.concat(suffixVisible) : previousOutput.slice(0, keep).concat(suffixVisible)
	markViewportVisible(next, everVisible)
	return next
}
