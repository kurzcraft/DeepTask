// kilocode_change - new file
import type { ClineMessage } from "@roo-code/types"

import { COMMAND_OUTPUT_STRING } from "./consolidateCommands.js"

/** Display-only budget for historical command output. Storage and model I/O stay full. */
export const COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT = 8_000
const COMMAND_OUTPUT_DISPLAY_HEAD_CHARS = 3_000
const COMMAND_OUTPUT_DISPLAY_TAIL_CHARS = 3_000

export function isCommandDisplayMessage(message: Pick<ClineMessage, "ask" | "say">): boolean {
	return message.ask === "command" || message.ask === "command_output"
}

export function truncateCommandOutputText(text: string): string {
	const index = text.indexOf(COMMAND_OUTPUT_STRING)

	if (index === -1) {
		return text
	}

	const output = text.slice(index + COMMAND_OUTPUT_STRING.length)

	if (output.length <= COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT) {
		return text
	}

	const omitted = output.length - COMMAND_OUTPUT_DISPLAY_HEAD_CHARS - COMMAND_OUTPUT_DISPLAY_TAIL_CHARS
	if (omitted <= 0) {
		return text
	}

	const marker = `\n… [truncated ${omitted} chars, expand to load full output] …\n`
	const projected =
		text.slice(0, index) +
		COMMAND_OUTPUT_STRING +
		output.slice(0, COMMAND_OUTPUT_DISPLAY_HEAD_CHARS) +
		marker +
		output.slice(-COMMAND_OUTPUT_DISPLAY_TAIL_CHARS)

	return projected.length < text.length ? projected : text
}

export function projectCommandMessageForDisplay(
	message: ClineMessage,
	options: { keepFull?: boolean } = {},
): ClineMessage {
	if (options.keepFull || !isCommandDisplayMessage(message) || !message.text) {
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
 * Project UI transcripts for the webview. Historical command rows send a short
 * preview; the last streaming/partial command keeps full output. Callers must
 * not persist the returned array.
 */
export function projectClineMessagesForDisplay(messages: ClineMessage[]): ClineMessage[] {
	if (messages.length === 0) {
		return messages
	}

	let changed = false
	const projected = messages.map((message, index) => {
		const isLast = index === messages.length - 1
		const next = projectCommandMessageForDisplay(message, {
			keepFull: isLast && message.partial === true,
		})

		if (next !== message) {
			changed = true
		}

		return next
	})

	return changed ? projected : messages
}
