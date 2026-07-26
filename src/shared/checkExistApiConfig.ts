import { SECRET_STATE_KEYS, GLOBAL_SECRET_KEYS, ProviderSettings } from "@roo-code/types"

export function checkExistKey(config: ProviderSettings | undefined) {
	if (!config) {
		return false
	}

	// Special case for providers that can start without stored credentials.
	if (config.apiProvider) {
		if (["human-relay", "fake-ai", "claude-code", "openai-codex", "qwen-code", "roo", "kilocode"].includes(config.apiProvider)) {
			return true
		}

		// kilocode_change start
		// A fresh Deeptask install seeds the OpenAI-compatible model metadata so the
		// settings form has useful defaults, but that metadata is not a callable API
		// configuration. Keep onboarding visible until the user supplies either an
		// endpoint (which may intentionally be an unauthenticated local service) or a
		// key for the standard OpenAI endpoint.
		if (config.apiProvider === "openai" && config.openAiModelId) {
			return Boolean(config.openAiBaseUrl?.trim() || config.openAiApiKey?.trim())
		}
		// kilocode_change end
	}

	// Check all secret keys from the centralized SECRET_STATE_KEYS array.
	// Filter out keys that are not part of ProviderSettings (global secrets are stored separately)
	const providerSecretKeys = SECRET_STATE_KEYS.filter((key) => !GLOBAL_SECRET_KEYS.includes(key as any))
	const hasSecretKey = providerSecretKeys.some((key) => config[key as keyof ProviderSettings] !== undefined)

	// Check additional non-secret configuration properties
	const hasOtherConfig = [
		config.awsRegion,
		config.vertexProjectId,
		config.ollamaModelId,
		config.lmStudioModelId,
		config.vsCodeLmModelSelector,
		config.kilocodeModel, // kilocode_change
	].some((value) => value !== undefined)

	return hasSecretKey || hasOtherConfig
}
