// kilocode_change - new file
import axios from "axios"

import {
  type ModelInfo,
  type ModelRecord,
  cerebrasModels,
  deepSeekModels,
  deepSeekSupportsImagesDynamic,
  groqModels,
  internationalZAiModels,
  mainlandZAiModels,
  mistralModels,
  NATIVE_TOOL_DEFAULTS,
  xaiModels,
  xaiInferModelInfo,
  zaiApiLineConfigs,
} from "@roo-code/types"

export type DiscoverableVendor = "deepseek" | "groq" | "mistral" | "cerebras" | "zai" | "xai"

const VENDOR_CONFIG: Record<
  DiscoverableVendor,
  { baseUrl: string; staticModels: ModelRecord }
> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    staticModels: deepSeekModels,
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    staticModels: groqModels,
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    staticModels: mistralModels,
  },
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1",
    staticModels: cerebrasModels,
  },
  zai: {
    baseUrl: zaiApiLineConfigs.international_coding.baseUrl,
    staticModels: { ...internationalZAiModels, ...mainlandZAiModels },
  },
  xai: {
    baseUrl: "https://api.x.ai/v1",
    staticModels: xaiModels,
  },
}

const UNKNOWN_VENDOR_MODEL_DEFAULTS: ModelInfo = {
  ...NATIVE_TOOL_DEFAULTS,
  maxTokens: 8192,
  contextWindow: 256_000,
  supportsImages: false,
  supportsPromptCache: false,
}

const getFirstPositiveNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    const numericValue = typeof value === "string" ? Number(value) : value
    if (typeof numericValue === "number" && Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue
    }
  }
  return undefined
}

/**
 * Fetch the authoritative model IDs exposed to the current vendor account.
 *
 * The remote directory determines availability. Known static metadata is retained
 * for capability and pricing accuracy, while newly released models receive safe
 * defaults until the provider returns richer metadata or the bundled catalog is
 * updated.
 */
export async function getVendorModels(
  provider: DiscoverableVendor,
  apiKey?: string,
  baseUrl?: string,
): Promise<ModelRecord> {
  // kilocode_change (defect T, 9.2.8): anonymous discovery — most vendor
  // /models endpoints answer without authentication. Do not throw when the
  // key is empty; just omit the Authorization header. Authenticated calls
  // (when a key exists) may see account-specific availability on top.
  const config = VENDOR_CONFIG[provider]
  const resolvedBaseUrl = (baseUrl?.trim() || config.baseUrl).replace(/\/+$/, "")
  const response = await axios.get(`${resolvedBaseUrl}/models`, {
    headers: apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {},
    timeout: 10_000,
  })
  const remoteModels = Array.isArray(response.data?.data)
    ? response.data.data
    : Array.isArray(response.data?.models)
      ? response.data.models
      : Array.isArray(response.data)
        ? response.data
        : []

  const models: ModelRecord = {}
  const inferZaiReasoning = (id: string, info: ModelInfo): ModelInfo => {
    if (provider !== "zai" || info.supportsReasoningEffort) {
      return info
    }

    const lowerId = id.toLowerCase()
    const looksLikeThinkingModel =
      /glm-4\.(6|7|8|9)|glm-5|thinking|reason/.test(lowerId) && !/flash$/.test(lowerId)
    if (!looksLikeThinkingModel) {
      return info
    }

    return {
      ...info,
      supportsReasoningEffort: ["disable", "low", "medium", "high"],
      reasoningEffort: info.reasoningEffort ?? "medium",
      preserveReasoning: true,
    }
  }

  // kilocode_change: capability inference for ids missing from the static
  // table, so newly released generations (deepseek-v4.2, grok-4.7, ...) get
  // correct vision/tool metadata without waiting for a static-table release.
  const inferVendorCapabilities = (id: string): Partial<ModelInfo> | undefined => {
    if (provider === "deepseek" && deepSeekSupportsImagesDynamic(id)) {
      return { supportsImages: true, contextWindow: 1_000_000, maxTokens: 32_768 }
    }
    if (provider === "xai") {
      return xaiInferModelInfo(id)
    }
    return undefined
  }

  for (const remoteModel of remoteModels) {
    if (!remoteModel || typeof remoteModel.id !== "string" || !remoteModel.id.trim()) {
      continue
    }

    const id = remoteModel.id.trim()
    const staticInfo = config.staticModels[id]
    // kilocode_change: apply capability inference only for ids NOT in the
    // static table (static entries win; inference fills the gaps).
    const inferredInfo = staticInfo ? undefined : inferVendorCapabilities(id)
    const remoteContextWindow = getFirstPositiveNumber(
      remoteModel.contextWindow,
      remoteModel.context_window,
      remoteModel.context_length,
      remoteModel.max_context_length,
      remoteModel.max_model_len,
      remoteModel.max_sequence_length,
      remoteModel.limits?.contextWindow,
      remoteModel.limits?.context_window,
      remoteModel.limits?.context_length,
      remoteModel.limits?.max_context_length,
      remoteModel.capabilities?.contextWindow,
      remoteModel.capabilities?.context_window,
      remoteModel.model_extra?.contextWindow,
      remoteModel.model_extra?.context_window,
      remoteModel.model_extra?.context_length,
      remoteModel.model_extra?.max_context_length,
    )
    const remoteMaxTokens = getFirstPositiveNumber(
      remoteModel.maxTokens,
      remoteModel.max_tokens,
      remoteModel.max_output_tokens,
      remoteModel.max_completion_tokens,
      remoteModel.limits?.maxTokens,
      remoteModel.limits?.max_tokens,
      remoteModel.limits?.max_output_tokens,
      remoteModel.limits?.max_completion_tokens,
    )

    models[id] = inferZaiReasoning(id, {
      ...UNKNOWN_VENDOR_MODEL_DEFAULTS,
      ...inferredInfo,
      ...staticInfo,
      ...(remoteContextWindow ? { contextWindow: remoteContextWindow } : {}),
      ...(remoteMaxTokens ? { maxTokens: remoteMaxTokens } : {}),
      ...(remoteModel.capabilities?.vision === true ? { supportsImages: true } : {}),
      ...(remoteModel.capabilities?.function_calling === true
        ? { supportsNativeTools: true, defaultToolProtocol: "native" as const }
        : {}),
    })
  }

  return models
}
