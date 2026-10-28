/**
 * Durable subagent result inbox (kilocode_change - new file).
 *
 * Child settlement used to live only in ParallelManager session memory
 * (`state.info.result`) and was dropped when `finally` cleared `messages`.
 * `dispatch_subagents` only called `pushToolResult` after `allSettled`, so a
 * parent interrupt discarded completed child work. Each settled child is now
 * written to the parent task directory first; resume redelivers truly
 * undelivered entries without respawning completed or cancelled work.
 */

import * as path from "path"
import { safeWriteJson } from "../../../utils/safeWriteJson"
import { getTaskDirectoryPath } from "../../../utils/storage"
import { fileExistsAtPath } from "../../../utils/fs"
import { promises as fs } from "fs"

export const SUBAGENT_INBOX_DIRNAME = "subagent-result-inbox"
export const SUBAGENT_INBOX_MARKER_PREFIX = "[subagent-inbox:"
export const SUBAGENT_INBOX_VERSION = 1 as const

export type SubagentInboxStatus = "completed" | "cancelled" | "error"
export type SubagentInboxDeliveryState = "pending" | "delivered"

export interface SubagentInboxDeliveryEvidence {
	kind: "api_history"
	/** Native tool_use id when the parent call was native-protocol. */
	toolUseId?: string
	parentInstanceId?: string
	persistedAt: number
	/** Verifiable snippet proving the marker is in the saved API history. */
	confirmation: string
}

export interface SubagentInboxEntry {
	version: typeof SUBAGENT_INBOX_VERSION
	parentTaskId: string
	parentInstanceId?: string
	childSessionId: string
	childTaskId: string
	label: string
	status: SubagentInboxStatus
	result?: string
	error?: string
	workspaceName?: string
	branch?: string
	toolCallId?: string
	createdAt: number
	updatedAt: number
	cancelled: boolean
	deliveryState: SubagentInboxDeliveryState
	deliveredAt?: number
	deliveryEvidence?: SubagentInboxDeliveryEvidence
	/** Persist failure from a previous attempt; never silent. */
	persistError?: string
}

export interface PersistSubagentInboxInput {
	globalStoragePath: string
	parentTaskId: string
	parentInstanceId?: string
	childSessionId: string
	childTaskId?: string
	label: string
	status: SubagentInboxStatus
	result?: string
	error?: string
	workspaceName?: string
	branch?: string
	toolCallId?: string
}

export class SubagentResultInboxError extends Error {
	readonly recoverable = true
	constructor(message: string, options?: { cause?: unknown }) {
		super(message)
		this.name = "SubagentResultInboxError"
		if (options?.cause !== undefined) {
			;(this as Error & { cause?: unknown }).cause = options.cause
		}
	}
}

export function inboxMarker(childSessionId: string): string {
	return `${SUBAGENT_INBOX_MARKER_PREFIX}${childSessionId}]`
}

export function sanitizeInboxId(id: string): string {
	return id.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180) || "unknown"
}

export function inboxDir(taskDir: string): string {
	return path.join(taskDir, SUBAGENT_INBOX_DIRNAME)
}

export function inboxEntryPath(taskDir: string, childSessionId: string): string {
	return path.join(inboxDir(taskDir), `${sanitizeInboxId(childSessionId)}.json`)
}

export async function resolveParentInboxDir(globalStoragePath: string, parentTaskId: string): Promise<string> {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, parentTaskId)
	return inboxDir(taskDir)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseInboxEntry(value: unknown): SubagentInboxEntry | undefined {
	if (!isRecord(value)) {
		return undefined
	}
	if (value.version !== SUBAGENT_INBOX_VERSION) {
		return undefined
	}
	if (typeof value.parentTaskId !== "string" || typeof value.childSessionId !== "string") {
		return undefined
	}
	if (typeof value.label !== "string") {
		return undefined
	}
	if (value.status !== "completed" && value.status !== "cancelled" && value.status !== "error") {
		return undefined
	}
	const deliveryState: SubagentInboxDeliveryState = value.deliveryState === "delivered" ? "delivered" : "pending"
	return {
		version: SUBAGENT_INBOX_VERSION,
		parentTaskId: value.parentTaskId,
		parentInstanceId: typeof value.parentInstanceId === "string" ? value.parentInstanceId : undefined,
		childSessionId: value.childSessionId,
		childTaskId: typeof value.childTaskId === "string" ? value.childTaskId : value.childSessionId,
		label: value.label,
		status: value.status,
		result: typeof value.result === "string" ? value.result : undefined,
		error: typeof value.error === "string" ? value.error : undefined,
		workspaceName: typeof value.workspaceName === "string" ? value.workspaceName : undefined,
		branch: typeof value.branch === "string" ? value.branch : undefined,
		toolCallId: typeof value.toolCallId === "string" ? value.toolCallId : undefined,
		createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
		updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
		cancelled: value.cancelled === true || value.status === "cancelled",
		deliveryState,
		deliveredAt: typeof value.deliveredAt === "number" ? value.deliveredAt : undefined,
		deliveryEvidence: isRecord(value.deliveryEvidence)
			? {
					kind: "api_history",
					toolUseId:
						typeof value.deliveryEvidence.toolUseId === "string"
							? value.deliveryEvidence.toolUseId
							: undefined,
					parentInstanceId:
						typeof value.deliveryEvidence.parentInstanceId === "string"
							? value.deliveryEvidence.parentInstanceId
							: undefined,
					persistedAt:
						typeof value.deliveryEvidence.persistedAt === "number"
							? value.deliveryEvidence.persistedAt
							: Date.now(),
					confirmation:
						typeof value.deliveryEvidence.confirmation === "string"
							? value.deliveryEvidence.confirmation
							: "",
				}
			: undefined,
		persistError: typeof value.persistError === "string" ? value.persistError : undefined,
	}
}

export async function readInboxEntryAt(filePath: string): Promise<SubagentInboxEntry | undefined> {
	try {
		const raw = await fs.readFile(filePath, "utf8")
		return parseInboxEntry(JSON.parse(raw))
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code === "ENOENT") {
			return undefined
		}
		console.error(`[subagentResultInbox] failed to read ${filePath}:`, error)
		throw new SubagentResultInboxError(
			`Failed to read subagent result inbox entry at ${filePath}: ${
				error instanceof Error ? error.message : String(error)
			}`,
			{ cause: error },
		)
	}
}

export async function writeInboxEntryAt(filePath: string, entry: SubagentInboxEntry): Promise<SubagentInboxEntry> {
	try {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		const existing = (await fileExistsAtPath(filePath)) ? await readInboxEntryAt(filePath) : undefined
		// Idempotent: a delivered entry is never regressed, and identical pending
		// writes keep the original createdAt.
		if (existing?.deliveryState === "delivered") {
			return existing
		}
		const next: SubagentInboxEntry = {
			...entry,
			createdAt: existing?.createdAt ?? entry.createdAt,
			updatedAt: Date.now(),
			deliveryState: existing?.deliveryState ?? entry.deliveryState,
			deliveredAt: existing?.deliveredAt,
			deliveryEvidence: existing?.deliveryEvidence,
		}
		await safeWriteJson(filePath, next, { snapshot: true })
		return next
	} catch (error) {
		if (error instanceof SubagentResultInboxError) {
			throw error
		}
		const message = `Failed to persist subagent result inbox entry at ${filePath}: ${
			error instanceof Error ? error.message : String(error)
		}`
		console.error("[subagentResultInbox] persist failed:", message, error)
		throw new SubagentResultInboxError(message, { cause: error })
	}
}

export async function persistSubagentResult(input: PersistSubagentInboxInput): Promise<SubagentInboxEntry> {
	if (!input.globalStoragePath) {
		const message = "Cannot persist subagent result inbox: globalStoragePath is missing"
		console.error("[subagentResultInbox]", message)
		throw new SubagentResultInboxError(message)
	}
	if (!input.parentTaskId || !input.childSessionId) {
		const message = "Cannot persist subagent result inbox: parentTaskId and childSessionId are required"
		console.error("[subagentResultInbox]", message)
		throw new SubagentResultInboxError(message)
	}
	const taskDir = await getTaskDirectoryPath(input.globalStoragePath, input.parentTaskId)
	const filePath = inboxEntryPath(taskDir, input.childSessionId)
	const now = Date.now()
	const entry: SubagentInboxEntry = {
		version: SUBAGENT_INBOX_VERSION,
		parentTaskId: input.parentTaskId,
		parentInstanceId: input.parentInstanceId,
		childSessionId: input.childSessionId,
		childTaskId: input.childTaskId ?? input.childSessionId,
		label: input.label,
		status: input.status,
		result: input.result,
		error: input.error,
		workspaceName: input.workspaceName,
		branch: input.branch,
		toolCallId: input.toolCallId,
		createdAt: now,
		updatedAt: now,
		cancelled: input.status === "cancelled",
		deliveryState: "pending",
	}
	return writeInboxEntryAt(filePath, entry)
}

export async function listInboxEntries(globalStoragePath: string, parentTaskId: string): Promise<SubagentInboxEntry[]> {
	if (!globalStoragePath || !parentTaskId) {
		return []
	}
	const taskDir = await getTaskDirectoryPath(globalStoragePath, parentTaskId)
	const dir = inboxDir(taskDir)
	let names: string[]
	try {
		names = await fs.readdir(dir)
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code === "ENOENT") {
			return []
		}
		console.error(`[subagentResultInbox] failed to list ${dir}:`, error)
		throw new SubagentResultInboxError(
			`Failed to list subagent result inbox at ${dir}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		)
	}
	const entries: SubagentInboxEntry[] = []
	for (const name of names) {
		if (!name.endsWith(".json")) {
			continue
		}
		try {
			const parsed = await readInboxEntryAt(path.join(dir, name))
			if (parsed && parsed.parentTaskId === parentTaskId) {
				entries.push(parsed)
			}
		} catch (error) {
			console.error(`[subagentResultInbox] skipping unreadable inbox file ${name}:`, error)
		}
	}
	return entries.sort((a, b) => a.createdAt - b.createdAt)
}

export function isUndelivered(entry: SubagentInboxEntry): boolean {
	return entry.deliveryState !== "delivered"
}

/**
 * Undelivered entries that may be redelivered on parent resume.
 * Cancelled work is included in the report but must never be respawned.
 */
export function undeliveredEntries(entries: SubagentInboxEntry[]): SubagentInboxEntry[] {
	return entries.filter(isUndelivered)
}

export function completedUndeliveredEntries(entries: SubagentInboxEntry[]): SubagentInboxEntry[] {
	return entries.filter((entry) => isUndelivered(entry) && entry.status === "completed")
}

export function entriesForToolCall(
	entries: SubagentInboxEntry[],
	toolCallId: string | undefined,
	childSessionIds?: string[],
): SubagentInboxEntry[] {
	const byChild =
		childSessionIds && childSessionIds.length > 0
			? entries.filter((entry) => childSessionIds.includes(entry.childSessionId))
			: entries
	if (!toolCallId) {
		return byChild
	}
	const matched = byChild.filter((entry) => entry.toolCallId === toolCallId)
	return matched.length > 0 ? matched : byChild.filter((entry) => !entry.toolCallId)
}

export function formatInboxEntriesForToolResult(entries: SubagentInboxEntry[]): string {
	if (entries.length === 0) {
		return ""
	}
	const lines = [`All ${entries.length} subagent(s) finished:`]
	for (const entry of entries) {
		const ws = entry.workspaceName ? ` [workspace: ${entry.workspaceName} (${entry.branch ?? "n/a"})]` : ""
		const outcome =
			entry.status === "completed"
				? "completed"
				: entry.status === "cancelled"
					? "cancelled"
					: `error: ${entry.error ?? "unknown"}`
		const result = entry.result ? `\nResult:\n${truncateInboxText(entry.result, 20000)}` : "\nResult: (none)"
		const persistNote = entry.persistError ? `\nInbox persist error (recoverable): ${entry.persistError}` : ""
		lines.push(`## ${entry.label} — ${outcome}${ws}${result}${persistNote}\n${inboxMarker(entry.childSessionId)}`)
	}
	return lines.join("\n\n")
}

export function historyContainsInboxMarker(historyText: string, childSessionId: string): boolean {
	return historyText.includes(inboxMarker(childSessionId))
}

export function flattenApiHistoryText(messages: Array<{ content?: unknown }>): string {
	const chunks: string[] = []
	for (const message of messages) {
		const content = message.content
		if (typeof content === "string") {
			chunks.push(content)
			continue
		}
		if (!Array.isArray(content)) {
			continue
		}
		for (const block of content) {
			if (!block || typeof block !== "object") {
				continue
			}
			const record = block as Record<string, unknown>
			if (typeof record.text === "string") {
				chunks.push(record.text)
			}
			if (typeof record.content === "string") {
				chunks.push(record.content)
			}
			if (Array.isArray(record.content)) {
				for (const inner of record.content) {
					if (inner && typeof inner === "object" && typeof (inner as { text?: unknown }).text === "string") {
						chunks.push((inner as { text: string }).text)
					}
				}
			}
		}
	}
	return chunks.join("\n")
}

export async function markInboxEntryDelivered(options: {
	globalStoragePath: string
	parentTaskId: string
	childSessionId: string
	evidence: SubagentInboxDeliveryEvidence
}): Promise<SubagentInboxEntry | undefined> {
	const taskDir = await getTaskDirectoryPath(options.globalStoragePath, options.parentTaskId)
	const filePath = inboxEntryPath(taskDir, options.childSessionId)
	const existing = await readInboxEntryAt(filePath)
	if (!existing) {
		return undefined
	}
	if (existing.deliveryState === "delivered") {
		return existing
	}
	if (
		!options.evidence.confirmation ||
		!historyContainsInboxMarker(options.evidence.confirmation, options.childSessionId)
	) {
		const message = `Refusing to mark subagent inbox delivered without API history confirmation for ${options.childSessionId}`
		console.error("[subagentResultInbox]", message)
		throw new SubagentResultInboxError(message)
	}
	const next: SubagentInboxEntry = {
		...existing,
		deliveryState: "delivered",
		deliveredAt: Date.now(),
		updatedAt: Date.now(),
		deliveryEvidence: options.evidence,
	}
	try {
		await safeWriteJson(filePath, next, { snapshot: true })
		return next
	} catch (error) {
		const message = `Failed to mark subagent inbox delivered for ${options.childSessionId}: ${
			error instanceof Error ? error.message : String(error)
		}`
		console.error("[subagentResultInbox]", message, error)
		throw new SubagentResultInboxError(message, { cause: error })
	}
}

export async function confirmInboxDeliveryFromMessages(options: {
	globalStoragePath: string
	parentTaskId: string
	parentInstanceId?: string
	messages: Array<{ content?: unknown }>
	toolUseId?: string
}): Promise<string[]> {
	const confirmed: string[] = []
	let entries: SubagentInboxEntry[]
	try {
		entries = undeliveredEntries(await listInboxEntries(options.globalStoragePath, options.parentTaskId))
	} catch (error) {
		console.error("[subagentResultInbox] failed to list inbox during delivery confirm:", error)
		throw error instanceof SubagentResultInboxError
			? error
			: new SubagentResultInboxError(
					`Failed to confirm subagent inbox delivery: ${
						error instanceof Error ? error.message : String(error)
					}`,
					{ cause: error },
				)
	}
	if (entries.length === 0) {
		return confirmed
	}
	const historyText = flattenApiHistoryText(options.messages)
	for (const entry of entries) {
		if (!historyContainsInboxMarker(historyText, entry.childSessionId)) {
			continue
		}
		await markInboxEntryDelivered({
			globalStoragePath: options.globalStoragePath,
			parentTaskId: options.parentTaskId,
			childSessionId: entry.childSessionId,
			evidence: {
				kind: "api_history",
				toolUseId: options.toolUseId ?? entry.toolCallId,
				parentInstanceId: options.parentInstanceId,
				persistedAt: Date.now(),
				confirmation: inboxMarker(entry.childSessionId),
			},
		})
		confirmed.push(entry.childSessionId)
	}
	return confirmed
}

export function truncateInboxText(text: string, max: number): string {
	if (text.length <= max) {
		return text
	}
	return `${text.slice(0, max)}\n…(truncated)`
}

export const INTERRUPTED_TOOL_RESULT_TEXT = "Task was interrupted before this tool call could be completed."

export interface AssistantToolUseRef {
	id: string
	name: string
}

export interface InboxResumeNativeResult {
	toolUseId: string
	content: string
	childSessionIds: string[]
}

export interface InboxResumeInjection {
	nativeResults: InboxResumeNativeResult[]
	userText?: string
	childSessionIds: string[]
}

export function extractAssistantToolUses(message: { content?: unknown } | undefined): AssistantToolUseRef[] {
	if (!message || !Array.isArray(message.content)) {
		return []
	}
	const uses: AssistantToolUseRef[] = []
	for (const block of message.content) {
		if (!block || typeof block !== "object") {
			continue
		}
		const record = block as Record<string, unknown>
		if (record.type !== "tool_use") {
			continue
		}
		if (typeof record.id !== "string" || typeof record.name !== "string") {
			continue
		}
		uses.push({ id: record.id, name: record.name })
	}
	return uses
}

export function toolResultText(block: { type?: string; content?: unknown } | undefined): string {
	if (!block || block.type !== "tool_result") {
		return ""
	}
	const content = block.content
	if (typeof content === "string") {
		return content
	}
	if (!Array.isArray(content)) {
		return ""
	}
	return content
		.map((item) => {
			if (typeof item === "string") {
				return item
			}
			if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
				return (item as { text: string }).text
			}
			return ""
		})
		.join("\n")
}

export function isInterruptedToolResultText(text: string | undefined): boolean {
	return typeof text === "string" && text.includes(INTERRUPTED_TOOL_RESULT_TEXT)
}

export function shouldRedeliverInboxEntry(entry: SubagentInboxEntry, historyText: string): boolean {
	if (entry.deliveryState === "delivered") {
		return false
	}
	return !historyContainsInboxMarker(historyText, entry.childSessionId)
}

/**
 * Plan idempotent resume redelivery. Never respawns work. Cancelled entries are
 * reported only. Native tool_result blocks are emitted only for an existing
 * unmatched `dispatch_subagents` tool_use — leftovers become user text so we
 * never create an orphan tool_result.
 */
export function buildInboxResumeInjection(options: {
	entries: SubagentInboxEntry[]
	historyText: string
	assistantToolUses?: AssistantToolUseRef[]
	existingToolResultIds?: string[]
	existingToolResultTextById?: Record<string, string>
}): InboxResumeInjection {
	const redeliver = options.entries.filter((entry) => shouldRedeliverInboxEntry(entry, options.historyText))
	if (redeliver.length === 0) {
		return { nativeResults: [], childSessionIds: [] }
	}
	const dispatchUses = (options.assistantToolUses ?? []).filter((use) => use.name === "dispatch_subagents")
	const existingIds = new Set(options.existingToolResultIds ?? [])
	const existingText = options.existingToolResultTextById ?? {}
	const assigned = new Set<string>()
	const nativeResults: InboxResumeNativeResult[] = []
	const unscoped = redeliver.filter((entry) => !entry.toolCallId)

	const takeGroup = (toolUseId: string): SubagentInboxEntry[] => {
		const matched = redeliver.filter(
			(entry) => entry.toolCallId === toolUseId && !assigned.has(entry.childSessionId),
		)
		if (matched.length > 0) {
			return matched
		}
		return unscoped.filter((entry) => !assigned.has(entry.childSessionId))
	}

	for (const toolUse of dispatchUses) {
		const existing = existingText[toolUse.id] ?? ""
		if (existing && !isInterruptedToolResultText(existing) && existingIds.has(toolUse.id)) {
			const alreadyHasMarkers = redeliver.some((entry) => existing.includes(inboxMarker(entry.childSessionId)))
			if (alreadyHasMarkers) {
				continue
			}
			continue
		}
		const group = takeGroup(toolUse.id)
		if (group.length === 0) {
			continue
		}
		for (const entry of group) {
			assigned.add(entry.childSessionId)
		}
		nativeResults.push({
			toolUseId: toolUse.id,
			content: formatInboxEntriesForToolResult(group),
			childSessionIds: group.map((entry) => entry.childSessionId),
		})
	}

	const leftover = redeliver.filter((entry) => !assigned.has(entry.childSessionId))
	const childSessionIds = [...assigned, ...leftover.map((entry) => entry.childSessionId)]
	const cancelledNote = redeliver.some((entry) => entry.cancelled || entry.status === "cancelled")
		? "\nCancelled work is reported only and will not be respawned."
		: ""
	const userText =
		leftover.length > 0
			? `[SUBAGENT INBOX REDELIVERY]\n${formatInboxEntriesForToolResult(leftover)}${cancelledNote}`
			: undefined
	return { nativeResults, userText, childSessionIds }
}
