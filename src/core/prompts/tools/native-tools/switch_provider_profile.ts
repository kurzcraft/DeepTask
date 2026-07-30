import type OpenAI from "openai"

export interface SwitchProviderProfileToolOptions {
	profiles?: Array<{ name: string; modelId?: string }>
}

export function createSwitchProviderProfileTool(
	options: SwitchProviderProfileToolOptions = {},
): OpenAI.Chat.ChatCompletionTool {
	const profileNames = options.profiles?.map((profile) => profile.name)
	const modelDescriptions = options.profiles
		?.filter((profile) => profile.modelId)
		.map((profile) => `${profile.name}: ${profile.modelId}`)
		.join(", ")
	const coldStartRule =
		" When switching profiles, always set model_id to null so the target profile keeps its saved model. " +
		"Only provide a non-null model_id when the user explicitly requested that exact model ID. " +
		"Never guess a model ID or reuse an ID from another profile."

	return {
		type: "function",
		function: {
			name: "switch_provider_profile",
			description: `Switch the active provider profile and optionally its model. The host will first verify connectivity and that the current context fits the target model; failed validation leaves the current profile unchanged.${coldStartRule}${modelDescriptions ? ` Available profiles and saved models: ${modelDescriptions}.` : ""}`,
			strict: true,
			parameters: {
				type: "object",
				properties: {
					profile_name: {
						type: "string",
						enum: profileNames?.length ? profileNames : undefined,
						description: "Exact name of the saved provider profile to activate",
					},
					model_id: {
						type: ["string", "null"],
						description:
							"Use null for a profile switch to keep that profile's saved model. Only use a string when the user explicitly supplied that exact model ID; never guess or copy one from another profile.",
					},
					reason: {
						type: "string",
						description: "Why the provider or model needs to change",
					},
				},
				required: ["profile_name", "model_id", "reason"],
				additionalProperties: false,
			},
		},
	}
}

export default createSwitchProviderProfileTool()
