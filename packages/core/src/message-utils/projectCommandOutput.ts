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

export function projectCommandMessageForDisplay(message: ClineMessage): ClineMessage {
	if (!isCommandDisplayMessage(message) || !message.text) {
		return message
	}

	const projectedText = truncateCommandOutputText(message.text)

	if (projectedText === message.text) {
		return message
	}

	return {
		...message,
		text: projectedText,
		commandOutputTruncated: true,
		commandOutputOriginalLength: message.text.length,
	}
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
 * Project UI transcripts for the webview. Command rows send a short preview,
 * including the in-flight partial command. Callers must not persist the
 * returned array. Expand still loads storage via requestCommandOutput.
 */
export function projectClineMessagesForDisplay(messages: ClineMessage[]): ClineMessage[] {
	if (messages.length === 0) {
		return messages
	}

	let changed = false
	const projected = messages.map((message) => {
		const next = projectCommandMessageForDisplay(message)

		if (next !== message) {
			changed = true
		}

		return next
	})

	return changed ? projected : messages
}
