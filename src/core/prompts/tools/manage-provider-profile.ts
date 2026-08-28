// kilocode_change - new file: agent-managed provider profiles (XML tool description)
export interface ManageProviderProfileDescriptionOptions {
	/** Whether the switch_provider_profile tool is visible to the model (default: true). */
	providerProfileSwitchEnabled?: boolean
}

export function getManageProviderProfileDescription(
	options: ManageProviderProfileDescriptionOptions = {},
): string {
	const activationHint = options.providerProfileSwitchEnabled === false
		? "To make a newly created or updated profile take effect immediately, ask the user to activate it in settings."
		: "Use switch_provider_profile to ACTIVATE a profile; use this tool to DEFINE or EDIT profiles."
	return `## manage_provider_profile
Description: Create, update, rename, or list provider profiles, or switch the reasoning effort of the current profile (including turning reasoning off). ${activationHint} All mutating actions require user approval.
Actions:
- list: no other params. Returns every profile with provider, model, reasoning state and redacted settings (secrets replaced with «redacted»).
- create: profile_name + provider + model_id required; api_key / base_url / reasoning_effort / settings optional. settings is a JSON object of raw ProviderSettings fields for provider-specific options.
- update: profile_name + any of model_id / api_key / base_url / reasoning_effort / provider / settings. Only provided fields change.
- set_reasoning: profile_name (defaults to active profile) + reasoning_effort (disable|none|minimal|low|medium|high|xhigh). disable/none turns reasoning off.
- rename: profile_name (old) + new_name.
Common rules:
- Only create or update profiles when the user explicitly asks for it or when the task cannot proceed otherwise; state what will be stored.
- Never invent API keys; ask the user when a credential is required and missing.
- reasoning_effort: use "disable" or "none" to turn reasoning off.
Parameters:
- action: (required) list | create | update | set_reasoning | rename
- profile_name: (create/update/rename: required; set_reasoning: optional = active profile)
- new_name: (rename only) new profile name
- provider: (create/update) provider id, e.g. anthropic, openai, openai-responses, deepseek, openrouter, ollama, lmstudio, gemini, zai, groq
- model_id: exact model ID explicitly requested by the user
- api_key: credential to store for the provider
- base_url: custom endpoint base URL
- reasoning_effort: disable | none | minimal | low | medium | high | xhigh
- settings: JSON object of raw ProviderSettings fields (merged last, wins over convenience params)
- reason: why this change is needed
Usage:
<manage_provider_profile>
<action>set_reasoning</action>
<profile_name>deepseek</profile_name>
<reasoning_effort>high</reasoning_effort>
<reason>Complex debugging task benefits from deeper reasoning</reason>
</manage_provider_profile>`
}
