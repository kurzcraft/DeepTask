import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

// Mocks (use hoisted to avoid initialization ordering issues)
const hoisted = vi.hoisted(() => ({
	safeWriteJsonMock: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: hoisted.safeWriteJsonMock,
}))

// Import after mocks
import { readApiMessages, saveApiMessages, recoverApiMessagesPrefix } from "../apiMessages"
import { GlobalFileNames } from "../../../shared/globalFileNames"

let tmpBaseDir: string

beforeEach(async () => {
	hoisted.safeWriteJsonMock.mockClear()
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
	it("requests a synchronous snapshot to prevent torn writes", async () => {
		const messages: any[] = [{ role: "user", content: "hello" }]
		await saveApiMessages({ messages, taskId: "snap-1", globalStoragePath: tmpBaseDir })
		expect(hoisted.safeWriteJsonMock).toHaveBeenCalledTimes(1)
		const options = hoisted.safeWriteJsonMock.mock.calls[0][2]
		expect(options).toEqual({ snapshot: true })
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
})
