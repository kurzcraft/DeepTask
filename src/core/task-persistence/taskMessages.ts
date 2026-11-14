import { seedIncrementalJsonArrayCache, writeJsonArrayIncremental } from "../../utils/incrementalJsonArrayWrite"
import * as path from "path"
import * as fs from "fs/promises"

import type { ClineMessage } from "@roo-code/types"

import { fileExistsAtPath } from "../../utils/fs"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { getTaskDirectoryPath } from "../../utils/storage"

export type ReadTaskMessagesOptions = {
	taskId: string
	globalStoragePath: string
}

export async function readTaskMessages({
	taskId,
	globalStoragePath,
}: ReadTaskMessagesOptions): Promise<ClineMessage[]> {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
	const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
	const fileExists = await fileExistsAtPath(filePath)

	if (fileExists) {
		const fileContent = await fs.readFile(filePath, "utf8")
		const parsed = JSON.parse(fileContent)
		if (Array.isArray(parsed) && parsed.length > 0) {
			await seedIncrementalJsonArrayCache(filePath, parsed, fileContent)
		}
		return parsed
	}

	return []
}

export type SaveTaskMessagesOptions = {
	messages: ClineMessage[]
	taskId: string
	globalStoragePath: string
}

export async function saveTaskMessages({ messages, taskId, globalStoragePath }: SaveTaskMessagesOptions) {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
	const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
	// kilocode_change start: incremental array write
	// Same rationale as saveApiMessages: never JSON.stringify the full
	// transcript. Reuse frozen prefix bytes; stringify only the dirty tail.
	await writeJsonArrayIncremental(filePath, messages)
	// kilocode_change end
}
