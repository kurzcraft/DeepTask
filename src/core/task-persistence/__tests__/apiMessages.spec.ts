import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

import { readApiMessages, saveApiMessages, recoverApiMessagesPrefix } from "../apiMessages"
import { GlobalFileNames } from "../../../shared/globalFileNames"
import { clearIncrementalJsonArrayCache, getLastIncrementalWriteStats } from "../../../utils/incrementalJsonArrayWrite"

let tmpBaseDir: string

beforeEach(async () => {
	clearIncrementalJsonArrayCache()
	tmpBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-api-messages-"))
})

afterEach(async () => {
	await fs.rm(tmpBaseDir, { recursive: true, force: true })
})

describe("recoverApiMessagesPrefix", () => {
	it("recovers the full prefix when the tail was torn (missing closing bracket)", () => {
		const valid = JSON.stringify([{ role: "user", content: "a" }, { role: "user", content: "b" }])
		const torn = valid.slice(0, valid.lastIndexOf("]")) // strip the final ]
		const recovered = recoverApiMessagesPrefix(torn)
		expect(recovered).toEqual([{ role: "user", content: "a" }, { role: "user", content: "b" }])
	})

	it("recovers the longest valid prefix when a middle element is torn but the tail is intact", () => {
		// Mirrors the real corruption: byte-level structural break mid-file while
		// the file still ends with a complete `]`.
		const head = JSON.stringify([{ role: "user", content: "one" }, { role: "user", content: "two" }])
		const tornMiddle = `${head.slice(0, -1)},{"role":"user","content":"thr` // torn element without closing quote/brace
		const tail = `,{"role":"user","content":"four"}]`
		const torn = tornMiddle + tail
		const recovered = recoverApiMessagesPrefix(torn)
		expect(recovered).toEqual([{ role: "user", content: "one" }, { role: "user", content: "two" }])
	})

	it("ignores braces and brackets inside JSON strings", () => {
		const messages = [
			{ role: "user", content: `code with braces ]}{ "unclosed` },
			{ role: "assistant", content: "ok" },
		]
		const valid = JSON.stringify(messages)
		const torn = valid.slice(0, valid.lastIndexOf("]")) // strip final ]
		const recovered = recoverApiMessagesPrefix(torn)
		expect(recovered).toEqual(messages)
	})

	it("returns undefined when nothing can be recovered", () => {
		expect(recoverApiMessagesPrefix("not json at all")).toBeUndefined()
		expect(recoverApiMessagesPrefix("[")).toBeUndefined()
	})
})

describe("saveApiMessages", () => {
	it("writes a valid JSON array without a full-history stringify on append", async () => {
		const prefix = { role: "user", content: "hello" }
		const messages: any[] = [prefix]
		await saveApiMessages({ messages, taskId: "snap-1", globalStoragePath: tmpBaseDir })
		const filePath = path.join(tmpBaseDir, "tasks", "snap-1", GlobalFileNames.apiConversationHistory)
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual(messages)

		messages.push({ role: "assistant", content: "world" })
		await saveApiMessages({ messages, taskId: "snap-1", globalStoragePath: tmpBaseDir })
		const stats = getLastIncrementalWriteStats()
		expect(stats.reusedCount).toBe(1)
		expect(stats.stringifiedCount).toBe(1)
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual(messages)
	})
})

describe("readApiMessages torn-file self-healing", () => {
	it("heals a torn history, backs up the corrupt file, and returns the recovered prefix", async () => {
		const taskId = "torn-1"
		const taskDir = path.join(tmpBaseDir, "tasks", taskId)
		await fs.mkdir(taskDir, { recursive: true })
		const filePath = path.join(taskDir, GlobalFileNames.apiConversationHistory)

		const messages = [
			{ role: "user", content: "first" },
			{ role: "assistant", content: "second" },
			{ role: "user", content: "third" },
		]
		const valid = JSON.stringify(messages)
		// Tear the middle element while keeping the final `]` (real-world shape).
		const torn = `${JSON.stringify(messages.slice(0, 2)).slice(0, -1)},{"role":"user","content":"thi${valid.slice(valid.lastIndexOf("]") - 1)}`

		await fs.writeFile(filePath, torn, "utf8")

		const recovered = await readApiMessages({ taskId, globalStoragePath: tmpBaseDir })

		expect(recovered).toEqual(messages.slice(0, 2))

		// The healed file on disk must now be valid JSON.
		const healed = JSON.parse(await fs.readFile(filePath, "utf8"))
		expect(healed).toEqual(messages.slice(0, 2))

		// The corrupt original must be preserved as a backup.
		const dirEntries = await fs.readdir(taskDir)
		const backups = dirEntries.filter((name) => name.startsWith(`${GlobalFileNames.apiConversationHistory}.corrupt_`))
		expect(backups.length).toBe(1)
	})

	it("throws when recovery is impossible", async () => {
		const taskId = "torn-2"
		const taskDir = path.join(tmpBaseDir, "tasks", taskId)
		await fs.mkdir(taskDir, { recursive: true })
		await fs.writeFile(path.join(taskDir, GlobalFileNames.apiConversationHistory), "{broken", "utf8")

		await expect(readApiMessages({ taskId, globalStoragePath: tmpBaseDir })).rejects.toThrow()
	})

	it("returns parsed messages for an intact history", async () => {
		const taskId = "intact-1"
		const taskDir = path.join(tmpBaseDir, "tasks", taskId)
		await fs.mkdir(taskDir, { recursive: true })
		const messages = [{ role: "user", content: "ok" }]
		await fs.writeFile(path.join(taskDir, GlobalFileNames.apiConversationHistory), JSON.stringify(messages), "utf8")

		const result = await readApiMessages({ taskId, globalStoragePath: tmpBaseDir })
		expect(result).toEqual(messages)
	})

	it("reuses prefix bytes after resume when the sidecar is missing", async () => {
		const taskId = "resume-no-sidecar"
		const prefix = Array.from({ length: 6 }, (_, i) => ({
			role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
			content: i === 0 ? `seed-中文😀-${i}` : `seed-${i}`,
		}))
		await saveApiMessages({ messages: prefix, taskId, globalStoragePath: tmpBaseDir })
		const filePath = path.join(tmpBaseDir, "tasks", taskId, GlobalFileNames.apiConversationHistory)
		await fs.unlink(`${filePath}.inc-idx.json`)
		clearIncrementalJsonArrayCache()

		const loaded = await readApiMessages({ taskId, globalStoragePath: tmpBaseDir })
		expect(loaded).toHaveLength(6)
		loaded.push({ role: "user", content: "after-resume" })
		await saveApiMessages({ messages: loaded, taskId, globalStoragePath: tmpBaseDir })

		const stats = getLastIncrementalWriteStats()
		expect(stats.reusedCount).toBe(6)
		expect(stats.stringifiedCount).toBe(1)
		expect(stats.copiedBytes).toBeGreaterThan(0)
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toHaveLength(7)
	})
})
