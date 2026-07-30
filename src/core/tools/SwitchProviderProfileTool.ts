import delay from "delay"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface SwitchProviderProfileParams {
	profile_name: string
	model_id?: string
	reason: string
}

export class SwitchProviderProfileTool extends BaseTool<"switch_provider_profile"> {
	readonly name = "switch_provider_profile" as const

	parseLegacy(params: Partial<Record<string, string>>): SwitchProviderProfileParams {
		return {
			profile_name: params.profile_name || "",
			model_id: params.model_id || undefined,
			reason: params.reason || "",
		}
	}

	async execute(params: SwitchProviderProfileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { profile_name, model_id, reason } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			if (!profile_name) {
				task.consecutiveMistakeCount++
				task.recordToolError("switch_provider_profile")
				pushToolResult(await task.sayAndCreateMissingParamError("switch_provider_profile", "profile_name"))
				return
			}

			const provider = task.providerRef.deref()
			if (!provider) {
				throw new Error("Provider reference is unavailable")
			}

			const currentProfile = (await provider.getState()).currentApiConfigName
			if (currentProfile === profile_name && !model_id) {
				pushToolResult(`Already using provider profile "${profile_name}".`)
				return
			}

			const approvalMessage = JSON.stringify({
				tool: "switchProviderProfile",
				profile: profile_name,
				model: model_id,
				reason,
			})
			if (!(await askApproval("tool", approvalMessage))) {
				return
			}

			const result = await provider.switchProviderProfileWithPreflight(profile_name, task, model_id)
			if (!result.ok) {
				task.didToolFailInCurrentTurn = true
				task.recordToolError("switch_provider_profile")
				pushToolResult(formatResponse.toolError(result.reason))
				return
			}

			task.consecutiveMistakeCount = 0
			pushToolResult(
				`Successfully switched provider profile from "${currentProfile ?? "default"}" to "${profile_name}". ${result.modelId ? `Active model: ${result.modelId}.` : ""}`.trim(),
			)
			await delay(250)
		} catch (error) {
			await handleError("switching provider profile", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"switch_provider_profile">): Promise<void> {
		const profileName = block.params.profile_name
		const modelId = block.params.model_id
		const reason = block.params.reason
		const partialMessage = JSON.stringify({
			tool: "switchProviderProfile",
			profile: this.removeClosingTag("profile_name", profileName, block.partial),
			model: this.removeClosingTag("model_id", modelId, block.partial),
			reason: this.removeClosingTag("reason", reason, block.partial),
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const switchProviderProfileTool = new SwitchProviderProfileTool()
