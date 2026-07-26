// kilocode_change - new file
import axios from "axios"

import {
  type ModelInfo,
  type ModelRecord,
  cerebrasModels,
  deepSeekModels,
  groqModels,
  mistralModels,
  NATIVE_TOOL_DEFAULTS,
} from "@roo-code/types"

export type DiscoverableVendor = "deepseek" | "groq" | "mistral" | "cerebras"

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
}

const UNKNOWN_VENDOR_MODEL_DEFAULTS: ModelInfo = {
  ...NATIVE_TOOL_DEFAULTS,
  maxTokens: 8192,
  contextWindow: 128_000,
  supportsImages: false,
  supportsPromptCache: false,
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
  if (!apiKey?.trim()) {
    throw new Error(`${provider} API key is required to refresh models`)
  }

  const config = VENDOR_CONFIG[provider]
  const resolvedBaseUrl = (baseUrl?.trim() || config.baseUrl).replace(/\/+$/, "")
  const response = await axios.get(`${resolvedBaseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
    timeout: 10_000,
  })
  const remoteModels = Array.isArray(response.data?.data)
    ? response.data.data
    : Array.isArray(response.data)
      ? response.data
      : []

  const models: ModelRecord = {}
  for (const remoteModel of remoteModels) {
    if (!remoteModel || typeof remoteModel.id !== "string" || !remoteModel.id.trim()) {
      continue
    }

    const id = remoteModel.id.trim()
    const staticInfo = config.staticModels[id]
    const remoteContextWindow =
      typeof remoteModel.context_window === "number"
        ? remoteModel.context_window
        : typeof remoteModel.max_context_length === "number"
          ? remoteModel.max_context_length
          : undefined

    models[id] = {
      ...UNKNOWN_VENDOR_MODEL_DEFAULTS,
      ...staticInfo,
      ...(remoteContextWindow ? { contextWindow: remoteContextWindow } : {}),
      ...(remoteModel.capabilities?.vision === true ? { supportsImages: true } : {}),
      ...(remoteModel.capabilities?.function_calling === true
        ? { supportsNativeTools: true, defaultToolProtocol: "native" as const }
        : {}),
    }
  }

  return models
}
