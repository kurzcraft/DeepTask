// kilocode_change - new file: agent-managed modes (create / copy-with-suffix / update / list / switch)
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getAllModes, getModeBySlug, defaultModeSlug } from "../../shared/modes"
import type { ModeConfig, GroupEntry } from "@roo-code/types"
import { toolGroups } from "@roo-code/types"
import os from "os"
import path from "path"
import fs from "fs/promises"

interface ManageModeParams {
	action: "list" | "create" | "copy" | "update" | "switch"
	slug?: string
	name?: string
	role_definition?: string
	when_to_use?: string
	description?: string
	custom_instructions?: string
	groups?: string
	icon_name?: string
	copy_from?: string
	switch_after?: string
	reason?: string
}

const VALID_GROUPS = toolGroups as readonly string[]

/**
 * Append a machine-local lineage record for an evolve fork to
 * ~/.deeptask/MACHINE_LINEAGE.md (top level of the unified config dir).
 * This is a per-machine copy ledger (when/where/from-what-why) and is
 * intentionally distinct from the improvement log
 * (~/.deeptask/PROMPT_EVOLUTION_LOG.md) which stores principles/lessons.
 */
async function recordEvolveLineage(entry: {
	forkSlug: string
	forkName: string
	sourceSlug: string
	reason: string
}): Promise<void> {
	try {
		const configDir = path.join(os.homedir(), ".deeptask")
		await fs.mkdir(configDir, { recursive: true })
		const lineageFile = path.join(configDir, "MACHINE_LINEAGE.md")
		const stamp = new Date().toISOString()
		const purpose = entry.reason || "(no reason provided)"
		const line =
			`- ${stamp} | forked \`${entry.forkSlug}\` (${entry.forkName}) from \`${entry.sourceSlug}\` | purpose: ${purpose}\n`
		await fs.appendFile(lineageFile, line, "utf8")
	} catch {
		// Lineage is best-effort; never fail the fork because of logging.
	}
}

/**
 * Treat absent, empty, or literal "null"/"undefined" strings as not provided.
 * Some hosts serialize omitted optional params as the literal string "null",
 * which must never overwrite existing mode fields.
 */
function cleanParam(value: string | undefined | null): string | undefined {
	if (value === null || value === undefined) {
		return undefined
	}
	const trimmed = String(value).trim()
	if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "undefined") {
		return undefined
	}
	return trimmed
}

/** Normalize raw params once so every branch sees only real values. */
function normalizeParams(params: ManageModeParams): ManageModeParams {
	return {
		action: params.action || "",
		slug: cleanParam(params.slug),
		name: cleanParam(params.name),
		role_definition: cleanParam(params.role_definition),
		when_to_use: cleanParam(params.when_to_use),
		description: cleanParam(params.description),
		custom_instructions: cleanParam(params.custom_instructions),
		groups: cleanParam(params.groups),
		icon_name: cleanParam(params.icon_name),
		copy_from: cleanParam(params.copy_from),
		switch_after: cleanParam(params.switch_after),
		reason: cleanParam(params.reason) ?? "",
	}
}

/** Parse `groups` JSON string: either ["read","edit"] or [["edit",{"fileRegex":"\\.md$"}]]. */
function parseGroups(raw: string | undefined): GroupEntry[] | undefined {
	if (!raw?.trim()) {
		return undefined
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return undefined
	}
	if (!Array.isArray(parsed)) {
		return undefined
	}
	const seen = new Set<string>()
	const result: GroupEntry[] = []
	for (const entry of parsed) {
		if (typeof entry === "string") {
			if (!VALID_GROUPS.includes(entry)) {
				return undefined
			}
			if (seen.has(entry)) {
				return undefined
			}
			seen.add(entry)
			result.push(entry as GroupEntry)
		} else if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string") {
			const groupName = entry[0]
			if (!VALID_GROUPS.includes(groupName)) {
				return undefined
			}
			if (seen.has(groupName)) {
				return undefined
			}
			seen.add(groupName)
			const opts = entry[1]
			if (opts === null || typeof opts !== "object" || Array.isArray(opts)) {
				return undefined
			}
			const fileRegex = typeof (opts as any).fileRegex === "string" ? (opts as any).fileRegex : undefined
			const desc = typeof (opts as any).description === "string" ? (opts as any).description : undefined
			if (fileRegex) {
				try {
					new RegExp(fileRegex)
				} catch {
					return undefined
				}
			}
			result.push([groupName, { fileRegex, description: desc }] as GroupEntry)
		} else {
			return undefined
		}
	}
	return result
}

/** Sanitize slug to the schema regex ^[a-zA-Z0-9-]+$. */
function sanitizeSlug(raw: string): string {
	return raw
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
}

/**
 * Find the next free copy slug: base-1, base-2, ... (case-insensitive collision check).
 */
function nextCopySlug(baseSlug: string, existingSlugs: Set<string>): string {
	let n = 1
	let candidate = `${baseSlug}-${n}`
	const taken = (s: string) => existingSlugs.has(s) || [...existingSlugs].some((x) => x.toLowerCase() === s.toLowerCase())
	while (taken(candidate)) {
		n++
		candidate = `${baseSlug}-${n}`
	}
	return candidate
}

export class ManageModeTool extends BaseTool<"manage_mode"> {
	readonly name = "manage_mode" as const

	parseLegacy(params: Partial<Record<string, string>>): ManageModeParams {
		return {
			action: (params.action as ManageModeParams["action"]) || "",
			slug: params.slug || undefined,
			name: params.name || undefined,
			role_definition: params.role_definition || undefined,
			when_to_use: params.when_to_use || undefined,
			description: params.description || undefined,
			custom_instructions: params.custom_instructions || undefined,
			groups: params.groups || undefined,
			icon_name: params.icon_name || undefined,
			copy_from: params.copy_from || undefined,
			switch_after: params.switch_after || undefined,
			reason: params.reason || "",
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"manage_mode">): Promise<void> {
		const p = block.params
		const partialMessage = JSON.stringify({
			tool: "manageMode",
			action: this.removeClosingTag("action", p.action, block.partial),
			slug: this.removeClosingTag("slug", p.slug, block.partial),
			name: this.removeClosingTag("name", p.name, block.partial),
			reason: this.removeClosingTag("reason", p.reason, block.partial),
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}

	private async approve(callbacks: ToolCallbacks, payload: Record<string, unknown>): Promise<boolean> {
		return callbacks.askApproval("tool", JSON.stringify({ tool: "manageMode", ...payload }))
	}

	async execute(rawParams: ManageModeParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const provider = task.providerRef.deref()

		try {
			if (!provider) {
				throw new Error("Provider reference is unavailable")
			}

			// kilocode_change: hosts may serialize omitted optional params as the
			// literal string "null"; normalize once so no branch can store them.
			const params = normalizeParams(rawParams)

			if (!params.action) {
				task.consecutiveMistakeCount++
				task.recordToolError("manage_mode")
				pushToolResult(await task.sayAndCreateMissingParamError("manage_mode", "action"))
				return
			}

			const manager = provider.customModesManager
			const state = await provider.getState()
			const customModes = (await manager.getCustomModes()) as ModeConfig[]
			const allModes = getAllModes(customModes)

			switch (params.action) {
				case "list": {
					const lines = allModes.map((m) => ({
						slug: m.slug,
						name: m.name,
						source: customModes.some((c) => c.slug === m.slug) ? (m.source ?? "global") : "builtin",
						description: m.description ?? "",
						whenToUse: m.whenToUse ?? "",
						groups: m.groups,
						iconName: m.iconName,
					}))
					const current = state.mode ?? defaultModeSlug
					pushToolResult(
						`Modes (${lines.length}, current: ${current}):\n${JSON.stringify(lines, null, 2)}\n` +
							`Use action "create" for a brand-new mode, "copy" to duplicate an existing mode (auto -1/-2 suffix) with edits, "update" to modify an existing custom mode by value (creates a -N copy when it targets a built-in), or "switch" to activate a mode.`,
					)
					task.consecutiveMistakeCount = 0
					return
				}

				case "create":
				case "copy": {
					const isCopy = params.action === "copy"
					let slugRaw = params.slug?.trim() || ""
					let name = params.name?.trim() || ""
					let roleDefinition = params.role_definition?.trim() || ""
					let whenToUse = params.when_to_use?.trim() ?? undefined
					let description = params.description?.trim() ?? undefined
					let customInstructions = params.custom_instructions?.trim() ?? undefined
					let iconName = params.icon_name?.trim() ?? undefined
					let groups = parseGroups(params.groups)

					if (isCopy) {
						const sourceSlug = params.copy_from?.trim() || slugRaw
						const source = getModeBySlug(sourceSlug, customModes)
						if (!source) {
							task.consecutiveMistakeCount++
							task.recordToolError("manage_mode")
							pushToolResult(
								formatResponse.toolError(
									`copy_from mode "${sourceSlug}" not found. Use action "list" to see available modes.`,
								),
							)
							return
						}
						// Copy semantics: everything defaults from the source, explicit params override.
						roleDefinition = roleDefinition || source.roleDefinition
						// kilocode_change: default copy name is the source name with any old
						// -N suffix stripped; the new slug's suffix is appended below so the
						// displayed label always matches the new slug number (evolve-1 copied
						// to evolve-2 must display "Evolve-2", never stay "Evolve-1").
						name = name || source.name.replace(/-\d+$/, "")
						whenToUse = params.when_to_use?.trim() ? params.when_to_use.trim() : source.whenToUse
						description = params.description?.trim() ? params.description.trim() : source.description
						customInstructions = params.custom_instructions?.trim()
							? params.custom_instructions.trim()
							: source.customInstructions
						iconName = params.icon_name?.trim() ? params.icon_name.trim() : source.iconName
						groups = groups ?? source.groups
						slugRaw = slugRaw || source.slug
					}

					if (!roleDefinition) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_mode")
						pushToolResult(
							await task.sayAndCreateMissingParamError(
								"manage_mode",
								isCopy ? "copy_from" : "role_definition",
							),
						)
						return
					}

					if (!slugRaw && isCopy) {
						slugRaw = params.copy_from?.trim() || ""
					}

					// Resolve final slug (always unique; copies get -1/-2 suffix automatically).
					let finalSlug: string
					if (isCopy) {
						const base = sanitizeSlug(slugRaw || params.copy_from || "mode")
						const existing = new Set([...customModes.map((m) => m.slug), ...allModes.map((m) => m.slug)])
						finalSlug = nextCopySlug(base, existing)
						// Default name suffix mirrors the slug suffix unless the user provided a name.
						if (!params.name?.trim() && name && !name.match(/-\d+$/)) {
							name = `${name}-${finalSlug.split("-").pop()}`
						}
					} else {
						if (!slugRaw) {
							task.consecutiveMistakeCount++
							task.recordToolError("manage_mode")
							pushToolResult(await task.sayAndCreateMissingParamError("manage_mode", "slug"))
							return
						}
						finalSlug = sanitizeSlug(slugRaw)
						if (getModeBySlug(finalSlug, customModes)) {
							task.consecutiveMistakeCount++
							task.recordToolError("manage_mode")
							pushToolResult(
								formatResponse.toolError(
									`Mode "${finalSlug}" already exists. Use action "copy" (adds -1/-2 suffix) or "update" instead.`,
								),
							)
							return
						}
					}

					if (!finalSlug) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_mode")
						pushToolResult(formatResponse.toolError("Could not derive a valid mode slug."))
						return
					}

					name = name || finalSlug
					const finalGroups: GroupEntry[] = groups ?? ["read", "edit", "browser", "command", "mcp", "modes"]

					const modeConfig: ModeConfig = {
						slug: finalSlug,
						name,
						roleDefinition,
						whenToUse,
						description,
						customInstructions,
						groups: finalGroups,
						source: "global",
						iconName,
					}

					const shouldSwitch = params.switch_after !== "false"

					if (
						!(await this.approve(callbacks, {
							action: params.action,
							slug: finalSlug,
							name,
							...(isCopy ? { copyFrom: params.copy_from } : {}),
							switchAfter: shouldSwitch,
							reason: params.reason,
						}))
					) {
						return
					}

					await manager.updateCustomMode(finalSlug, modeConfig)
					const updatedModes = await manager.getCustomModes()
					await provider.contextProxy.setValue("customModes", updatedModes)

					let switchNote = ""
					if (shouldSwitch) {
						await provider.handleModeSwitch(finalSlug)
						await provider.postStateToWebview()
						switchNote = `\nSwitched to the new mode "${name}" (${finalSlug}) immediately.`
					} else {
						await provider.postStateToWebview()
						switchNote = `\nUse switch_mode (or manage_mode action "switch") to activate "${finalSlug}".`
					}

					task.consecutiveMistakeCount = 0
					pushToolResult(
						`${isCopy ? "Copied" : "Created"} mode "${name}" (slug: ${finalSlug}).` +
							`\nroleDefinition: ${roleDefinition.slice(0, 200)}${roleDefinition.length > 200 ? "…" : ""}` +
							`\ngroups: ${JSON.stringify(finalGroups)}` +
							`${description ? `\ndescription: ${description.slice(0, 200)}` : ""}` +
							`${whenToUse ? `\nwhenToUse: ${whenToUse.slice(0, 200)}` : ""}` +
							switchNote,
					)
					return
				}

				case "update": {
					const targetSlug = params.slug?.trim() || ""
					if (!targetSlug) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_mode")
						pushToolResult(await task.sayAndCreateMissingParamError("manage_mode", "slug"))
						return
					}
					const existing = getModeBySlug(targetSlug, customModes)
					if (!existing) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_mode")
						pushToolResult(
							formatResponse.toolError(
								`Mode "${targetSlug}" not found. Use action "list" to see available modes.`,
							),
						)
						return
					}

					const groups = parseGroups(params.groups)
					const merged: ModeConfig = {
						slug: existing.slug,
						name: params.name?.trim() || existing.name,
						roleDefinition: params.role_definition?.trim() || existing.roleDefinition,
						whenToUse: params.when_to_use?.trim() ?? existing.whenToUse,
						description: params.description?.trim() ?? existing.description,
						customInstructions: params.custom_instructions?.trim() ?? existing.customInstructions,
						groups: groups ?? existing.groups,
						source: existing.source || "global",
						iconName: params.icon_name?.trim() ?? existing.iconName,
					}

				const isCustom = customModes.some((c) => c.slug === targetSlug)
				const shouldSwitch = params.switch_after !== "false"

				// kilocode_change start: evolve-series fork-on-update semantics.
				// The built-in evolve mode is an immutable prototype. Updating
				// evolve (or any evolve-N copy) never mutates in place: it forks
				// the next free evolve-N+1 copy that inherits the same prototype
				// system prompt plus the accumulated personalizations.
				const isEvolveSeries = /^evolve(-\d+)?$/.test(targetSlug)
				if (isEvolveSeries) {
					const existingSlugs = new Set([...customModes.map((m) => m.slug), ...allModes.map((m) => m.slug)])
					const forkSlug = nextCopySlug("evolve", existingSlugs)
					const forkNumber = forkSlug.split("-").pop()
					const forked: ModeConfig = {
						...merged,
						slug: forkSlug,
						name: params.name?.trim() || `Evolve-${forkNumber}`,
						source: "global",
					}

					if (
						!(await this.approve(callbacks, {
							action: "update-as-copy",
							slug: forkSlug,
							name: forked.name,
							switchAfter: shouldSwitch,
							reason: params.reason,
						}))
					) {
						return
					}

					await manager.updateCustomMode(forkSlug, forked)
					const updatedModesFork = await manager.getCustomModes()
					await provider.contextProxy.setValue("customModes", updatedModesFork)
					await recordEvolveLineage({
						forkSlug,
						forkName: forked.name,
						sourceSlug: targetSlug,
						reason: params.reason ?? "",
					})

					let forkSwitchNote = ""
					if (shouldSwitch) {
						await provider.handleModeSwitch(forkSlug)
						await provider.postStateToWebview()
						forkSwitchNote = `\nSwitched to the evolved copy "${forked.name}" (${forkSlug}) immediately.`
					} else {
						await provider.postStateToWebview()
					}

					task.consecutiveMistakeCount = 0
					pushToolResult(
						`Evolved mode: forked "${targetSlug}" into a new copy "${forked.name}" (${forkSlug}).` +
							`\nThe copy starts from the built-in Evolve prototype system prompt and carries the personalizations from this update.` +
							`\ngroups: ${JSON.stringify(forked.groups)}` +
							forkSwitchNote,
					)
					return
				}
				// kilocode_change end
if (
						!(await this.approve(callbacks, {
							action: isCustom ? "update" : "update-as-copy",
							slug: merged.slug,
							name: merged.name,
							switchAfter: shouldSwitch,
							reason: params.reason,
						}))
					) {
						return
					}

					if (isCustom) {
						await manager.updateCustomMode(merged.slug, merged)
					} else {
						// Built-in modes are immutable: persist the edit as a new custom mode
						// that overrides the built-in with the same slug (getAllModes merge).
						await manager.updateCustomMode(merged.slug, merged)
					}
					const updatedModes = await manager.getCustomModes()
					await provider.contextProxy.setValue("customModes", updatedModes)

					let switchNote = ""
					if (shouldSwitch) {
						await provider.handleModeSwitch(merged.slug)
						await provider.postStateToWebview()
						switchNote = `\nSwitched to "${merged.name}" (${merged.slug}) immediately.`
					} else {
						await provider.postStateToWebview()
					}

					task.consecutiveMistakeCount = 0
					pushToolResult(
						`Updated mode "${merged.name}" (${merged.slug}).` +
							`\ngroups: ${JSON.stringify(merged.groups)}` +
							switchNote,
					)
					return
				}

				case "switch": {
					const target = params.slug?.trim() || ""
					if (!target) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_mode")
						pushToolResult(await task.sayAndCreateMissingParamError("manage_mode", "slug"))
						return
					}
					const targetMode = getModeBySlug(target, customModes)
					if (!targetMode) {
						task.consecutiveMistakeCount++
						task.recordToolError("manage_mode")
						pushToolResult(formatResponse.toolError(`Invalid mode: ${target}`))
						return
					}
					const currentMode = state.mode ?? defaultModeSlug
					if (currentMode === target) {
						pushToolResult(`Already in ${targetMode.name} mode.`)
						return
					}
					if (
						!(await this.approve(callbacks, {
							action: "switch",
							slug: target,
							reason: params.reason,
						}))
					) {
						return
					}
					await provider.handleModeSwitch(target)
					pushToolResult(
						`Successfully switched from ${currentMode} to ${targetMode.name} (${target})${
							params.reason ? ` because: ${params.reason}` : ""
						}.`,
					)
					task.consecutiveMistakeCount = 0
					return
				}

				default:
					task.consecutiveMistakeCount++
					task.recordToolError("manage_mode")
					pushToolResult(
						formatResponse.toolError(
							`Unknown action "${params.action}". Allowed: list, create, copy, update, switch.`,
						),
					)
					return
			}
		} catch (error) {
			await handleError("managing mode", error as Error)
		}
	}
}

export const manageModeTool = new ManageModeTool()
