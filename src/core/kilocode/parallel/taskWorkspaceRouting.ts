/**
 * Assigned-workspace routing for parallel subagents (kilocode_change - new file)
 *
 * Tool read/write/execute must follow the workspace handed to the child at
 * dispatch time. Global UI cwd, parent cwd, and same-session occupancy must
 * not steal that binding. Shared read-only children keep the parent path.
 */

import { workspacePathsEqual } from "./workspaceOccupancy"

export interface AssignedWorkspaceInputs {
	taskId?: string
	isSubagent?: boolean
	taskCwd?: string
	historyWorkspace?: string
	sessionWorkspacePath?: string
	conversationWorkspacePath?: string
	providerCwd?: string
	parentCwd?: string
}

/**
 * Identity binding for a conversation/task. Session path (dispatch assignment)
 * wins over the parallel conversation record, then history, then the live
 * task cwd. Subagents never fall back to provider/parent cwd.
 */
export function resolveAssignedWorkspacePath(params: AssignedWorkspaceInputs): string | undefined {
	const assigned =
		nonEmpty(params.sessionWorkspacePath) ??
		nonEmpty(params.conversationWorkspacePath) ??
		nonEmpty(params.historyWorkspace) ??
		nonEmpty(params.taskCwd)
	if (assigned) {
		return assigned
	}
	if (params.isSubagent) {
		return undefined
	}
	return nonEmpty(params.providerCwd) ?? nonEmpty(params.parentCwd)
}

/**
 * Path tools should resolve against. Prefer the live task cwd when it already
 * matches the assignment; otherwise the assignment. Subagents never use the
 * global UI folder or parent cwd as a fallback.
 */
export function resolveTaskToolWorkspace(params: AssignedWorkspaceInputs): string | undefined {
	const assigned = resolveAssignedWorkspacePath(params)
	const taskCwd = nonEmpty(params.taskCwd)
	if (taskCwd && assigned && workspacePathsEqual(taskCwd, assigned)) {
		return taskCwd
	}
	if (assigned) {
		return assigned
	}
	if (params.isSubagent) {
		return taskCwd
	}
	return taskCwd ?? nonEmpty(params.providerCwd) ?? nonEmpty(params.parentCwd)
}

export function workspaceBindingDrifted(taskCwd: string | undefined, assigned: string | undefined): boolean {
	if (!assigned) {
		return false
	}
	if (!taskCwd) {
		return true
	}
	return !workspacePathsEqual(taskCwd, assigned)
}

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim()
	return trimmed ? trimmed : undefined
}
