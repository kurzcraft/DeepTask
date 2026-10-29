import { ApiMessage } from "../../core/task-persistence/apiMessages"

import { ApiHandler } from "../index"

function hasImageBlock(content: ApiMessage["content"]): boolean {
	return Array.isArray(content) && content.some((block) => block.type === "image")
}

/* Removes image blocks from messages if they are not supported by the Api Handler */
export function maybeRemoveImageBlocks(messages: ApiMessage[], apiHandler: ApiHandler): ApiMessage[] {
	// Check model capability ONCE instead of for every message
	const supportsImages = apiHandler.getModel().info.supportsImages

	// kilocode_change start: reuse the original history when no conversion is needed
	if (supportsImages || !messages.some((message) => hasImageBlock(message.content))) {
		return messages
	}

	return messages.map((message) => {
		const { content } = message
		if (!hasImageBlock(content) || !Array.isArray(content)) {
			return message
		}

		return {
			...message,
			content: content.map((block) => {
				if (block.type === "image") {
					// Convert image blocks to text descriptions.
					// Note: We can't access the actual image content/url due to API limitations,
					// but we can indicate that an image was present in the conversation.
					return {
						type: "text" as const,
						text: "[Referenced image in conversation]",
					}
				}
				return block
			}),
		}
	})
	// kilocode_change end
}
