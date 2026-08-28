import {
	type ClineAsk,
	type ClineSayTool,
	type McpServerUse,
	type FollowUpData,
	type ExtensionState,
	isNonBlockingAsk,
} from "@roo-code/types"

import { ClineAskResponse } from "../../shared/WebviewMessage"

import { isWriteToolAction, isReadOnlyToolAction } from "./tools"
import { isMcpToolAlwaysAllowed } from "./mcp"
import { getCommandDecision } from "./commands"

// Auto-approvable action categories. // kilocode_change
export type AutoApprovalState =
	| "alwaysAllowReadOnly"
	| "alwaysAllowWrite"
	| "alwaysAllowDelete" // kilocode_change
	| "alwaysAllowBrowser"
	| "alwaysAllowMcp"
	| "alwaysAllowModeSwitch"
	| "alwaysAllowProviderProfileSwitch" // kilocode_change
	| "alwaysAllowSubtasks"
	| "alwaysAllowExecute"
	| "alwaysAllowFollowupQuestions"

// Some of these actions have additional settings associated with them.
export type AutoApprovalStateOptions =
	| "autoApprovalEnabled"
	| "alwaysAllowReadOnlyOutsideWorkspace" // For `alwaysAllowReadOnly`.
	| "alwaysAllowWriteOutsideWorkspace" // For `alwaysAllowWrite`.
	| "alwaysAllowWriteProtected"
	| "followupAutoApproveTimeoutMs" // For `alwaysAllowFollowupQuestions`.
	| "mcpServers" // For `alwaysAllowMcp`.
	| "allowedCommands" // For `alwaysAllowExecute`.
	| "deniedCommands"

export type CheckAutoApprovalResult =
	| { decision: "approve" }
	| { decision: "deny" }
	| { decision: "ask" }
	| {
			decision: "timeout"
			timeout: number
			fn: () => { askResponse: ClineAskResponse; text?: string; images?: string[] }
	  }

export async function checkAutoApproval({
	state,
	ask,
	text,
	isProtected,
}: {
	state?: Pick<
		ExtensionState,
		| AutoApprovalState
		| AutoApprovalStateOptions
		| "autoApprovalEnabled"
		| "yoloMode"
		| "agentSubagentDispatchEnabled"
		| "agentWorkspaceManagementEnabled"
	>
	ask: ClineAsk
	text?: string
	isProtected?: boolean
}): Promise<CheckAutoApprovalResult> {
	if (isNonBlockingAsk(ask)) {
		return { decision: "approve" }
	}

	if (!state || !state.autoApprovalEnabled) {
		return { decision: "ask" }
	}

	if (ask === "followup") {
		if (state.alwaysAllowFollowupQuestions === true) {
			try {
				const suggestion = (JSON.parse(text || "{}") as FollowUpData).suggest?.[0]

				if (
					suggestion &&
					typeof state.followupAutoApproveTimeoutMs === "number" &&
					state.followupAutoApproveTimeoutMs > 0
				) {
					return {
						decision: "timeout",
						timeout: state.followupAutoApproveTimeoutMs,
						fn: () => ({ askResponse: "messageResponse", text: suggestion.answer }),
					}
				} else {
					return { decision: "ask" }
				}
			} catch (error) {
				return { decision: "ask" }
			}
		} else {
			return { decision: "ask" }
		}
	}

	if (ask === "browser_action_launch") {
		return state.alwaysAllowBrowser === true ? { decision: "approve" } : { decision: "ask" }
	}

	if (ask === "use_mcp_server") {
		if (!text) {
			return { decision: "ask" }
		}

		try {
			const mcpServerUse = JSON.parse(text) as McpServerUse

			if (mcpServerUse.type === "use_mcp_tool") {
				return state.alwaysAllowMcp === true && isMcpToolAlwaysAllowed(mcpServerUse, state.mcpServers)
					? { decision: "approve" }
					: { decision: "ask" }
			} else if (mcpServerUse.type === "access_mcp_resource") {
				return state.alwaysAllowMcp === true ? { decision: "approve" } : { decision: "ask" }
			}
		} catch (error) {
			return { decision: "ask" }
		}

		return { decision: "ask" }
	}

	if (ask === "command") {
		if (!text) {
			return { decision: "ask" }
		}

		// kilocode_change start - execute permission is the master gate for command auto-approval
		// allowedCommands (including "*") only defines scope while execution auto-approval is enabled.
		// It must never override an explicit user choice to disable the Execute permission.
		if (state.alwaysAllowExecute === true) {
			const decision = getCommandDecision(text, state.allowedCommands || [], state.deniedCommands || [])
			// kilocode_change end

			if (decision === "auto_approve") {
				return { decision: "approve" }
			} else if (decision === "auto_deny") {
				return { decision: "deny" }
			} else {
				return { decision: "ask" }
			}
		}
	}

	if (ask === "tool") {
		let tool: ClineSayTool | undefined

		try {
			tool = JSON.parse(text || "{}")
		} catch (error) {
			console.error("Failed to parse tool:", error)
		}

		if (!tool) {
			return { decision: "ask" }
		}

		if (tool.tool === "updateTodoList") {
			return { decision: "approve" }
		}

		if (tool?.tool === "fetchInstructions") {
			if (tool.content === "create_mode") {
				return state.alwaysAllowModeSwitch === true ? { decision: "approve" } : { decision: "ask" }
			}

			if (tool.content === "create_mcp_server") {
				return state.alwaysAllowMcp === true ? { decision: "approve" } : { decision: "ask" }
			}
		}

		if (tool?.tool === "switchMode") {
			return state.alwaysAllowModeSwitch === true ? { decision: "approve" } : { decision: "ask" }
		}

		// kilocode_change start - provider/profile switching has an independent permission.
		// manageProviderProfile (create/update/set_reasoning/rename) shares the same
		// permission gate as switching: both mutate provider profile state, and leaving
		// it unhandled here made set_reasoning fall through to a manual ask even when
		// the provider-profile permission was enabled.
		if (tool?.tool === "switchProviderProfile" || tool?.tool === "manageProviderProfile") {
			return state.alwaysAllowProviderProfileSwitch === true ? { decision: "approve" } : { decision: "ask" }
		}
		// kilocode_change end

		if (["newTask", "finishTask"].includes(tool?.tool)) {
			return state.alwaysAllowSubtasks === true ? { decision: "approve" } : { decision: "ask" }
		}

		// kilocode_change start: parallel subagents & workspaces.
		// dispatch follows the subtask permission; workspace status is read-only;
		// workspace create/merge follow the workspace management permission.
		if (tool?.tool === "dispatchSubagents") {
			return state.agentSubagentDispatchEnabled === false
				? { decision: "deny" }
				: state.alwaysAllowSubtasks === true || state.agentSubagentDispatchEnabled === true
					? { decision: "approve" }
					: { decision: "ask" }
		}

		if (tool?.tool === "workspaceStatus") {
			return { decision: "approve" }
		}

		if (tool?.tool === "workspaceCreate" || tool?.tool === "workspaceMerge") {
			return state.agentWorkspaceManagementEnabled === false
				? { decision: "deny" }
				: { decision: "approve" }
		}
		// kilocode_change end

		const isOutsideWorkspace = !!tool.isOutsideWorkspace

		if (isReadOnlyToolAction(tool)) {
			return state.alwaysAllowReadOnly === true &&
				(!isOutsideWorkspace || state.alwaysAllowReadOnlyOutsideWorkspace === true)
				? { decision: "approve" }
				: { decision: "ask" }
		}

		if (isWriteToolAction(tool)) {
			return state.alwaysAllowWrite === true &&
				(!isOutsideWorkspace || state.alwaysAllowWriteOutsideWorkspace === true) &&
				(!isProtected || state.alwaysAllowWriteProtected === true)
				? { decision: "approve" }
				: { decision: "ask" }
		}

		// kilocode_change start
		if (tool.tool === "deleteFile") {
			return state.alwaysAllowDelete === true ? { decision: "approve" } : { decision: "ask" }
		}
		// kilocode_change end
	}

	return { decision: "ask" }
}

export { AutoApprovalHandler } from "./AutoApprovalHandler"
