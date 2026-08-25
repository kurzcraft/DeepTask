/**
 * Occupancy helpers for parallel workspaces (kilocode_change - new file)
 *
 * A workspace is occupied when another live task, subagent, or claimed registry
 * entry is already writing there. The later conversation then gets a fresh
 * git worktree under the same folder and the left-rail node moves with it.
 */

import * as path from "path"
import type { ParallelConversation, ParallelWorkspace } from "@roo-code/types"

export function normalizeWorkspacePath(targetPath: string): string {
	return path.resolve(targetPath).replace(/[\\/]+$/, "")
}

export function workspacePathsEqual(a: string, b: string): boolean {
	return normalizeWorkspacePath(a) === normalizeWorkspacePath(b)
}

export interface WorkspaceOccupant {
	kind: "conversation" | "task" | "subagent" | "registry"
	id: string
	label?: string
}

export interface OccupancyInputs {
	workspacePath: string
	conversations: ParallelConversation[]
	runningTasks: Array<{
		taskId: string
		cwd: string
		abort?: boolean
		abandoned?: boolean
		isStreaming?: boolean
		isActivelyRunning?: boolean
	}>
	runningSubagents: Array<{
		sessionId: string
		workspacePath?: string
		workspaceName?: string
		label?: string
	}>
	workspaces: ParallelWorkspace[]
	except?: { taskId?: string; conversationId?: string }
}

const conversationWorkspacePath = (conversation: ParallelConversation): string =>
	conversation.workspacePath ?? conversation.folderPath

export function collectWorkspaceOccupants(params: OccupancyInputs): WorkspaceOccupant[] {
	const occupants: WorkspaceOccupant[] = []
	const seen = new Set<string>()
	const add = (occupant: WorkspaceOccupant) => {
		const key = `${occupant.kind}:${occupant.id}`
		if (seen.has(key)) {
			return
		}
		seen.add(key)
		occupants.push(occupant)
	}

	const liveTasks = params.runningTasks.filter(
		(task) =>
			!task.abort &&
			!task.abandoned &&
			(task.isActivelyRunning === true || (task.isActivelyRunning === undefined && task.isStreaming === true)),
	)
	const liveById = new Map(liveTasks.map((task) => [task.taskId, task]))

	for (const conversation of params.conversations) {
		if (params.except?.conversationId && conversation.id === params.except.conversationId) {
			continue
		}
		if (!workspacePathsEqual(conversationWorkspacePath(conversation), params.workspacePath)) {
			continue
		}
		if (!conversation.sessionId || conversation.sessionId === params.except?.taskId) {
			continue
		}
		const running = liveById.get(conversation.sessionId)
		if (running) {
			add({
				kind: "conversation",
				id: conversation.id,
				label: conversation.title ?? conversation.sessionId,
			})
		}
	}

	for (const task of liveTasks) {
		if (task.taskId === params.except?.taskId) {
			continue
		}
		if (!workspacePathsEqual(task.cwd, params.workspacePath)) {
			continue
		}
		add({ kind: "task", id: task.taskId })
	}

	for (const subagent of params.runningSubagents) {
		const named = subagent.workspaceName
			? params.workspaces.find((workspace) => workspace.name === subagent.workspaceName)
			: undefined
		const subagentPath = subagent.workspacePath ?? named?.path
		if (!subagentPath || !workspacePathsEqual(subagentPath, params.workspacePath)) {
			continue
		}
		add({
			kind: "subagent",
			id: subagent.sessionId,
			label: subagent.label ?? subagent.sessionId,
		})
	}

	for (const workspace of params.workspaces) {
		if (workspace.status !== "busy" || !workspacePathsEqual(workspace.path, params.workspacePath)) {
			continue
		}
		if (params.except?.taskId && workspace.owner?.includes(params.except.taskId)) {
			continue
		}
		if (params.except?.conversationId && workspace.owner?.includes(params.except.conversationId)) {
			continue
		}
		// A leftover busy mark must not occupy an idle workspace. Only count
		// the registry claim when a live streaming task still matches it.
		const ownerLive = workspace.owner
			? liveTasks.some((task) => workspace.owner?.includes(task.taskId))
			: liveTasks.some((task) => workspacePathsEqual(task.cwd, workspace.path))
		if (!ownerLive) {
			continue
		}
		add({
			kind: "registry",
			id: workspace.name,
			label: workspace.owner,
		})
	}

	return occupants
}
