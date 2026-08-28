// kilocode_change - new file: agent-managed provider profiles
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import {
	getModelId,
	isProviderName,
	modelIdKeysByProvider,
	isTypicalProvider,
} from "@roo-code/types"
import type { ProviderSettings, ProviderSettingsWithId, ProviderName } from "@roo-code/types"

interface ManageProviderProfileParams {
	action: "list" | "create" | "update" | "set_reasoning" | "rename"
	profile_name?: string
	new_name?: string
	provider?: string
	model_id?: string
	api_key?: string
	base_url?: string
	reasoning_effort?: string
	settings?: Record<string, unknown>
	reason?: string
}

const REASONING_LEVELS = ["disable", "none", "minimal", "low", "medium", "high", "xhigh"] as const

/**
 * Map provider-specific baseUrl / apiKey field names.
 * Covers the providers an agent realistically configures; unknown providers
 * fall back to raw `settings` passthrough.
 */
const providerFieldMap: Partial<Record<ProviderName, { baseUrl?: string; apiKey?: string }>> = {
	anthropic: { baseUrl: "anthropicBaseUrl", apiKey: "apiKey" },
	openai: { baseUrl: "openAiBaseUrl", apiKey: "openAiApiKey" },
	"openai-responses": { baseUrl: "openAiBaseUrl", apiKey: "openAiApiKey" },
	"openai-native": { baseUrl: "openAiNativeBaseUrl", apiKey: "openAiNativeApiKey" },
	deepseek: { baseUrl: "deepSeekBaseUrl", apiKey: "deepSeekApiKey" },
	openrouter: { baseUrl: "openRouterBaseUrl", apiKey: "openRouterApiKey" },
	ollama: { baseUrl: "ollamaBaseUrl", apiKey: "ollamaApiKey" },
	lmstudio: { baseUrl: "lmStudioBaseUrl" },
	gemini: { baseUrl: "googleGeminiBaseUrl", apiKey: "geminiApiKey" },
	mistral: { apiKey: "mistralApiKey" },
	moonshot: { apiKey: "moonshotApiKey" },
	minimax: { apiKey: "minimaxApiKey" },
	doubao: { baseUrl: "doubaoBaseUrl", apiKey: "doubaoApiKey" },
	xai: { apiKey: "xaiApiKey" },
	groq: { apiKey: "groqApiKey" },
	zai: { apiKey: "zaiApiKey" },
	litellm: { baseUrl: "litellmBaseUrl", apiKey: "litellmApiKey" },
	deepinfra: { baseUrl: "deepInfraBaseUrl", apiKey: "deepInfraApiKey" },
	requesty: { baseUrl: "requestyBaseUrl", apiKey: "requestyApiKey" },
	unbound: { apiKey: "unboundApiKey" },
	huggingface: { apiKey: "huggingFaceApiKey" },
	cerebras: { apiKey: "cerebrasApiKey" },
	sambanova: { apiKey: "sambaNovaApiKey" },
	fireworks: { apiKey: "fireworksApiKey" },
	featherless: { apiKey: "featherlessApiKey" },
	chutes: { apiKey: "chutesApiKey" },
	glama: { apiKey: "glamaApiKey" },
	"nano-gpt": { apiKey: "nanoGptApiKey" },
	inception: { baseUrl: "inceptionLabsBaseUrl", apiKey: "inceptionLabsApiKey" },
	ovhcloud: { baseUrl: "ovhCloudAiEndpointsBaseUrl", apiKey: "ovhCloudAiEndpointsApiKey" },
	"io-intelligence": { apiKey: "ioIntelligenceApiKey" },
	baseten: { apiKey: "basetenApiKey" },
	"vercel-ai-gateway": { apiKey: "vercelAiGatewayApiKey" },
	kilocode: {},
	roo: { apiKey: "rooApiKey" },
}

/** Fields that must never be leaked back to the model in list/get output. */
const SECRET_FIELDS = new Set(["apiKey", "api_key", "token"])

function redactSettings<T extends Record<string, unknown>>(settings: T): Record<string, unknown> {
	const redacted: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(settings)) {
		if (SECRET_FIELDS.has(key) || /ApiKey$/.test(key) || /Token$/.test(key)) {
			redacted[key] = typeof value === "string" && value.length > 0 ? "«redacted»" : value
		} else if (value && typeof value === "object" && !Array.isArray(value)) {
			redacted[key] = redactSettings(value as Record<string, unknown>)
		} else {
			redacted[key] = value
		}
	}
	return redacted
}

export class ManageProviderProfileTool extends BaseTool<"manage_provider_profile"> {
	readonly name = "manage_provider_profile" as const

	parseLegacy(params: Partial<Record<string, string>>): ManageProviderProfileParams {
		let settings: Record<string, unknown> | undefined
		if (params.settings) {
			try {
				const parsed = JSON.parse(params.settings)
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
					settings = parsed as Record<string, unknown>
				}
			} catch {
				settings = undefined
			}
		}
		return {
			action: (params.action as ManageProviderProfileParams["action"]) || "",
			profile_name: params.profile_name || undefined,
			new_name: params.new_name || undefined,
			provider: params.provider || undefined,
			model_id: params.model_id || undefined,
			api_key: params.api_key || undefined,
			base_url: params.base_url || undefined,
			reasoning_effort: params.reasoning_effort || undefined,
			settings,
			reason: params.reason || "",
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"manage_provider_profile">): Promise<void> {
		const p = block.params
		const partialMessage = JSON.stringify({
			tool: "manageProviderProfile",
			action: this.removeClosingTag("action", p.action, block.partial),
			profile: this.removeClosingTag("profile_name", p.profile_name, block.partial),
			newName: this.removeClosingTag("new_name", p.new_name, block.partial),
			reason: this.removeClosingTag("reason", p.reason, block.partial),
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}

	private async approve(
		callbacks: ToolCallbacks,
		payload: Record<string, unknown>,
	): Promise<boolean> {
		return callbacks.askApproval("tool", JSON.stringify({ tool: "manageProviderProfile", ...payload }))
	}

	async execute(params: ManageProviderProfileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const provider = task.providerRef.deref()

		try {
			if (!provider) {
				throw new Error("Provider reference is unavailable")
			}

			if (!params.action) {
				task.consecutiveMistakeCount++
				task.recordToolError("manage_provider_profile")
				pushToolResult(await task.sayAndCreateMissingParamError("manage_provider_profile", "action"))
				return
			}

			const manager = provider.providerSettingsManager
			const state = await provider.getState()
			const currentProfileName = state.currentApiConfigName

			switch (params.action) {
				case "list": {
					const entries = await manager.listConfig()
					const detailed = await Promise.all(
						entries.map(async (entry) => {
							try {
								const { name, id, ...rest } = await manager.getProfile({ name: entry.name })
								const modelId = getModelId(rest as ProviderSettings)
								return {
									name,
									id,
									apiProvider: rest.apiProvider,
									modelId,
									current: entry.name === currentProfileName,
									enableReasoningEffort: rest.enableReasoningEffort,
									reasoningEffort: rest.reasoningEffort,
									modelMaxTokens: rest.modelMaxTokens,
									modelMaxThinkingTokens: rest.modelMaxThinkingTokens,
									modelTemperature: rest.modelTemperature,
									verbosity: rest.verbosity,
									toolProtocol: rest.toolProtocol,
									settings: redactSettings(
										Object.fromEntries(
											Object.entries(rest).filter(
												([k]) =>
													!["enableReasoningEffort", "reasoningEffort", "modelMaxTokens", "modelMaxThinkingTokens", "modelTemperature", "verbosity", "toolProtocol"].includes(k),
											),
										),
									),
								}
							} catch {
								return { name: entry.name, id: entry.id, apiProvider: entry.apiProvider, modelId: entry.modelId, current: entry.name === currentProfileName, error: "unreadable" }
							}
						}),
					)
					pushToolResult(
						`Provider profiles (${detailed.length}, current: ${currentProfileName ?? "none"}):\n${JSON.stringify(detailed, null, 2)}`,
					)
					task.consecutiveMistakeCount = 0
					return
				}

				case "create": {
					const name = params.profile_name?.trim()
					if (!name) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_provider_profile")
						pushToolResult(await task.sayAndCreateMissingParamError("manage_provider_profile", "profile_name"))
						return
					}
					const providerName = params.provider?.trim()
					if (!providerName || !isProviderName(providerName)) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_provider_profile")
						pushToolResult(
							formatResponse.toolError(
								`Parameter provider must be a valid provider name (e.g. anthropic, openai, openai-compatible, deepseek, openrouter, ollama, lmstudio, gemini, zai, groq). Got: ${providerName ?? "(missing)"}`,
							),
						)
						return
					}
					const modelId = params.model_id?.trim()
					if (!modelId) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_provider_profile")
						pushToolResult(await task.sayAndCreateMissingParamError("manage_provider_profile", "model_id"))
						return
					}
					if (await manager.getProfile({ name }).catch(() => null)) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_provider_profile")
						pushToolResult(formatResponse.toolError(`Profile "${name}" already exists. Use action "update" to modify it.`))
						return
					}

					// Build settings: raw settings first, then typed convenience params win.
					const settings: Record<string, unknown> = { ...(params.settings ?? {}) }
					settings.apiProvider = providerName
					if (modelId) {
						const modelKey = isTypicalProvider(providerName)
							? modelIdKeysByProvider[providerName]
							: providerName === "openai" || providerName === "openai-responses"
								? "openAiModelId"
								: undefined
						if (modelKey) settings[modelKey] = modelId
					}
					const fieldMap = providerFieldMap[providerName]
					if (params.api_key && fieldMap?.apiKey) settings[fieldMap.apiKey] = params.api_key
					if (params.base_url && fieldMap?.baseUrl) settings[fieldMap.baseUrl] = params.base_url
					this.applyReasoning(settings, params.reasoning_effort)

					if (!(await this.approve(callbacks, { action: "create", profile: name, provider: providerName, modelId, hasApiKey: !!params.api_key || !!(params.settings as Record<string, unknown> | undefined)?.apiKey, reason: params.reason }))) {
						return
					}

					const id = await provider.upsertProviderProfile(name, settings as ProviderSettings, false)
					if (!id) {
						task.didToolFailInCurrentTurn = true
						task.recordToolError("manage_provider_profile")
						pushToolResult(formatResponse.toolError(`Failed to save profile "${name}". Check the extension output channel for details.`))
						return
					}
					task.consecutiveMistakeCount = 0
					pushToolResult(
						`Created provider profile "${name}" (id: ${id}).\nProvider: ${providerName}\nModel: ${modelId}${params.api_key ? "\nAPI key: stored" : ""}${params.base_url ? `\nBase URL: ${params.base_url}` : ""}\nUse switch_provider_profile to activate it.`,
					)
					return
				}

				case "update": {
					const name = params.profile_name?.trim()
					if (!name) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_provider_profile")
						pushToolResult(await task.sayAndCreateMissingParamError("manage_provider_profile", "profile_name"))
						return
					}
					const existing = await manager.getProfile({ name }).catch(() => null)
					if (!existing) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_provider_profile")
						pushToolResult(formatResponse.toolError(`Profile "${name}" not found. Use action "list" to see available profiles or "create" to add it.`))
						return
					}

					const { name: _n, id, ...stored } = existing
					const settings: Record<string, unknown> = { ...stored }
					const changed: string[] = []

					if (params.provider && isProviderName(params.provider) && params.provider !== settings.apiProvider) {
						settings.apiProvider = params.provider
						changed.push(`provider=${params.provider}`)
					}
					const effectiveProvider = (settings.apiProvider as string) || params.provider || ""
					if (params.model_id) {
						const modelKey = isTypicalProvider(effectiveProvider)
							? modelIdKeysByProvider[effectiveProvider]
							: effectiveProvider === "openai" || effectiveProvider === "openai-responses"
								? "openAiModelId"
								: undefined
						if (modelKey) {
							settings[modelKey] = params.model_id
							changed.push(`model=${params.model_id}`)
						} else {
							pushToolResult(formatResponse.toolError(`Provider "${effectiveProvider}" does not expose a direct model-id field; pass it via settings instead.`))
							return
						}
					}
					const fieldMap = providerFieldMap[effectiveProvider as ProviderName]
					if (params.api_key && fieldMap?.apiKey) {
						settings[fieldMap.apiKey] = params.api_key
						changed.push("api_key=***")
					}
					if (params.base_url && fieldMap?.baseUrl) {
						settings[fieldMap.baseUrl] = params.base_url
						changed.push(`base_url=${params.base_url}`)
					}
					if (params.settings && Object.keys(params.settings).length > 0) {
						for (const [k, v] of Object.entries(params.settings)) settings[k] = v
						changed.push(`settings keys: ${Object.keys(params.settings).join(", ")}`)
					}
					if (params.reasoning_effort !== undefined) {
						const before = `${settings.enableReasoningEffort ?? "(unset)"} / ${settings.reasoningEffort ?? "(unset)"}`
						this.applyReasoning(settings, params.reasoning_effort)
						changed.push(`reasoning: ${before} -> ${settings.enableReasoningEffort} / ${settings.reasoningEffort}`)
					}
					if (changed.length === 0) {
						pushToolResult(`No changes specified for profile "${name}". Provide model_id / api_key / base_url / reasoning_effort / settings.`)
						return
					}

					if (!(await this.approve(callbacks, { action: "update", profile: name, changes: changed, reason: params.reason }))) {
						return
					}

					const savedId = await provider.upsertProviderProfile(name, settings as ProviderSettings, false)
					if (!savedId) {
						task.didToolFailInCurrentTurn = true
						task.recordToolError("manage_provider_profile")
						pushToolResult(formatResponse.toolError(`Failed to save profile "${name}". Check the extension output channel for details.`))
						return
					}
					task.consecutiveMistakeCount = 0
					const isActive = name === currentProfileName
					pushToolResult(
						`Updated provider profile "${name}":\n- ${changed.join("\n- ")}\n${isActive ? "This is the active profile; changes apply to subsequent requests." : "Use switch_provider_profile to activate it."}`,
					)
					return
				}

				case "set_reasoning": {
					const name = params.profile_name?.trim() || currentProfileName
					if (!name) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_provider_profile")
						pushToolResult(formatResponse.toolError("No profile_name given and no active profile exists."))
						return
					}
					if (params.reasoning_effort === undefined) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_provider_profile")
						pushToolResult(await task.sayAndCreateMissingParamError("manage_provider_profile", "reasoning_effort"))
						return
					}
					const level = params.reasoning_effort.trim()
					if (!REASONING_LEVELS.includes(level as (typeof REASONING_LEVELS)[number])) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_provider_profile")
						pushToolResult(
							formatResponse.toolError(
								`Invalid reasoning_effort "${level}". Allowed values: ${REASONING_LEVELS.join(", ")}. Use "disable" or "none" to turn reasoning off.`,
							),
						)
						return
					}
					const existing = await manager.getProfile({ name }).catch(() => null)
					if (!existing) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_provider_profile")
						pushToolResult(formatResponse.toolError(`Profile "${name}" not found.`))
						return
					}
					const { name: _n, id, ...stored } = existing
					const settings: Record<string, unknown> = { ...stored }
					this.applyReasoning(settings, level)

					if (!(await this.approve(callbacks, { action: "set_reasoning", profile: name, reasoningEffort: level, reason: params.reason }))) {
						return
					}

					const savedId = await provider.upsertProviderProfile(name, settings as ProviderSettings, false)
					if (!savedId) {
						task.didToolFailInCurrentTurn = true
						task.recordToolError("manage_provider_profile")
						pushToolResult(formatResponse.toolError(`Failed to save reasoning settings for "${name}".`))
						return
					}
					task.consecutiveMistakeCount = 0
					const isActive = name === currentProfileName
					pushToolResult(
						`Reasoning for profile "${name}" set to ${level}${level === "disable" || level === "none" ? " (reasoning off)" : ""}.\n${isActive ? "Active profile: applies from the next request." : "Use switch_provider_profile to activate it."}`,
					)
					return
				}

				case "rename": {
					const name = params.profile_name?.trim()
					const newName = params.new_name?.trim()
					if (!name || !newName) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_provider_profile")
						pushToolResult(formatResponse.toolError("rename requires both profile_name (old) and new_name."))
						return
					}
					if (name === newName) {
						pushToolResult(`Profile name unchanged ("${name}").`)
						return
					}
					const existing = await manager.getProfile({ name }).catch(() => null)
					if (!existing) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_provider_profile")
						pushToolResult(formatResponse.toolError(`Profile "${name}" not found.`))
						return
					}
					if (await manager.getProfile({ name: newName }).catch(() => null)) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_provider_profile")
						pushToolResult(formatResponse.toolError(`Profile "${newName}" already exists.`))
						return
					}

					if (!(await this.approve(callbacks, { action: "rename", profile: name, newName, reason: params.reason }))) {
						return
					}

					await manager.saveConfig(newName, existing as ProviderSettingsWithId)
					await manager.deleteConfig(name)
					if (name === currentProfileName) {
						await provider.activateProviderProfile({ name: newName })
					}
					task.consecutiveMistakeCount = 0
					pushToolResult(`Renamed provider profile "${name}" -> "${newName}"${name === currentProfileName ? " (active profile re-activated under the new name)" : ""}.`)
					return
				}

				default:
					task.consecutiveMistakeCount++
					task.recordToolError("manage_provider_profile")
					pushToolResult(
						formatResponse.toolError(
							`Unknown action "${params.action}". Allowed: list, create, update, set_reasoning, rename.`,
						),
					)
					return
			}
		} catch (error) {
			await handleError("managing provider profile", error as Error)
		}
	}

	/**
	 * Apply a reasoning level to settings.
	 * - "disable"/"none" => enableReasoningEffort=false (hard off; reasoningEffort kept for UI display)
	 * - level => enableReasoningEffort=true + reasoningEffort=level
	 */
	private applyReasoning(settings: Record<string, unknown>, level: string | undefined): void {
		if (level === undefined) return
		const trimmed = level.trim()
		if (trimmed === "disable" || trimmed === "none") {
			settings.enableReasoningEffort = false
			settings.reasoningEffort = trimmed
		} else {
			settings.enableReasoningEffort = true
			settings.reasoningEffort = trimmed
		}
	}
}

export const manageProviderProfileTool = new ManageProviderProfileTool()
