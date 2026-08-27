import { safeWriteJson } from "../../utils/safeWriteJson"
import * as path from "path"
import * as fs from "fs/promises"

import { Anthropic } from "@anthropic-ai/sdk"

import { fileExistsAtPath } from "../../utils/fs"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { getTaskDirectoryPath } from "../../utils/storage"

export type ApiMessage = Anthropic.MessageParam & {
	ts?: number
	isSummary?: boolean
	id?: string
	// For reasoning items stored in API history
	type?: "reasoning"
	summary?: any[]
	encrypted_content?: string
	text?: string
	// For OpenRouter reasoning_details array format (used by Gemini 3, etc.)
	reasoning_details?: any[]
	// For DeepSeek/Z.ai interleaved thinking: reasoning_content that must be preserved during tool call sequences
	// See: https://api-docs.deepseek.com/guides/thinking_mode#tool-calls
	reasoning_content?: string
	// For non-destructive condense: unique identifier for summary messages
	condenseId?: string
	// For non-destructive condense: points to the condenseId of the summary that replaces this message
	// Messages with condenseParent are filtered out when sending to API if the summary exists
	condenseParent?: string
	// For non-destructive truncation: unique identifier for truncation marker messages
	truncationId?: string
	// For non-destructive truncation: points to the truncationId of the marker that hides this message
	// Messages with truncationParent are filtered out when sending to API if the marker exists
	truncationParent?: string
	// Identifies a message as a truncation boundary marker
	isTruncationMarker?: boolean
}

// kilocode_change start: torn-JSON self-healing
/**
 * Attempts to recover the longest valid prefix of a JSON array that was torn
 * by a concurrent write or crash. A forward scan (whose lexer state is correct
 * from byte 0 up to the tear) records every top-level element boundary — a
 * `,` at depth 1 outside any string. Candidates are then validated from the
 * last boundary backwards with JSON.parse; the first parseable prefix wins.
 * Attempts are capped so a large corrupted file cannot trigger quadratic work.
 * Returns undefined when no prefix can be recovered.
 */
const MAX_RECOVERY_ATTEMPTS = 64

export function recoverApiMessagesPrefix(fileContent: string): ApiMessage[] | undefined {
	const trimmed = fileContent.trim()
	if (!trimmed.startsWith("[")) {
		return undefined
	}
	// Collect top-level `,` boundaries with a forward scan. State before the
	// tear is always correct; boundaries recorded after the tear are garbage
	// but harmless because JSON.parse validation filters them out.
	const boundaries: number[] = []
	let depth = 0
	let inString = false
	let escaped = false
	for (let i = 0; i < trimmed.length; i++) {
		const ch = trimmed[i]
		if (inString) {
			if (escaped) {
				escaped = false
			} else if (ch === "\\") {
				escaped = true
			} else if (ch === '"') {
				inString = false
			}
			continue
		}
		if (ch === '"') {
			inString = true
		} else if (ch === "[" || ch === "{") {
			depth++
		} else if (ch === "]" || ch === "}") {
			depth--
		} else if (ch === "," && depth === 1) {
			boundaries.push(i)
		}
	}
	// Fast path: the tear only dropped the closing bracket; appending it
	// recovers every intact element instead of losing the last one.
	if (!trimmed.endsWith("]")) {
		try {
			const parsed = JSON.parse(`${trimmed}]`)
			if (Array.isArray(parsed) && parsed.length > 0) {
				return parsed as ApiMessage[]
			}
		} catch {
			// fall through to boundary scan
		}
	}
	// Validate candidates from the tail; the first parseable prefix is the
	// longest recoverable message list.
	for (let b = boundaries.length - 1; b >= 0 && boundaries.length - b <= MAX_RECOVERY_ATTEMPTS; b--) {
		const candidate = `${trimmed.slice(0, boundaries[b])}]`
		try {
			const parsed = JSON.parse(candidate)
			if (Array.isArray(parsed) && parsed.length > 0) {
				return parsed as ApiMessage[]
			}
		} catch {
			// keep scanning further back
		}
	}
	return undefined
}
// kilocode_change end

export async function readApiMessages({
	taskId,
	globalStoragePath,
}: {
	taskId: string
	globalStoragePath: string
}): Promise<ApiMessage[]> {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
	const filePath = path.join(taskDir, GlobalFileNames.apiConversationHistory)

	if (await fileExistsAtPath(filePath)) {
		const fileContent = await fs.readFile(filePath, "utf8")
		try {
			const parsedData = JSON.parse(fileContent)
			if (Array.isArray(parsedData) && parsedData.length === 0) {
				console.error(
					`[Roo-Debug] readApiMessages: Found API conversation history file, but it's empty (parsed as []). TaskId: ${taskId}, Path: ${filePath}`,
				)
			}
			return parsedData
		} catch (error) {
			console.error(
				`[Roo-Debug] readApiMessages: Error parsing API conversation history file. TaskId: ${taskId}, Path: ${filePath}, Error: ${error}`,
			)
			// kilocode_change start: torn-JSON self-healing
			// A torn write (concurrent mutation during streaming serialization
			// or an interrupted write) used to make the task permanently
			// unopenable because this threw. Recover the longest valid prefix,
			// back up the corrupt file for inspection, and persist the healed
			// history so the task opens again.
			const recovered = recoverApiMessagesPrefix(fileContent)
			if (recovered && recovered.length > 0) {
				try {
					const backupPath = `${filePath}.corrupt_${Date.now()}.bak`
					await fs.copyFile(filePath, backupPath)
					await fs.writeFile(filePath, JSON.stringify(recovered), "utf8")
					console.error(
						`[readApiMessages] Recovered ${recovered.length} messages from torn history for task ${taskId}; corrupt file backed up to ${backupPath}`,
					)
				} catch (healError) {
					console.error(`[readApiMessages] Failed to persist healed history: ${healError}`)
				}
				return recovered
			}
			// kilocode_change end
			throw error
		}
	} else {
		const oldPath = path.join(taskDir, "claude_messages.json")

		if (await fileExistsAtPath(oldPath)) {
			const fileContent = await fs.readFile(oldPath, "utf8")
			try {
				const parsedData = JSON.parse(fileContent)
				if (Array.isArray(parsedData) && parsedData.length === 0) {
					console.error(
						`[Roo-Debug] readApiMessages: Found OLD API conversation history file (claude_messages.json), but it's empty (parsed as []). TaskId: ${taskId}, Path: ${oldPath}`,
					)
				}
				await fs.unlink(oldPath)
				return parsedData
			} catch (error) {
				console.error(
					`[Roo-Debug] readApiMessages: Error parsing OLD API conversation history file (claude_messages.json). TaskId: ${taskId}, Path: ${oldPath}, Error: ${error}`,
				)
				// DO NOT unlink oldPath if parsing failed, throw error instead.
				throw error
			}
		}
	}

	// If we reach here, neither the new nor the old history file was found.
	console.error(
		`[Roo-Debug] readApiMessages: API conversation history file not found for taskId: ${taskId}. Expected at: ${filePath}`,
	)
	return []
}

export async function saveApiMessages({
	messages,
	taskId,
	globalStoragePath,
}: {
	messages: ApiMessage[]
	taskId: string
	globalStoragePath: string
}) {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
	const filePath = path.join(taskDir, GlobalFileNames.apiConversationHistory)
	// kilocode_change start: snapshot before writing
	// Message objects in `messages` are shared references that other async
	// flows can mutate while stream-json serializes them, tearing the JSON
	// mid-file (observed with 9MB histories). Snapshot=true serializes
	// synchronously before any I/O so the bytes on disk are immutable.
	await safeWriteJson(filePath, messages, { snapshot: true })
	// kilocode_change end
}
