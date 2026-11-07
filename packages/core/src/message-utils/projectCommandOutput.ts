// kilocode_change - new file
import type { ClineMessage, TokenUsage } from "@roo-code/types"

import { COMMAND_OUTPUT_STRING } from "./consolidateCommands.js"
import { consolidateTokenUsage } from "./consolidateTokenUsage.js"
import { safeJsonParse } from "./safeJsonParse.js"

/** Display-only budget for command output. Storage and model I/O stay full. */
export const COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT = 8_000
const COMMAND_OUTPUT_DISPLAY_HEAD_CHARS = 3_000
const COMMAND_OUTPUT_DISPLAY_TAIL_CHARS = 3_000
const COMMAND_OUTPUT_DISPLAY_MARKER = (omitted: number) =>
	`\n… [truncated ${omitted} chars, expand to load full output] …\n`

/**
 * Host-side IPC bound. 9.3.4 still posted a 16k-row tombstone/cheap-row array
 * (~6.2MB JSON for the 16160-row / 27MB Scientist field). JSON.parse of that
 * array, plus the webview keeping the same 16k objects resident, grew the
 * renderer linearly 400MB→4.1GB over 10h. Compact the posted transcript to
 * row 0 + accounting stubs + an 800-row tail. Storage and model I/O stay full.
 */
export const WEBVIEW_TRANSCRIPT_DISPLAY_TAIL = 800
export const WEBVIEW_TRANSCRIPT_IMAGE_ROWS = 24
/** Display-only cap for tool / reasoning / leftover text inside the tail. */
export const WEBVIEW_TRANSCRIPT_TEXT_CHAR_LIMIT = COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT
/** Per-field cap when shrinking JSON tool/api payloads (re-stringified, so newlines stay escaped). */
const JSON_DISPLAY_FIELD_CHAR_LIMIT = 2_000
const JSON_SAFE_TRUNCATION_MARKER = (omitted: number) => `…[truncated ${omitted} chars]…`

function tombstoneMessageForDisplay(message: ClineMessage): ClineMessage {
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
	if (message.type === "say" && message.say === "api_req_started" && message.text !== undefined) {
		tombstone.text = message.text
	}
	if (message.contextCondense !== undefined) {
		tombstone.contextCondense = message.contextCondense
	}
	return tombstone as ClineMessage
}

function stripImagesForDisplay(message: ClineMessage): ClineMessage {
	const clone: Record<string, unknown> = { ...message }
	delete clone.images
	clone.webviewImagesStripped = true
	return clone as ClineMessage
}

function pickStubTimestamps(row0Ts: number, firstTailTs: number): { apiTs: number; condenseTs: number } {
	if (firstTailTs > row0Ts + 1) {
		const span = firstTailTs - row0Ts
		const apiTs = row0Ts + Math.max(1, Math.floor(span / 3))
		const condenseTs = Math.min(firstTailTs - 1, row0Ts + Math.max(2, Math.floor((2 * span) / 3)))
		if (condenseTs > apiTs) {
			return { apiTs, condenseTs }
		}
		return { apiTs, condenseTs: Math.min(firstTailTs - 1, apiTs + 1) }
	}
	return { apiTs: row0Ts, condenseTs: row0Ts }
}

/**
 * Fold dropped-prefix token/cost totals into two tombstone stubs so TaskHeader
 * metrics survive without shipping 16k api_req rows. Stubs never render.
 */
export function buildPrefixAccountingStubs(
	row0: ClineMessage,
	firstTail: ClineMessage,
	prefixUsage: TokenUsage,
	contextTokens: number,
): ClineMessage[] {
	const { apiTs, condenseTs } = pickStubTimestamps(row0.ts, firstTail.ts)
	const apiStub: ClineMessage = {
		ts: apiTs,
		type: "say",
		say: "api_req_started",
		webviewTombstone: true,
		text: JSON.stringify({
			tokensIn: prefixUsage.totalTokensIn,
			tokensOut: prefixUsage.totalTokensOut,
			...(typeof prefixUsage.totalCacheWrites === "number" ? { cacheWrites: prefixUsage.totalCacheWrites } : {}),
			...(typeof prefixUsage.totalCacheReads === "number" ? { cacheReads: prefixUsage.totalCacheReads } : {}),
			cost: prefixUsage.totalCost,
		}),
	}
	const condenseStub: ClineMessage = {
		ts: condenseTs,
		type: "say",
		say: "condense_context",
		webviewTombstone: true,
		contextCondense: {
			cost: 0,
			prevContextTokens: contextTokens,
			newContextTokens: contextTokens,
			summary: "",
		},
	}
	return [apiStub, condenseStub]
}

function compactTranscriptForDisplay(
	messages: ClineMessage[],
	tail: number,
): { messages: ClineMessage[]; tombstonedCount: number; changed: boolean } {
	if (messages.length <= tail) {
		return { messages, tombstonedCount: 0, changed: false }
	}

	const start = messages.length - tail
	const tombstonedCount = Math.max(0, start - 1)
	const tailRows = messages.slice(start)
	const row0 = messages[0]!
	const prefixUsage = consolidateTokenUsage(messages.slice(0, start))
	const fullUsage = consolidateTokenUsage(messages)
	const stubs = buildPrefixAccountingStubs(row0, tailRows[0]!, prefixUsage, fullUsage.contextTokens)
	return {
		messages: [row0, ...stubs, ...tailRows],
		tombstonedCount,
		changed: true,
	}
}

function applyImageBudget(messages: ClineMessage[], imageRows: number): { messages: ClineMessage[]; changed: boolean } {
	if (imageRows <= 0 || messages.length === 0) {
		return { messages, changed: false }
	}

	const imageTsList: number[] = []
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]!
		if ((message as { webviewTombstone?: boolean }).webviewTombstone === true) {
			continue
		}
		if (message.images !== undefined) {
			imageTsList.push(message.ts)
			if (imageTsList.length >= imageRows) {
				break
			}
		}
	}
	if (imageTsList.length < imageRows) {
		return { messages, changed: false }
	}

	const imageBudgetTs = imageTsList[imageTsList.length - 1]!
	let changed = false
	const next = new Array<ClineMessage>(messages.length)
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i]!
		if (message.ts < imageBudgetTs && message.images !== undefined) {
			next[i] = stripImagesForDisplay(message)
			changed = true
		} else {
			next[i] = message
		}
	}
	return { messages: changed ? next : messages, changed }
}

/**
 * Drop historical payloads before they cross the extension→webview IPC.
 * Row 0 (task header) and the newest WEBVIEW_TRANSCRIPT_DISPLAY_TAIL rows
 * stay intact; older rows are omitted (not shipped as tombstones/cheap-rows).
 * Prefix token/cost totals fold into two display-only stubs. Image blobs
 * inside the tail are capped to the newest WEBVIEW_TRANSCRIPT_IMAGE_ROWS.
 */
export function projectTranscriptBoundForDisplay(
	messages: ClineMessage[],
	tail = WEBVIEW_TRANSCRIPT_DISPLAY_TAIL,
	imageRows = WEBVIEW_TRANSCRIPT_IMAGE_ROWS,
): ClineMessage[] {
	return projectTranscriptBoundForDisplayWithMeta(messages, tail, imageRows).messages
}

export function projectTranscriptBoundForDisplayWithMeta(
	messages: ClineMessage[],
	tail = WEBVIEW_TRANSCRIPT_DISPLAY_TAIL,
	imageRows = WEBVIEW_TRANSCRIPT_IMAGE_ROWS,
): { messages: ClineMessage[]; tombstonedCount: number } {
	if (messages.length === 0) {
		return { messages, tombstonedCount: 0 }
	}

	const compacted = compactTranscriptForDisplay(messages, tail)
	const imaged = applyImageBudget(compacted.messages, imageRows)
	return {
		messages: imaged.changed || compacted.changed ? imaged.messages : messages,
		tombstonedCount: compacted.tombstonedCount,
	}
}

export function isCommandDisplayMessage(message: Pick<ClineMessage, "ask" | "say">): boolean {
	return message.ask === "command" || message.ask === "command_output" || message.say === "command_output"
}

export function truncateDisplayOutput(output: string): string {
	if (output.length <= COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT) {
		return output
	}

	const omitted = output.length - COMMAND_OUTPUT_DISPLAY_HEAD_CHARS - COMMAND_OUTPUT_DISPLAY_TAIL_CHARS
	if (omitted <= 0) {
		return output
	}

	const projected =
		output.slice(0, COMMAND_OUTPUT_DISPLAY_HEAD_CHARS) +
		COMMAND_OUTPUT_DISPLAY_MARKER(omitted) +
		output.slice(-COMMAND_OUTPUT_DISPLAY_TAIL_CHARS)

	return projected.length < output.length ? projected : output
}

export function truncateCommandOutputText(text: string): string {
	const index = text.indexOf(COMMAND_OUTPUT_STRING)

	if (index === -1) {
		return truncateDisplayOutput(text)
	}

	const prefix = text.slice(0, index + COMMAND_OUTPUT_STRING.length)
	const projectedOutput = truncateDisplayOutput(text.slice(index + COMMAND_OUTPUT_STRING.length))
	const projected = prefix + projectedOutput

	return projected.length < text.length ? projected : text
}

function stripApiReqRequestForDisplay(text: string): string {
	const parsed = safeJsonParse<Record<string, unknown>>(text)
	if (!parsed || typeof parsed !== "object" || parsed.request === undefined) {
		return text
	}

	const { request: _request, ...rest } = parsed
	try {
		const projected = JSON.stringify(rest)
		return projected.length < text.length ? projected : text
	} catch {
		return text
	}
}

function looksLikeJsonPayload(text: string): boolean {
	const trimmed = text.trimStart()
	return trimmed.startsWith("{") || trimmed.startsWith("[")
}

function shrinkJsonStringField(value: string): string {
	if (value.length <= JSON_DISPLAY_FIELD_CHAR_LIMIT) {
		return value
	}
	const omitted = value.length - JSON_DISPLAY_FIELD_CHAR_LIMIT
	return value.slice(0, JSON_DISPLAY_FIELD_CHAR_LIMIT) + JSON_SAFE_TRUNCATION_MARKER(omitted)
}

function shrinkJsonValue(value: unknown, depth = 0): unknown {
	if (depth > 8) {
		return value
	}
	if (typeof value === "string") {
		return shrinkJsonStringField(value)
	}
	if (Array.isArray(value)) {
		return value.map((item) => shrinkJsonValue(item, depth + 1))
	}
	if (value && typeof value === "object") {
		const next: Record<string, unknown> = {}
		for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
			next[key] = shrinkJsonValue(nested, depth + 1)
		}
		return next
	}
	return value
}

/**
 * Shrink JSON tool/api payloads by truncating string fields then re-stringify.
 * Never slice the raw JSON text: a 3000-char cut injects a raw newline into a
 * string literal and ChatView JSON.parse throws (9.3.5 field crash).
 */
export function projectJsonTextForDisplay(text: string): string {
	if (!looksLikeJsonPayload(text)) {
		return text.length > WEBVIEW_TRANSCRIPT_TEXT_CHAR_LIMIT ? truncateDisplayOutput(text) : text
	}

	const parsed = safeJsonParse<unknown>(text)
	if (parsed === undefined || typeof parsed !== "object" || parsed === null) {
		return text
	}

	try {
		const projected = JSON.stringify(shrinkJsonValue(parsed))
		return projected.length < text.length ? projected : text
	} catch {
		return text
	}
}

export function projectCommandMessageForDisplay(message: ClineMessage): ClineMessage {
	if ((message as { webviewTombstone?: boolean }).webviewTombstone === true) {
		return message
	}

	let next: ClineMessage = message

	if (isCommandDisplayMessage(next) && next.text) {
		const projectedText = truncateCommandOutputText(next.text)
		if (projectedText !== next.text) {
			next = {
				...next,
				text: projectedText,
				commandOutputTruncated: true,
				commandOutputOriginalLength: message.text!.length,
			}
		}
	} else if (next.type === "say" && next.say === "api_req_started" && next.text) {
		const projectedText = projectJsonTextForDisplay(stripApiReqRequestForDisplay(next.text))
		if (projectedText !== next.text) {
			next = { ...next, text: projectedText }
		}
	} else if (next.text && (next.ask === "tool" || looksLikeJsonPayload(next.text))) {
		const projectedText = projectJsonTextForDisplay(next.text)
		if (projectedText !== next.text) {
			next = { ...next, text: projectedText }
		}
	} else if (next.text && next.text.length > WEBVIEW_TRANSCRIPT_TEXT_CHAR_LIMIT) {
		const projectedText = truncateDisplayOutput(next.text)
		if (projectedText !== next.text) {
			next = { ...next, text: projectedText }
		}
	}

	if (next.reasoning && next.reasoning.length > WEBVIEW_TRANSCRIPT_TEXT_CHAR_LIMIT) {
		const projectedReasoning = truncateDisplayOutput(next.reasoning)
		if (projectedReasoning !== next.reasoning) {
			next = { ...next, reasoning: projectedReasoning }
		}
	}

	return next
}

/**
 * Project a live commandExecutionStatus JSON payload for the webview. Only the
 * `output` variant is rewritten; started/exited/fallback/timeout stay intact so
 * Run/Kill/Continue controls keep working. Storage and model I/O stay full.
 */
export function projectCommandExecutionStatusTextForDisplay(text: string): string {
	const parsed = safeJsonParse<{ status?: string; output?: string }>(text)
	if (!parsed || parsed.status !== "output" || typeof parsed.output !== "string") {
		return text
	}

	const projectedOutput = truncateDisplayOutput(parsed.output)
	if (projectedOutput === parsed.output) {
		return text
	}

	return JSON.stringify({ ...parsed, output: projectedOutput })
}

/**
 * Project UI transcripts for the webview. Historical rows are omitted
 * before they cross IPC (so JSON.parse never inflates the renderer with a
 * 16k-row tombstone array). Command/tool/api_req rows in the verbatim tail
 * send a short preview, including the in-flight partial command. Callers
 * must not persist the returned array. Expand still loads storage via
 * requestCommandOutput.
 */
export function projectClineMessagesForDisplay(messages: ClineMessage[]): ClineMessage[] {
	return projectClineMessagesForDisplayWithMeta(messages).messages
}

export function projectClineMessagesForDisplayWithMeta(messages: ClineMessage[]): {
	messages: ClineMessage[]
	tombstonedCount: number
} {
	if (messages.length === 0) {
		return { messages, tombstonedCount: 0 }
	}

	const bounded = projectTranscriptBoundForDisplayWithMeta(messages)
	let changed = bounded.messages !== messages
	const projected = bounded.messages.map((message) => {
		if ((message as { webviewTombstone?: boolean }).webviewTombstone === true) {
			return message
		}

		const next = projectCommandMessageForDisplay(message)

		if (next !== message) {
			changed = true
		}

		return next
	})

	return {
		messages: changed ? projected : messages,
		tombstonedCount: bounded.tombstonedCount,
	}
}

// Keep the helper available for tests that still assert tombstone shape.
export { tombstoneMessageForDisplay }
