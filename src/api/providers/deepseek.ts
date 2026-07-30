import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	deepSeekModels,
	deepSeekDefaultModelId,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	OPENAI_AZURE_AI_INFERENCE_PATH,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { convertToR1Format } from "../transform/r1-format"

import { OpenAiHandler } from "./openai"
import type { ApiHandlerCreateMessageMetadata } from "../index"

// Custom interface for DeepSeek params to support thinking mode
type DeepSeekChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParamsStreaming & {
	thinking?: { type: "enabled" | "disabled" }
}

export class DeepSeekHandler extends OpenAiHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			openAiApiKey: options.deepSeekApiKey ?? "not-provided",
			openAiModelId: options.apiModelId ?? deepSeekDefaultModelId,
			openAiBaseUrl: options.deepSeekBaseUrl ?? "https://api.deepseek.com",
			openAiStreamingEnabled: true,
			includeMaxTokens: true,
		})
	}

	override getModel() {
		const id = this.options.apiModelId ?? deepSeekDefaultModelId
		const knownInfo = deepSeekModels[id as keyof typeof deepSeekModels]
		const staticInfo = knownInfo ?? { ...deepSeekModels[deepSeekDefaultModelId], contextWindow: 256_000 }
		const userInfo = this.options.apiModelInfoModelId === id ? this.options.apiModelInfo : undefined
		const info = { ...staticInfo, ...userInfo }
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })
		return { id, info, ...params }
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const modelId = this.options.apiModelId ?? deepSeekDefaultModelId
		const { info: modelInfo } = this.getModel()

		// kilocode_change start: Dynamic DeepSeek model IDs can emit thinking without
		// containing "reasoner". Existing reasoning is authoritative. A pending tool
		// call is also a thinking continuation boundary, including when that call was
		// created immediately before switching from another provider.
		const hasReplayableReasoning = messages.some(
			(message) => message.role === "assistant" && Boolean((message as { reasoning_content?: string }).reasoning_content),
		)
		const hasAssistantToolCall = messages.some(
			(message) =>
				message.role === "assistant" &&
				Array.isArray(message.content) &&
				message.content.some((block) => block.type === "tool_use"),
		)
		const isThinkingModel = modelId.includes("deepseek-reasoner") || hasReplayableReasoning || hasAssistantToolCall
		// kilocode_change end

		// Convert messages to R1 format (merges consecutive same-role messages)
		// This is required for DeepSeek which does not support successive messages with the same role
		// For thinking models (deepseek-reasoner), enable mergeToolResultText to preserve reasoning_content
		// during tool call sequences. Without this, environment_details text after tool_results would
		// create user messages that cause DeepSeek to drop all previous reasoning_content.
		// See: https://api-docs.deepseek.com/guides/thinking_mode
		const convertedMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages], {
			mergeToolResultText: isThinkingModel,
			ensureToolCallReasoningContent: isThinkingModel,
		})

		const requestOptions: DeepSeekChatCompletionParams = {
			model: modelId,
			temperature: this.options.modelTemperature ?? DEEP_SEEK_DEFAULT_TEMPERATURE,
			messages: convertedMessages,
			stream: true as const,
			stream_options: { include_usage: true },
			// Enable thinking mode for deepseek-reasoner or when tools are used with thinking model
			...(isThinkingModel && { thinking: { type: "enabled" } }),
			...(metadata?.tools && { tools: this.convertToolsForOpenAI(metadata.tools) }),
			...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
			// DeepSeek supports native tools but rejects OpenAI's parallel_tool_calls field.
			// The task runner already serializes tool execution, so omitting it preserves
			// native history compatibility when switching from OpenAI-compatible profiles.
		}

		// Add max_tokens if needed
		this.addMaxTokensIfNeeded(requestOptions, modelInfo)

		// Check if base URL is Azure AI Inference (for DeepSeek via Azure)
		const isAzureAiInference = this._isAzureAiInference(this.options.deepSeekBaseUrl)

		let stream
		try {
			stream = await this.client.chat.completions.create(
				requestOptions,
				isAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
			)
		} catch (error) {
			const { handleOpenAIError } = await import("./utils/openai-error-handler")
			throw handleOpenAIError(error, "DeepSeek")
		}

		let lastUsage

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta ?? {}

			// Handle regular text content
			if (delta.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			// Handle reasoning_content from DeepSeek's interleaved thinking
			// This is the proper way DeepSeek sends thinking content in streaming
			if ("reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					text: (delta.reasoning_content as string) || "",
				}
			}

			// Handle tool calls
			if (delta.tool_calls) {
				for (const toolCall of delta.tool_calls) {
					yield {
						type: "tool_call_partial",
						index: toolCall.index,
						id: toolCall.id,
						name: toolCall.function?.name,
						arguments: toolCall.function?.arguments,
					}
				}
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			yield this.processUsageMetrics(lastUsage, modelInfo)
		}
	}

	// Override to handle DeepSeek's usage metrics, including caching.
	protected override processUsageMetrics(usage: any, _modelInfo?: any): ApiStreamUsageChunk {
		return {
			type: "usage",
			inputTokens: usage?.prompt_tokens || 0,
			outputTokens: usage?.completion_tokens || 0,
			cacheWriteTokens: usage?.prompt_tokens_details?.cache_miss_tokens,
			cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens,
		}
	}
}
