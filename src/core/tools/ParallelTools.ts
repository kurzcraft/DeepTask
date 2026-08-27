/**
 * Parallel tools: dispatch_subagents / workspace_status / workspace_create / workspace_merge
 * (kilocode_change - new file)
 *
 * These tools let the main model run parallel subagents and manage isolated
 * git-worktree workspaces. Subagents are real Task instances running with the
 * same integrated-terminal chat experience; their transcripts stream to the
 * webview parallel panel instead of the main chat.
 */

import { formatResponse } from "../prompts/responses"
import { Task } from "../task/Task"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { MAX_PARALLEL_SUBAGENTS, MAX_SUBAGENT_DEPTH, type SubagentSpec } from "../kilocode/parallel/ParallelManager"
import type { ClineProvider } from "../webview/ClineProvider"

// ---------------------------------------------------------------- dispatch_subagents

export interface SubagentTaskSpec {
	task: string
	label?: string
	mode?: string
	needs_workspace?: boolean
	workspace?: string
}

export class DispatchSubagentsTool extends BaseTool<"dispatch_subagents"> {
	readonly name = "dispatch_subagents" as const

	parseLegacy(params: Partial<Record<string, string>>): { tasks: SubagentTaskSpec[] } {
		return { tasks: parseTasksParam(params.tasks) }
	}

	async execute(params: { tasks: SubagentTaskSpec[] }, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			const specs = params.tasks ?? []
			if (!Array.isArray(specs) || specs.length === 0) {
				pushToolResult(formatResponse.toolError("Provide a non-empty `tasks` array."))
				return
			}
			if (specs.length > MAX_PARALLEL_SUBAGENTS) {
				pushToolResult(
					formatResponse.toolError(`At most ${MAX_PARALLEL_SUBAGENTS} parallel subagents can run at once.`),
				)
				return
			}
			if (specs.some((s) => !s?.task || typeof s.task !== "string")) {
				pushToolResult(formatResponse.toolError('Every subagent needs a non-empty "task" string.'))
				return
			}

			if ((task.subagent?.depth ?? 0) >= MAX_SUBAGENT_DEPTH) {
				pushToolResult(
					formatResponse.toolError("Subagents cannot dispatch their own subagents (depth limit reached)."),
				)
				return
			}

			const provider = task.providerRef.deref()
			if (!provider?.parallelManager) {
				pushToolResult(formatResponse.toolError("Parallel manager unavailable."))
				return
			}
			const manager = provider.parallelManager

			const state = await provider.getState()
			if (state?.agentSubagentDispatchEnabled === false) {
				pushToolResult(
					formatResponse.toolError(
						"Parallel subagent dispatch is disabled in settings (ask the user to enable it).",
					),
				)
				return
			}

			const summary = specs
				.map(
					(s, i) =>
						`${i + 1}. ${s.label ?? s.task.slice(0, 60)}${s.needs_workspace ? " [own workspace]" : ""}`,
				)
				.join("\n")
			const didApprove = await askApproval(
				"tool",
				JSON.stringify({ tool: "dispatchSubagents", count: specs.length, content: summary }),
			)
			if (!didApprove) {
				return
			}

			// Prepare workspaces (create/claim) before spawning so busy conflicts
			// fail fast without leaving half-spawned agents behind.
			const prepared: Array<{ spec: SubagentSpec; workspaceName?: string }> = []
			const failures: string[] = []
			const folderPath = manager.folderPathForPath(task.cwd)
			const workspaceService = provider.getWorkspaceService(folderPath) // kilocode_change: root at the parent folder

			for (const [index, spec] of specs.entries()) {
				const label = spec.label || `subagent-${index + 1}`
				try {
					if (spec.workspace && workspaceService) {
						let claimed = await workspaceService.claim(spec.workspace, `dispatch:${task.taskId}`)
						if (!claimed) {
							if ((await provider.getState())?.agentWorkspaceManagementEnabled === false) {
								failures.push(
									`${label}: workspace "${spec.workspace}" is busy and workspace management is disabled.`,
								)
								continue
							}
							const created = await workspaceService.create({
								name: `${spec.workspace}-fork`,
								description: spec.task,
								folderPath,
							})
							claimed = await workspaceService.claim(created.name, `dispatch:${task.taskId}`)
							if (!claimed) {
								failures.push(
									`${label}: workspace "${spec.workspace}" was busy and a sibling worktree could not be claimed.`,
								)
								continue
							}
						}
						prepared.push({
							spec: {
								label,
								task: spec.task,
								workspaceName: claimed.name,
								workspacePath: claimed.path,
								branch: claimed.branch,
							},
							workspaceName: claimed.name,
						})
					} else if (spec.needs_workspace && workspaceService) {
						if ((await provider.getState())?.agentWorkspaceManagementEnabled === false) {
							failures.push(`${label}: workspace management is disabled; run without needs_workspace.`)
							continue
						}
						const created = await workspaceService.create({
							name: label,
							description: spec.task,
							folderPath,
						})
						await workspaceService.claim(created.name, `dispatch:${task.taskId}`)
						prepared.push({
							spec: {
								label,
								task: spec.task,
								workspaceName: created.name,
								workspacePath: created.path,
								branch: created.branch,
							},
							workspaceName: created.name,
						})
					} else {
						prepared.push({ spec: { label, task: spec.task } })
					}
				} catch (error) {
					failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
				}
			}

			// Spawn every prepared subagent in parallel.
			const spawned = prepared.map((p) => manager.spawn(task, p.spec))

			// Wait for ALL subagents to settle (the main model continues only
			// after that). Poll the parent abort flag so cancelling the parent
			// cancels all children promptly.
			const allSettled = Promise.allSettled(spawned.map((s) => s.done))
			while ((await raceWithTimeout(allSettled, 500)) === "timeout") {
				if (task.abort) {
					manager.cancelChildrenOf(task.taskId)
				}
			}
			await allSettled

			const mergeNotes: string[] = []
			if (workspaceService) {
				for (const preparedSpec of prepared) {
					const workspaceName = preparedSpec.workspaceName
					if (!workspaceName) {
						continue
					}
					const session = manager.getSession(
						spawned.find((s) => manager.getSession(s.sessionId)?.info.workspaceName === workspaceName)
							?.sessionId ?? "",
					)
					if (session && session.info.status !== "completed") {
						continue
					}
					try {
						const summaries = await workspaceService.summaries()
						const summary = summaries.find((item) => item.name === workspaceName)
						const hasWrites = (summary?.dirtyFiles ?? 0) > 0 || (summary?.aheadOfBase ?? 0) > 0
						if (!hasWrites) {
							continue
						}
						const merged = await workspaceService.merge({
							name: workspaceName,
							removeAfter: false,
							allowOwner: task.taskId,
						})
						mergeNotes.push(
							merged.ok
								? `Auto-merged "${workspaceName}" into the parent workspace: ${merged.reason ?? "ok"}`
								: `Auto-merge of "${workspaceName}" failed: ${merged.reason ?? "unknown"}`,
						)
					} catch (error) {
						mergeNotes.push(
							`Auto-merge of "${workspaceName}" failed: ${error instanceof Error ? error.message : String(error)}`,
						)
					}
				}
			}

			const lines: string[] = []
			if (failures.length > 0) {
				lines.push(`Failed to dispatch:\n${failures.join("\n")}`)
			}
			lines.push(`All ${spawned.length} subagent(s) finished:`)
			for (const s of spawned) {
				const session = manager.getSession(s.sessionId)
				if (!session) {
					continue
				}
				const info = session.info
				const ws = info.workspaceName ? ` [workspace: ${info.workspaceName} (${info.branch ?? "n/a"})]` : ""
				const outcome =
					info.status === "completed"
						? `completed`
						: info.status === "cancelled"
							? `cancelled`
							: `error: ${info.error ?? "unknown"}`
				const result = info.result ? `\nResult:\n${truncate(info.result, 4000)}` : "\nResult: (none)"
				lines.push(`## ${info.label} — ${outcome}${ws}${result}`)
			}
			if (mergeNotes.length > 0) {
				lines.push(`Parent workspace merge:\n${mergeNotes.join("\n")}`)
			}
			lines.push(
				"Next steps: review the results above. Write-bearing workspaces were auto-merged into the parent workspace when possible; use workspace_merge only for leftover conflicts or leftover worktrees.",
			)

			await manager.broadcast()
			pushToolResult(lines.join("\n\n"))
		} catch (error) {
			await handleError("dispatching parallel subagents", error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"dispatch_subagents">): Promise<void> {
		const tasks = block.params.tasks
		const preview = Array.isArray(tasks)
			? tasks
					.map((t) => t?.task ?? "")
					.join(" | ")
					.slice(0, 120)
			: String(tasks ?? "").slice(0, 120)
		const partialMessage = JSON.stringify({ tool: "dispatchSubagents", content: preview })
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

function truncate(text: string, max: number): string {
	if (text.length <= max) {
		return text
	}
	return `${text.slice(0, max)}\n…(truncated)`
}

function parseTasksParam(raw: string | undefined): SubagentTaskSpec[] {
	if (!raw) {
		return []
	}
	try {
		const parsed = JSON.parse(raw)
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}

function raceWithTimeout(promise: Promise<unknown>, ms: number): Promise<"done" | "timeout"> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve("timeout"), ms)
		promise.then(
			() => {
				clearTimeout(timer)
				resolve("done")
			},
			() => {
				clearTimeout(timer)
				resolve("done")
			},
		)
	})
}

// ---------------------------------------------------------------- workspace_status

export class WorkspaceStatusTool extends BaseTool<"workspace_status"> {
	readonly name = "workspace_status" as const

	parseLegacy(): Record<string, never> {
		return {}
	}

	async execute(_params: Record<string, never>, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks
		try {
			const provider = task.providerRef.deref()
			if (!provider?.workspaceService) {
				pushToolResult(formatResponse.toolError("Workspace service unavailable."))
				return
			}
			const manager = provider.parallelManager
			const folderPath = manager?.folderPathForPath(task.cwd) ?? task.cwd
			const summaries = await provider.getWorkspaceService(folderPath).summaries() // kilocode_change: root at the parent folder
			const runningByWorkspace = new Map<string, number>()
			if (manager) {
				for (const s of manager.listRunning()) {
					if (s.info.workspaceName) {
						runningByWorkspace.set(
							s.info.workspaceName,
							(runningByWorkspace.get(s.info.workspaceName) ?? 0) + 1,
						)
					}
				}
			}

			// kilocode_change start: occupancy by workspacePath (main + worktrees)
			let conversationLines: string[] = []
			if (manager) {
				const conversations = await manager.listConversations()
				conversationLines = conversations.map((c) => {
					const isCurrent = c.sessionId && c.sessionId === task.taskId
					const workspacePath = c.workspacePath ?? c.folderPath
					return `- workspace=${workspacePath} folder=${c.folderPath}${
						c.title ? ` title="${c.title}"` : ""
					}${isCurrent ? " (THIS conversation)" : " (another conversation)"}`
				})
				const occupants = await manager.occupantsOf(task.cwd, { taskId: task.taskId })
				if (occupants.length > 0) {
					conversationLines.unshift(
						`Current cwd ${task.cwd} is OCCUPIED by: ${occupants
							.map((occupant) => `${occupant.kind}:${occupant.label ?? occupant.id}`)
							.join(
								", ",
							)}. Later write-heavy work should use a new workspace; this conversation is migrated automatically when a second task starts here.`,
					)
				}
			}
			// kilocode_change end

			if (summaries.length === 0) {
				if (conversationLines.length > 0) {
					pushToolResult(
						[
							"No dedicated git-worktree workspaces exist yet.",
							"Conversations currently working in these folders:",
							...conversationLines,
							"Use workspace_create before dispatching write-heavy subagents so they do not conflict with the conversations above.",
						].join("\n"),
					)
					return
				}
				pushToolResult(
					"No parallel workspaces exist yet. Use workspace_create (or dispatch_subagents with needs_workspace) to create isolated git worktree workspaces for write-heavy subagents.",
				)
				return
			}

			const lines = summaries.map((ws) => {
				const running = runningByWorkspace.get(ws.name)
				const busy =
					ws.status === "busy" || running ? ` (IN USE${running ? ` by ${running} agent(s)` : ""})` : ""
				return `- ${ws.name}: ${ws.status}${busy} branch=${ws.branch} base=${ws.baseBranch} dirtyFiles=${ws.dirtyFiles} commitsAhead=${ws.aheadOfBase} path=${ws.path}`
			})
			if (conversationLines.length > 0) {
				lines.push("Conversations currently working in these folders:")
				lines.push(...conversationLines)
			}
			lines.push(
				"Occupied workspaces are isolated automatically: a later conversation or a busy named workspace gets a sibling git worktree. Merge completed work with workspace_merge.",
			)
			pushToolResult(lines.join("\n"))
		} catch (error) {
			await handleError("checking parallel workspaces", error)
		}
	}
}

// ---------------------------------------------------------------- workspace_create

export class WorkspaceCreateTool extends BaseTool<"workspace_create"> {
	readonly name = "workspace_create" as const

	parseLegacy(params: Partial<Record<string, string>>): { name?: string; task_description?: string } {
		return { name: params.name, task_description: params.task_description }
	}

	async execute(
		params: { name?: string; task_description?: string },
		task: Task,
		callbacks: ToolCallbacks,
	): Promise<void> {
		const { handleError, pushToolResult } = callbacks
		try {
			const provider = task.providerRef.deref()
			if (!provider?.workspaceService) {
				pushToolResult(formatResponse.toolError("Workspace service unavailable."))
				return
			}
			const state = await provider.getState()
			if (state?.agentWorkspaceManagementEnabled === false) {
				pushToolResult(
					formatResponse.toolError(
						"Workspace management is disabled in settings (ask the user to enable it).",
					),
				)
				return
			}

			const manager = provider.parallelManager
			const folderPath = manager?.folderPathForPath(task.cwd) ?? task.cwd
			const created = await provider.getWorkspaceService(folderPath).create({
				name: params.name,
				description: params.task_description,
				folderPath,
			})
			await provider.getWorkspaceService(folderPath).claim(created.name, `task:${task.taskId}`)
			await task.switchWorkspace(created.path)
			// kilocode_change: bind-or-reuse the conversation, then re-parent it so the
			// left rail always shows this conversation under the new worktree.
			if (manager) {
				await manager.syncSessionWorkspace(task.taskId, created.path)
			}
			await provider.postMessageToWebview({ type: "parallelWorkspaceChanged", text: created.path })
			await manager?.broadcast()

			pushToolResult(
				`Created workspace "${created.name}" and moved this conversation there.\n- path: ${created.path}\n- branch: ${created.branch} (base: ${created.baseBranch})\nThe left-rail conversation now lives under this worktree. Subagents dispatched with workspace="${created.name}" will work there. Merge it back with workspace_merge when the work is done.`,
			)
		} catch (error) {
			await handleError("creating parallel workspace", error)
		}
	}

	override async handlePartial(_task: Task, _block: ToolUse<"workspace_create">): Promise<void> {
		// Workspace tools auto-approve; do not open the approval bar while streaming.
	}
}

// ---------------------------------------------------------------- workspace_merge

export class WorkspaceMergeTool extends BaseTool<"workspace_merge"> {
	readonly name = "workspace_merge" as const

	parseLegacy(params: Partial<Record<string, string>>): {
		name: string
		delete_after?: boolean
		switch_to?: string
	} {
		return {
			name: params.name || "",
			delete_after: params.delete_after === "true",
			switch_to: params.switch_to,
		}
	}

	async execute(
		params: { name: string; delete_after?: boolean; switch_to?: string },
		task: Task,
		callbacks: ToolCallbacks,
	): Promise<void> {
		const { handleError, pushToolResult } = callbacks
		try {
			if (!params.name) {
				pushToolResult(await task.sayAndCreateMissingParamError("workspace_merge", "name"))
				return
			}
			const provider = task.providerRef.deref()
			if (!provider?.workspaceService) {
				pushToolResult(formatResponse.toolError("Workspace service unavailable."))
				return
			}
			const state = await provider.getState()
			if (state?.agentWorkspaceManagementEnabled === false) {
				pushToolResult(
					formatResponse.toolError(
						"Workspace management is disabled in settings (ask the user to enable it).",
					),
				)
				return
			}

			const manager = provider.parallelManager
			const folderPath = manager?.folderPathForPath(task.cwd) ?? task.cwd
			const service = provider.getWorkspaceService(folderPath)
			const source =
				(await service.findByNameOrPath(params.name)) ??
				(await service.findByNameOrPath(task.cwd))
			if (!source) {
				pushToolResult(formatResponse.toolError(`Unknown workspace "${params.name}".`))
				return
			}

			const switchTarget = (params.switch_to ?? "").trim()
			const wantsSwitch = switchTarget.length > 0
			const nextPath = wantsSwitch
				? switchTarget === "main" || switchTarget === folderPath
					? folderPath
					: ((await service.findByNameOrPath(switchTarget))?.path ?? switchTarget)
				: undefined

			if (nextPath && nextPath !== task.cwd) {
				await task.switchWorkspace(nextPath)
				// kilocode_change: bind-or-reuse then re-parent so the rail never loses
				// this conversation when switching to the merge target workspace.
				await manager?.syncSessionWorkspace(task.taskId, nextPath)
				await provider.postMessageToWebview({ type: "parallelWorkspaceChanged", text: nextPath })
			}

			const result = await service.merge({
				name: source.name,
				removeAfter: params.delete_after === true,
				allowOwner: task.taskId,
			})
			if (result.ok && params.delete_after === true && manager) {
				await manager.moveConversationsToWorkspace(source.path, folderPath)
			}
			await manager?.broadcast()

			const switched = nextPath ? `\nThis conversation is now in ${nextPath}.` : ""
			if (result.ok) {
				pushToolResult(`Merge succeeded for workspace "${source.name}": ${result.reason ?? ""}${switched}`)
			} else {
				const conflicts = result.conflicts?.length
					? `\nConflicted files:\n${result.conflicts.map((f) => `- ${f}`).join("\n")}`
					: ""
				pushToolResult(formatResponse.toolError(`${result.reason ?? "Merge failed."}${conflicts}${switched}`))
			}
		} catch (error) {
			await handleError("merging parallel workspace", error)
		}
	}
}

// Singletons

export const dispatchSubagentsTool = new DispatchSubagentsTool()
export const workspaceStatusTool = new WorkspaceStatusTool()
export const workspaceCreateTool = new WorkspaceCreateTool()
export const workspaceMergeTool = new WorkspaceMergeTool()
