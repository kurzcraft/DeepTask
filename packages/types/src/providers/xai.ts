import type { ModelInfo } from "../model.js"

// https://docs.x.ai/docs/api-reference
export type XAIModelId = keyof typeof xaiModels

export const xaiDefaultModelId: XAIModelId = "grok-code-fast-1"

export const xaiModels = {
	"grok-code-fast-1": {
		maxTokens: 16_384,
		contextWindow: 256_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.2,
		outputPrice: 1.5,
		cacheWritesPrice: 0.02,
		cacheReadsPrice: 0.02,
		description: "xAI's Grok Code Fast model with 256K context window",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
	},
	"grok-4-1-fast-reasoning": {
		maxTokens: 65_536,
		contextWindow: 2_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.2,
		outputPrice: 0.5,
		cacheWritesPrice: 0.05,
		cacheReadsPrice: 0.05,
		description:
			"xAI's Grok 4.1 Fast model with 2M context window, optimized for high-performance agentic tool calling with reasoning",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
	},
	"grok-4-1-fast-non-reasoning": {
		maxTokens: 65_536,
		contextWindow: 2_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.2,
		outputPrice: 0.5,
		cacheWritesPrice: 0.05,
		cacheReadsPrice: 0.05,
		description:
			"xAI's Grok 4.1 Fast model with 2M context window, optimized for high-performance agentic tool calling",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
	},
	"grok-4-fast-reasoning": {
		maxTokens: 65_536,
		contextWindow: 2_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.2,
		outputPrice: 0.5,
		cacheWritesPrice: 0.05,
		cacheReadsPrice: 0.05,
		description:
			"xAI's Grok 4 Fast model with 2M context window, optimized for high-performance agentic tool calling with reasoning",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
	},
	"grok-4-fast-non-reasoning": {
		maxTokens: 65_536,
		contextWindow: 2_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.2,
		outputPrice: 0.5,
		cacheWritesPrice: 0.05,
		cacheReadsPrice: 0.05,
		description:
			"xAI's Grok 4 Fast model with 2M context window, optimized for high-performance agentic tool calling",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
	},
	"grok-4-0709": {
		maxTokens: 8192,
		contextWindow: 256_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 0.75,
		cacheReadsPrice: 0.75,
		description: "xAI's Grok-4 model with 256K context window",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
	},
	// kilocode_change start
	"grok-4-fast": {
		maxTokens: 30_000,
		contextWindow: 2_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		inputPrice: 0.4, // This is the pricing for prompts above 128K context
		outputPrice: 1.0,
		cacheReadsPrice: 0.05,
		description: "xAI's Grok-4-Fast model with reasonning and a 2M context window",
		tiers: [
			{
				contextWindow: 128_000,
				inputPrice: 0.2,
				outputPrice: 0.5,
				cacheReadsPrice: 0.05,
			},
			{
				contextWindow: Infinity,
				inputPrice: 0.4,
				outputPrice: 1,
				cacheReadsPrice: 0.05,
			},
		],
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
	},
	// kilocode_change: grok-4.6 — newest officially named Grok generation.
	// Pricing not yet published, so price fields are omitted (cost tracking
	// falls back to 0 rather than guessing wrong numbers). Newer ids (grok-4.7,
	// grok-5, ...) are handled by xaiInferModelInfo below.
	"grok-4.6": {
		maxTokens: 65_536,
		contextWindow: 2_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		description: "xAI's Grok 4.6 model with 2M context window and vision input support.",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
	},
	// kilocode_change end
	"grok-3-mini": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.3,
		outputPrice: 0.5,
		cacheWritesPrice: 0.07,
		cacheReadsPrice: 0.07,
		description: "xAI's Grok-3 mini model with 128K context window",
		supportsReasoningEffort: ["low", "high"],
		reasoningEffort: "low",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
	},
	"grok-3": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 0.75,
		cacheReadsPrice: 0.75,
		description: "xAI's Grok-3 model with 128K context window",
		includedTools: ["search_replace"],
		excludedTools: ["apply_diff"],
	},
} as const satisfies Record<string, ModelInfo>

/**
 * kilocode_change: capability inference for xAI model ids typed or detected
 * dynamically (e.g. "grok-4.7", "grok-5", "grok-4-1-fast") that are not yet in
 * xaiModels. All modern Grok generations (>= grok-3) accept images, support
 * native tools and prompt caching — so unknown newer ids get a safe modern
 * baseline instead of silently falling back to an old static entry.
 */
export function xaiInferModelInfo(modelId: string | undefined): Partial<ModelInfo> | undefined {
	if (!modelId || !/^grok/i.test(modelId)) {
		return undefined
	}
	// Anything that looks like a grok generation we don't know yet (grok-4.7,
	// grok-5, grok-4-1-fast-*) gets the modern capability baseline.
	return {
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		contextWindow: 2_000_000,
		maxTokens: 65_536,
	}
}
