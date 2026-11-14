// kilocode_change - new file
import type { ClineMessage } from "@roo-code/types"

import { COMMAND_OUTPUT_STRING } from "./consolidateCommands.js"
import { safeJsonParse } from "./safeJsonParse.js"

/** Display-only budget for command output. Storage and model I/O stay full. */
export const COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT = 8_000
const COMMAND_OUTPUT_DISPLAY_HEAD_CHARS = 3_000
const COMMAND_OUTPUT_DISPLAY_TAIL_CHARS = 3_000
const COMMAND_OUTPUT_DISPLAY_MARKER = (omitted: number) =>
	`\n… [truncated ${omitted} chars, expand to load full output] …\n`

/**
 * Host-side IPC bound. 9.3.4 still posted a 16k-row tombstone array; JSON.parse
 * of that plus an unvirtualized Markdown tree gray-screened the renderer.
 * 9.3.6 then omitted everything outside a 64-row sliding page — continuous
 * scroll position broke. Keep every row in order so Virtuoso can virtualize a
 * single list. Newest WEBVIEW_TRANSCRIPT_DISPLAY_TAIL rows stay 8k-truncated;
 * older rows keep a cheap preview so a 13k-row / 22MB snapshot stays under
 * 3MB of IPC JSON. Images cap at WEBVIEW_TRANSCRIPT_IMAGE_ROWS. Storage and
 * model I/O stay full.
 */
export const WEBVIEW_TRANSCRIPT_DISPLAY_TAIL = 64
export const WEBVIEW_TRANSCRIPT_IMAGE_ROWS = 4
/** Cheap preview for rows older than the verbatim tail. Sized so 13k rows of
 *  field text stay under the 3MB IPC budget without dropping the list. */
export const WEBVIEW_TRANSCRIPT_HISTORICAL_CHAR_LIMIT = 120
/** Display-only cap for tool / reasoning / leftover text inside the tail. */
export const WEBVIEW_TRANSCRIPT_TEXT_CHAR_LIMIT = COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT
/** Preview budget for the left-rail user-message index (not ChatRow text). */
export const USER_MESSAGE_RAIL_PREVIEW_CHARS = 120

export interface UserMessageRailTick {
	ts: number
	index: number
	preview: string
}

/** Per-field cap when shrinking JSON tool/api payloads (re-stringified, so newlines stay escaped). */
const JSON_DISPLAY_FIELD_CHAR_LIMIT = 2_000
const JSON_SAFE_TRUNCATION_MARKER = (omitted: number) => `…[truncated ${omitted} chars]…`

function stripImagesForDisplay(message: ClineMessage): ClineMessage {
	const clone: Record<string, unknown> = { ...message }
	delete clone.images
	clone.webviewImagesStripped = true
	return clone as ClineMessage
}

function cheapPreviewText(text: string, limit = WEBVIEW_TRANSCRIPT_HISTORICAL_CHAR_LIMIT): string {
	if (text.length <= limit) {
		return text
	}
	return `${text.slice(0, limit)}…`
}

/**
 * Keep the row in the continuous list, but drop the payload that Markdown would
 * amplify. api_req_started keeps cost JSON so TaskHeader metrics survive without
 * prefix stubs. Storage stays full; expand still fetches command output by ts.
 */
function projectHistoricalRowForDisplay(message: ClineMessage): ClineMessage {
	if ((message as { webviewTombstone?: boolean }).webviewTombstone === true) {
		return message
	}

	if (message.type === "say" && message.say === "api_req_started" && message.text) {
		const projectedText = projectJsonTextForDisplay(stripApiReqRequestForDisplay(message.text))
		if (projectedText !== message.text) {
			return { ...message, text: projectedText }
		}
		return message
	}

	let next: ClineMessage = message
	if (next.contextCondense !== undefined && next.contextCondense.summary) {
		next = {
			...next,
			contextCondense: { ...next.contextCondense, summary: "" },
		}
	}
	if (next.text && next.text.length > WEBVIEW_TRANSCRIPT_HISTORICAL_CHAR_LIMIT) {
		next = { ...next, text: cheapPreviewText(next.text) }
	}
	if (next.reasoning && next.reasoning.length > WEBVIEW_TRANSCRIPT_HISTORICAL_CHAR_LIMIT) {
		next = { ...next, reasoning: cheapPreviewText(next.reasoning) }
	}
	return next
}

function compactTranscriptForDisplay(
	messages: ClineMessage[],
	tail: number,
): { messages: ClineMessage[]; tombstonedCount: number; changed: boolean } {
	if (messages.length <= tail) {
		return { messages, tombstonedCount: 0, changed: false }
	}

	const start = messages.length - tail
	let changed = false
	const next = new Array<ClineMessage>(messages.length)
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i]!
		if (i < start) {
			const projected = projectHistoricalRowForDisplay(message)
			next[i] = projected
			if (projected !== message) {
				changed = true
			}
		} else {
			next[i] = message
		}
	}
	return {
		messages: changed ? next : messages,
		tombstonedCount: 0,
		changed,
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

function isCompletedUserFeedback(message: ClineMessage): boolean {
	return message.type === "say" && message.say === "user_feedback" && message.partial !== true
}

function railPreviewFor(message: ClineMessage): string {
	const text = typeof message.text === "string" ? message.text.replace(/\s+/g, " ").trim() : ""
	if (!text) {
		return "(empty message)"
	}
	return text.length <= USER_MESSAGE_RAIL_PREVIEW_CHARS
		? text
		: `${text.slice(0, USER_MESSAGE_RAIL_PREVIEW_CHARS)}…`
}

/**
 * Full-history left-rail index. One tick per completed user_feedback row.
 * Preview is capped; images/reasoning never ship. Storage stays full.
 */
export function projectUserMessageRailIndex(messages: readonly ClineMessage[]): UserMessageRailTick[] {
	const ticks: UserMessageRailTick[] = []
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index]!
		if (!isCompletedUserFeedback(message)) {
			continue
		}
		ticks.push({ ts: message.ts, index, preview: railPreviewFor(message) })
	}
	return ticks
}

/**
 * Keep every row in order for Virtuoso. Rows older than the newest
 * WEBVIEW_TRANSCRIPT_DISPLAY_TAIL keep a cheap preview so a 13k-row / 22MB
 * snapshot stays under 3MB of IPC JSON. Image blobs are capped to the newest
 * WEBVIEW_TRANSCRIPT_IMAGE_ROWS. Storage and model I/O stay full.
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
 * Project UI transcripts for the webview as one continuous list. Historical
 * rows keep a cheap preview (not omitted, not paged). Command/tool/api_req
 * rows in the newest tail send an 8k preview, including the in-flight partial
 * command. Callers must not persist the returned array. Expand still loads
 * storage via requestCommandOutput.
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
	const verbatimStart =
		messages.length > WEBVIEW_TRANSCRIPT_DISPLAY_TAIL ? messages.length - WEBVIEW_TRANSCRIPT_DISPLAY_TAIL : 0
	const projected = bounded.messages.map((message, index) => {
		if (index < verbatimStart || (message as { webviewTombstone?: boolean }).webviewTombstone === true) {
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
