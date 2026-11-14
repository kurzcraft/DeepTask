import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

import { saveTaskMessages } from "../taskMessages"
import { GlobalFileNames } from "../../../shared/globalFileNames"
import { clearIncrementalJsonArrayCache } from "../../../utils/incrementalJsonArrayWrite"

let tmpBaseDir: string

beforeEach(async () => {
	clearIncrementalJsonArrayCache()
	tmpBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-test-"))
})

afterEach(async () => {
	clearIncrementalJsonArrayCache()
	await fs.rm(tmpBaseDir, { recursive: true, force: true })
})

describe("taskMessages.saveTaskMessages", () => {
	it("persists messages as-is", async () => {
		const messages: any[] = [
			{
				role: "assistant",
				content: "Hello",
				metadata: {
					other: "keep",
				},
			},
			{ role: "user", content: "Do thing" },
		]

		await saveTaskMessages({
			messages,
			taskId: "task-1",
			globalStoragePath: tmpBaseDir,
		})

		const filePath = path.join(tmpBaseDir, "tasks", "task-1", GlobalFileNames.uiMessages)
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual(messages)
	})

	it("persists messages without modification when no metadata", async () => {
		const messages: any[] = [
			{ role: "assistant", content: "Hi" },
			{ role: "user", content: "Yo" },
		]

		await saveTaskMessages({
			messages,
			taskId: "task-2",
			globalStoragePath: tmpBaseDir,
		})

		const filePath = path.join(tmpBaseDir, "tasks", "task-2", GlobalFileNames.uiMessages)
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual(messages)
	})
})
