import type { ProviderSettings } from "@roo-code/types"
import { buildApiHandler, SingleCompletionHandler, ApiHandler } from "../api" //kilocode_change
import { ApiStreamUsageChunk } from "../api/transform/stream" // kilocode_change

// kilocode_change start
export interface SingleCompletionOptions {
	/** Prefer the normalized chat stream for relays whose non-stream response may hang or omit content. */
	preferStream?: boolean
}

/**
 * Enhances a prompt using the configured API without creating a full Cline instance or task history.
 * This is a lightweight alternative that only uses the API's completion functionality.
 */
export async function singleCompletionHandler(
	apiConfiguration: ProviderSettings,
	promptText: string,
	options: SingleCompletionOptions = {},
): Promise<string> {
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

	const completeDirectly = async (): Promise<string> => {
		if (!("completePrompt" in handler)) {
			return ""
		}
		return (await (handler as SingleCompletionHandler).completePrompt(promptText)).trim()
	}
	const completeFromStream = async (): Promise<string> => {
		const response = await streamResponseFromHandler(handler, promptText)
		return response.text.trim() || response.reasoning?.trim() || ""
	}

	// Git commit generation opts into the same normalized streaming route as chat.
	// This avoids waiting on OpenAI-compatible relays that never settle or omit
	// `message.content` for non-streaming requests. Empty/failed streams retain the
	// lightweight direct route as a compatibility fallback.
	if (options.preferStream) {
		try {
			const streamedResponse = await completeFromStream()
			if (streamedResponse) {
				return streamedResponse
			}
		} catch (error) {
			if (!("completePrompt" in handler)) {
				throw error
			}
		}
		return completeDirectly()
	}

	// Preserve the historical direct-first behavior for other lightweight callers,
	// while recovering text that reasoning relays expose only during streaming.
	const directResponse = await completeDirectly()
	return directResponse || completeFromStream()
}
// kilocode_change end

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
