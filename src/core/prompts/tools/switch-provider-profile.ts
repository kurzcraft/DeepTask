import type { ProviderSettingsEntry } from "@roo-code/types"

export function getSwitchProviderProfileDescription(profiles: ProviderSettingsEntry[] = []): string {
	const availableProfiles = profiles.length
		? `\nAvailable profiles and current models:\n${profiles
			.map((profile) => `- ${profile.name}${profile.modelId ? `: ${profile.modelId}` : ""}`)
			.join("\n")}`
		: ""

	return `## switch_provider_profile
Description: Request to switch the active provider profile and optionally its model. The host validates target API connectivity and ensures the current context fits the target model before committing. Failed validation leaves the current profile and model unchanged.${availableProfiles}
Cold-start rule: When switching profiles, omit model_id so the target profile keeps its saved model. Only provide model_id when the user explicitly requested that exact model ID. Never guess a model ID or reuse an ID from another profile.
Parameters:
- profile_name: (required) Exact name of the saved provider profile to activate
- model_id: (optional) Exact model ID explicitly requested by the user; omit it for a profile-only switch
- reason: (required) Why the target provider or model is needed
Usage:
<switch_provider_profile>
<profile_name>Profile name here</profile_name>
<reason>Reason for switching provider</reason>
</switch_provider_profile>`
}
