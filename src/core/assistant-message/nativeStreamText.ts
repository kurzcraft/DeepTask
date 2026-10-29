// kilocode_change - new file
import type { AssistantMessageContent } from "./parseAssistantMessage"
import type { TextContent } from "../../shared/tools"

function isCommittedTextBlock(block: AssistantMessageContent): block is TextContent {
	return block.type === "text" && block.partial !== true
}

/** Seal the trailing partial text block so a following tool can be presented. */
export function sealPrecedingPartialText(blocks: AssistantMessageContent[]): void {
	const lastBlock = blocks[blocks.length - 1]
	if (lastBlock?.type === "text" && lastBlock.partial) {
		lastBlock.partial = false
	}
}

/** Length of native text already sealed into completed text blocks. */
export function committedNativeTextLength(blocks: AssistantMessageContent[]): number {
	return blocks.filter(isCommittedTextBlock).reduce((total, block) => total + block.content.length, 0)
}

/**
 * Append a native-protocol text chunk without recopying earlier sentences.
 *
 * Streaming accumulates every text token into one string. After a tool block the
 * last content item is no longer a partial text block, so assigning that full
 * string to a new block would replay the opening sentence in the UI and mash
 * pre-tool and post-tool prose into one API history blob.
 */
export function appendNativeStreamText(
	blocks: AssistantMessageContent[],
	accumulatedText: string,
): { created: boolean } {
	const remainder = accumulatedText.slice(committedNativeTextLength(blocks))
	const lastBlock = blocks[blocks.length - 1]

	if (lastBlock?.type === "text" && lastBlock.partial) {
		lastBlock.content = remainder
		return { created: false }
	}

	if (remainder.length === 0) {
		return { created: false }
	}

	blocks.push({
		type: "text",
		content: remainder,
		partial: true,
	})
	return { created: true }
}
