import type { ModelInfo } from "../model.js"

// https://platform.deepseek.com/docs/api
// preserveReasoning enables interleaved thinking mode for tool calls:
// DeepSeek requires reasoning_content to be passed back during tool call
// continuation within the same turn. See: https://api-docs.deepseek.com/guides/thinking_mode
export type DeepSeekModelId = keyof typeof deepSeekModels

export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-chat"

export const deepSeekModels = {
	"deepseek-chat": {
		maxTokens: 8192, // 8K max output
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		outputPrice: 0.42, // $0.42 per million tokens - Updated Dec 9, 2025
		cacheWritesPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		cacheReadsPrice: 0.028, // $0.028 per million tokens (cache hit) - Updated Dec 9, 2025
		description: `DeepSeek-V3.2 (Non-thinking Mode) achieves a significant breakthrough in inference speed over previous models. It tops the leaderboard among open-source models and rivals the most advanced closed-source models globally. Supports JSON output, tool calls, chat prefix completion (beta), and FIM completion (beta).`,
	},
	"deepseek-reasoner": {
		maxTokens: 8192, // 8K max output
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		preserveReasoning: true,
		inputPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		outputPrice: 0.42, // $0.42 per million tokens - Updated Dec 9, 2025
		cacheWritesPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		cacheReadsPrice: 0.028, // $0.028 per million tokens (cache hit) - Updated Dec 9, 2025
		description: `DeepSeek-V3.2 (Thinking Mode) achieves performance comparable to OpenAI-o1 across math, code, and reasoning tasks. Supports Chain of Thought reasoning with up to 8K output tokens. Supports JSON output, tool calls, and chat prefix completion (beta).`,
	},
	"deepseek-v4-pro": {
		maxTokens: 32_768,
		contextWindow: 1_000_000,
		supportsImages: false, // v4-pro is text-only; vision starts at v4.1-flash
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		preserveReasoning: true,
		description: "DeepSeek V4 Pro reasoning model.",
	},
	"deepseek-v4.1-flash": {
		maxTokens: 32_768,
		contextWindow: 1_000_000,
		// kilocode_change: DeepSeek V4.1 series are the first vision-capable
		// DeepSeek models — image input supported.
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		description: "DeepSeek V4.1 Flash multimodal model with vision input support.",
	},
	// kilocode_change: "deepseek-flash" is the alias DeepSeek's /models endpoint
	// returns for the current Flash generation (V4.1 Flash at time of writing).
	// Detected entries carry no description, so keep a static entry here with a
	// human-readable description and vision flag for the alias.
	"deepseek-flash": {
		maxTokens: 32_768,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		description:
			"DeepSeek Flash (alias of the current Flash generation, V4.1 Flash) — fast multimodal model with vision input support.",
	},
} as const satisfies Record<string, ModelInfo>

/**
 * kilocode_change: dynamic DeepSeek model ids typed into the model field (e.g.
 * relay-served "deepseek-v4.1-flash", "deepseek-v4.2") cannot be enumerated in
 * deepSeekModels. Vision support starts with the V4.1 family — infer it from
 * the id so unknown-but-vision-capable ids still accept images.
 */
export function deepSeekSupportsImagesDynamic(modelId: string | undefined): boolean {
	if (!modelId) {
		return false
	}
	// v4.1 and newer minor versions (v4.1, v4.2, ...), or any explicit
	// "-vl"/"-vision" suffix, are vision-capable.
	if (/deepseek[-_]?v?4\.([1-9]\d*)/i.test(modelId) || /-vl$|-vision/i.test(modelId)) {
		return true
	}
	return /v4\.1-flash/.test(modelId)
}

// https://api-docs.deepseek.com/quick_start/parameter_settings
export const DEEP_SEEK_DEFAULT_TEMPERATURE = 0.3
