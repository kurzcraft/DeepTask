import type { ProviderSettings } from "@roo-code/types"
import { buildApiHandler, SingleCompletionHandler, ApiHandler } from "../api" //kilocode_change
import { ApiStreamUsageChunk } from "../api/transform/stream" // kilocode_change

/**
 * Enhances a prompt using the configured API without creating a full Cline instance or task history.
 * This is a lightweight alternative that only uses the API's completion functionality.
 */
export async function singleCompletionHandler(apiConfiguration: ProviderSettings, promptText: string): Promise<string> {
	if (!promptText) {
		throw new Error("No prompt text provided")
	}
	if (!apiConfiguration || !apiConfiguration.apiProvider) {
		throw new Error("No valid API configuration provided")
	}

	const handler = buildApiHandler(apiConfiguration)

	// Initialize handler if it has an initialize method
	if ("initialize" in handler && typeof handler.initialize === "function") {
		await handler.initialize()
	}

	// kilocode_change start
	// Prefer the provider's lightweight completion, but transparently retry through
	// the normalized stream path when a reasoning relay reports an empty
	// `message.content`. This preserves existing provider behavior while recovering
	// the useful text chunks that those relays only expose during streaming.
	if ("completePrompt" in handler) {
		const directResponse = await (handler as SingleCompletionHandler).completePrompt(promptText)
		if (directResponse.trim()) {
			return directResponse
		}
	}
	const streamedResponse = await streamResponseFromHandler(handler, promptText)
	return streamedResponse.text.trim() || streamedResponse.reasoning?.trim() || ""
	// kilocode_change end
}

// kilocode_change start - Stream responses using createMessage
export async function streamResponseFromHandler(
	handler: ApiHandler,
	promptText: string,
	systemPrompt = "",
): Promise<{ text: string; reasoning?: string; usage?: ApiStreamUsageChunk }> {
	const stream = handler.createMessage(systemPrompt, [
		{ role: "user", content: [{ type: "text", text: promptText }] },
	])

	let text: string = ""
	let reasoning: string = "" // kilocode_change
	let usage: ApiStreamUsageChunk | undefined = undefined

	for await (const chunk of stream) {
		if (chunk.type === "text") {
			text += chunk.text
		} else if (chunk.type === "reasoning") {
			reasoning += chunk.text // kilocode_change
		} else if (chunk.type === "usage") {
			usage = chunk
		}
	}

	return { text, reasoning: reasoning || undefined, usage }
}
// kilocode_change end - streamResponseFromHandler
