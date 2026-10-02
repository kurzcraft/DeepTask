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
import { getModeBySlug } from "../../shared/modes"
import { MAX_PARALLEL_SUBAGENTS, type SubagentSpec } from "../kilocode/parallel/ParallelManager"
import type { ClineProvider } from "../webview/ClineProvider"
// kilocode_change: provider-correct model keys for subagent model overrides
import { modelIdKeys, modelIdKeysByProvider, isTypicalProvider } from "@roo-code/types"
// kilocode_change: path guard for workspace switches (defect K - literal "null"
// switch targets once strayed the conversation into /home/kurz/null and
// registered a bogus "null" folder in parallelFolders)
import * as path from "path"
import * as fs from "fs"

// kilocode_change start: sanitize switch_to values that arrive as stringified
// JSON null/undefined (host bridges stringify missing optional params) or as
// non-absolute junk. Valid targets: "main", a registered workspace name, or an
// absolute path that actually exists on disk.
const INVALID_SWITCH_TOKENS = new Set(["null", "undefined", "(null)", "", "."])

export function sanitizeSwitchTarget(raw: string | undefined): string {
	const trimmed = (raw ?? "").trim()
	if (INVALID_SWITCH_TOKENS.has(trimmed.toLowerCase())) {
		return ""
	}
	if (trimmed === "main" || path.isAbsolute(trimmed)) {
		return trimmed
	}
	return trimmed // registered workspace names are relative; validated by caller
}
// kilocode_change end

// ---------------------------------------------------------------- dispatch_subagents

export interface SubagentTaskSpec {
	task: string
	label?: string
	mode?: string
	provider_profile?: string
	model_id?: string
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

			// kilocode_change: subagent nesting is intentionally unbounded — a
			// subagent may dispatch its own subagents at any depth. The old
			// depth gate (depth >= MAX_SUBAGENT_DEPTH) was removed by design.

			const provider = task.providerRef.deref()
			if (!provider?.parallelManager) {
				pushToolResult(formatResponse.toolError("Parallel manager unavailable."))
				return
			}
			const manager = provider.parallelManager

			// kilocode_change start: resolve per-subagent mode / provider-profile
			// overrides. Unspecified fields inherit the parent task's values.
			const customModes = (await provider.customModesManager?.getCustomModes?.()) ?? []
			const resolveSubagentOverrides = async (
				spec: SubagentTaskSpec,
			): Promise<{
				error?: string
				mode?: string
				apiConfiguration?: Record<string, unknown>
				providerProfileName?: string
			}> => {
				let mode: string | undefined
				if (spec.mode) {
					const targetMode = getModeBySlug(spec.mode, customModes)
					if (!targetMode) {
						return { error: `Invalid mode: ${spec.mode}` }
					}
					mode = targetMode.slug
				}
				let apiConfiguration: Record<string, unknown> | undefined
				if (spec.provider_profile) {
					try {
						const profiles = await provider.providerSettingsManager.listConfig()
						const profile = profiles.find((p) => p.name === spec.provider_profile)
						if (!profile) {
							return { error: `Provider profile not found: ${spec.provider_profile}` }
						}
						const full = await provider.providerSettingsManager.getProfile({ name: profile.name })
						const { name: _n, id: _i, ...stored } = full as Record<string, unknown>
						apiConfiguration = { ...stored }
						// kilocode_change start: the handler reads provider-specific
						// model keys (openAiModelId etc.), NOT a generic apiModelId —
						// writing the generic key made model overrides silently
						// ineffective. Resolve the right key the same way
						// ClineProvider.restoreFocusedTaskProviderProfile does.
						if (spec.model_id) {
							const storedApiProvider = stored.apiProvider as string | undefined
							const modelKey =
								modelIdKeys.find((key) => key in stored) ??
								(isTypicalProvider(storedApiProvider)
									? modelIdKeysByProvider[storedApiProvider]
									: storedApiProvider === "openai" || storedApiProvider === "openai-responses"
										? "openAiModelId"
										: undefined)
							if (modelKey) {
								apiConfiguration[modelKey] = spec.model_id
							}
						}
						// kilocode_change end
					} catch (error) {
						return {
							error: `Failed to load provider profile "${spec.provider_profile}": ${
								error instanceof Error ? error.message : String(error)
							}`,
						}
					}
					} else if (spec.model_id) {
					// Model-only override: inherit the parent's config but swap the model.
					apiConfiguration = { ...(task.apiConfiguration as unknown as Record<string, unknown>) }
					// kilocode_change: resolve the provider-correct model key, not a
					// generic apiModelId (silently ignored by the handler).
					const parentProvider = apiConfiguration.apiProvider as string | undefined
					const modelKey =
						modelIdKeys.find((key) => key in apiConfiguration!) ??
						(isTypicalProvider(parentProvider)
							? modelIdKeysByProvider[parentProvider]
							: parentProvider === "openai" || parentProvider === "openai-responses"
								? "openAiModelId"
								: undefined)
					if (modelKey) {
						apiConfiguration[modelKey] = spec.model_id
					} else {
						apiConfiguration.apiModelId = spec.model_id
					}
				}
				return { mode, apiConfiguration, providerProfileName: spec.provider_profile }
			}
			// kilocode_change end

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
						`${i + 1}. ${s.label ?? s.task.slice(0, 60)}${s.needs_workspace !== false ? " [own workspace]" : " [shared/read-only]"}`,
				)
				.join("\n")
			// kilocode_change start: structured tasks array so the webview renders one
			// numbered prompt mini-window per subagent (new_task-style ask card).
			const dispatchPayload = JSON.stringify({
				tool: "dispatchSubagents",
				count: specs.length,
				content: summary,
				tasks: specs.map((s, i) => ({
					index: i + 1,
					label: s.label ?? s.task.slice(0, 60),
					mode: s.mode,
					provider_profile: s.provider_profile,
					model_id: s.model_id,
					needs_workspace: s.needs_workspace !== false,
					workspace: s.workspace,
					task: s.task,
				})),
			})
			// kilocode_change end
			const didApprove = await askApproval("tool", dispatchPayload)
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
					// kilocode_change: resolve mode / provider-profile overrides first.
					const overrides = await resolveSubagentOverrides(spec)
					if (overrides.error) {
						failures.push(`${label}: ${overrides.error}`)
						continue
					}
				const modeOverride = overrides.mode
				const apiConfigOverride = overrides.apiConfiguration
				// kilocode_change: forward the resolved profile name so spawn can
				// seed the child's sticky identity (banner + persistence).
				const providerProfileName = overrides.providerProfileName
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
							mode: modeOverride,
							apiConfiguration: apiConfigOverride,
							providerProfileName,
						},
						workspaceName: claimed.name,
					})
					} else if (spec.needs_workspace !== false && workspaceService) {
						// kilocode_change: needs_workspace now DEFAULTS TO TRUE — a
						// dispatched subagent gets its own isolated git workspace
						// unless the model explicitly marks the task read-only with
						// needs_workspace:false. Pure-read parallel tasks opt out.
						if ((await provider.getState())?.agentWorkspaceManagementEnabled === false) {
							failures.push(`${label}: workspace management is disabled; set needs_workspace:false for read-only work.`)
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
							mode: modeOverride,
							apiConfiguration: apiConfigOverride,
							providerProfileName,
						},
						workspaceName: created.name,
					})
				} else {
					// kilocode_change: needs_workspace:false — read-only subagent
					// shares the parent workspace and must be flagged so it never
					// occupies it (occupancy ejection would otherwise kick the
					// PARENT out of its own workspace).
					prepared.push({
						spec: {
							label,
							task: spec.task,
							mode: modeOverride,
							apiConfiguration: apiConfigOverride,
							providerProfileName,
							sharedWorkspace: true,
						},
					})
				}
				} catch (error) {
					failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
				}
			}

			// Spawn every prepared subagent in parallel.
			const spawned = prepared.map((p) => manager.spawn(task, p.spec))

			// kilocode_change start: new_task-style auto-jump — dispatch jumps to
			// the first subagent, each completion jumps to the next running one,
			// and the final completion jumps back to the parent task. Per-agent
			// results stream back to the parent chat as subtask_result messages
			// (rendered as one mini-window per subagent).
			const jumpToSession = async (sessionId: string) => {
				try {
					const conversation = manager.conversationForSession(sessionId)
					if (!conversation) {
						return
					}
					await manager.setActiveConversation(conversation.id)
					await provider.focusTask(sessionId)
				} catch {
					// Focusing is best-effort; never fail dispatch because of it.
				}
			}
			if (spawned[0]) {
				// Give the child conversation a tick to register in the rail.
				await new Promise((resolve) => setTimeout(resolve, 150))
				await jumpToSession(spawned[0].sessionId)
			}

			// Track per-subagent completion to auto-advance the focused view.
			const settledCount = { done: 0 }
			const completionWatchers = spawned.map((s) =>
				s.done.finally(() => {
					settledCount.done += 1
					if (settledCount.done < spawned.length) {
						// Jump to the next still-running subagent.
						const nextRunning = spawned.find((candidate) => {
							const info = manager.getSession(candidate.sessionId)?.info
							return info?.status === "running"
						})
						if (nextRunning) {
							void jumpToSession(nextRunning.sessionId)
						}
					} else {
						// All finished: jump back to the parent task.
						void (async () => {
							try {
								const parentConversation = manager.conversationForSession(task.taskId)
								if (parentConversation) {
									await manager.setActiveConversation(parentConversation.id)
								}
								await provider.focusTask(task.taskId)
							} catch {
								// best-effort
							}
						})()
					}
				}),
			)
			// kilocode_change end

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
			void completionWatchers

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
				// kilocode_change: 4000 chars cut off real subagent reports; raise to
				// 20000 per subagent — full result flows back to the parent model.
				const result = info.result ? `\nResult:\n${truncate(info.result, 20000)}` : "\nResult: (none)"
				lines.push(`## ${info.label} — ${outcome}${ws}${result}`)
				// kilocode_change start: per-subagent result mini-window in the
				// parent chat (new_task-style completion card per subagent).
				await task
					.say(
						"subtask_result",
						JSON.stringify({
							tool: "dispatchSubagents",
							phase: "result",
							index: spawned.indexOf(s) + 1,
							label: info.label,
							status: outcome,
							workspace: info.workspaceName,
							content: info.result ? truncate(info.result, 8000) : undefined,
						}),
					)
					.catch(() => undefined)
				// kilocode_change end
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
			// kilocode_change: defect K - refuse to create workspaces under a
			// literal "null"/"undefined" or non-absolute root; that would register
			// a junk folder and strand the conversation outside the repo.
			if (!path.isAbsolute(folderPath) || ["null", "undefined"].includes(folderPath)) {
				pushToolResult(
					formatResponse.toolError(
						`Refusing to create a workspace: current folder "${folderPath}" is not a valid absolute repository path. Switch back with workspace_merge (switch_to:"main") or restart the conversation in the project folder.`,
					),
				)
				return
			}
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
			const source = (await service.findByNameOrPath(params.name)) ?? (await service.findByNameOrPath(task.cwd))
			if (!source) {
				pushToolResult(formatResponse.toolError(`Unknown workspace "${params.name}".`))
				return
			}

			// kilocode_change start: defect K - sanitize switch_to. Host bridges may
			// stringify JSON null into "null"; non-absolute junk must never become a
			// conversation cwd. Valid: "main", a registered workspace name, or an
			// absolute path that exists on disk. Everything else is ignored with an
			// explicit notice instead of silently straying the conversation.
			const rawSwitch = params.switch_to
			const switchTarget = sanitizeSwitchTarget(rawSwitch)
			if (rawSwitch && !switchTarget) {
				pushToolResult(
					formatResponse.toolError(
						`Ignoring invalid switch_to value "${rawSwitch}" (literal null/undefined or empty). Use "main", a registered workspace name, or an existing absolute path. The merge proceeds without switching.`,
					),
				)
				return
			}
			const wantsSwitch = switchTarget.length > 0
			let nextPath: string | undefined = undefined
			if (wantsSwitch) {
				if (switchTarget === "main" || switchTarget === folderPath) {
					nextPath = folderPath
				} else {
					const registered = await service.findByNameOrPath(switchTarget)
					if (registered) {
						nextPath = registered.path
					} else if (path.isAbsolute(switchTarget) && fs.existsSync(switchTarget)) {
						nextPath = switchTarget
					} else {
						pushToolResult(
							formatResponse.toolError(
								`switch_to target "${switchTarget}" is neither "main", a registered workspace, nor an existing absolute directory. Refusing to switch; the merge is aborted without moving this conversation.`,
							),
						)
						return
					}
				}
			}
			// kilocode_change end

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
