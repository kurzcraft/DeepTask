// kilocode_change - new file: agent-managed provider profiles (native tool definition)
import type OpenAI from "openai"

export interface ManageProviderProfileToolOptions {
	/** Whether provider/profile management is available to the model (default: true). */
	enabled?: boolean
	/** Whether the switch_provider_profile tool is visible to the model (default: true). */
	providerProfileSwitchEnabled?: boolean
}

const REASONING_DESC =
	"Reasoning effort level: disable | none | minimal | low | medium | high | xhigh. Use disable or none to turn reasoning off."

export function createManageProviderProfileTool(
	options: ManageProviderProfileToolOptions = {},
): OpenAI.Chat.ChatCompletionTool {
	const activationHint =
		options.providerProfileSwitchEnabled === false
			? "Ask the user to activate a newly created or updated profile in settings."
			: "Use switch_provider_profile to activate a profile; use this tool to define or edit profiles."
	return {
		type: "function",
		function: {
			name: "manage_provider_profile",
			description:
				"Create, update, rename, list provider profiles, or switch reasoning effort (including off). " +
				activationHint +
				" " +
				"list: returns all profiles with redacted secrets. create: requires profile_name+provider+model_id (api_key/base_url optional). " +
				"update: patch model_id/api_key/base_url/reasoning/settings on an existing profile. " +
				"set_reasoning: set reasoning_effort on a profile (defaults to the active one). " +
				"rename: profile_name -> new_name. " +
				"settings is a JSON object merged into the raw provider settings for provider-specific fields not covered above.",
			strict: true,
			parameters: {
				type: "object",
				properties: {
					action: {
						type: "string",
						enum: ["list", "create", "update", "set_reasoning", "rename"],
						description: "Operation to perform",
					},
					profile_name: {
						type: ["string", "null"],
						description: "Target profile name (required for create/update/rename; optional for set_reasoning = active profile)",
					},
					new_name: {
						type: ["string", "null"],
						description: "New name for action=rename",
					},
					provider: {
						type: ["string", "null"],
						description: "Provider id for create/update, e.g. anthropic | openai | openai-responses | deepseek | openrouter | ollama | lmstudio | gemini | zai | groq",
					},
					model_id: {
						type: ["string", "null"],
						description: "Exact model ID to set (create requires it; only set when the user explicitly requested that exact model)",
					},
					api_key: {
						type: ["string", "null"],
						description: "API key / credential to store for the provider",
					},
					base_url: {
						type: ["string", "null"],
						description: "Custom endpoint base URL for the provider",
					},
					reasoning_effort: {
						type: ["string", "null"],
						enum: ["disable", "none", "minimal", "low", "medium", "high", "xhigh", null],
						description: REASONING_DESC,
					},
					settings: {
						type: ["object", "null"],
						description: 'Raw provider-settings JSON merged last, e.g. {"modelMaxTokens": 8192, "modelTemperature": 0.2}. Keys must be valid ProviderSettings field names.',
						additionalProperties: true,
					},
					reason: {
						type: ["string", "null"],
						description: "Why this profile change is needed (shown to the user for approval)",
					},
				},
				required: ["action", "profile_name", "new_name", "provider", "model_id", "api_key", "base_url", "reasoning_effort", "settings", "reason"],
				additionalProperties: false,
			},
		},
	}
}

export default createManageProviderProfileTool()
