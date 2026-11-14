import { describe, it, expect, afterEach } from "vitest"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

import {
	writeJsonArrayIncremental,
	clearIncrementalJsonArrayCache,
	computeReusablePrefixCount,
	fingerprintJsonArrayItem,
	getLastIncrementalWriteStats,
	peekIncrementalJsonArrayCache,
	seedIncrementalJsonArrayCache,
	type ArrayWriteCache,
} from "../incrementalJsonArrayWrite"

function isHistoryRow(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false
	}
	const o = value as Record<string, unknown>
	return "ts" in o || "role" in o || "say" in o || "content" in o
}

function isHistoryPayload(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some(isHistoryRow)
	}
	return isHistoryRow(value)
}

function makeCache(items: unknown[], endOffsets: number[] = items.map((_, i) => i + 1)): ArrayWriteCache {
	return {
		frozen: items.map((item) =>
			typeof item === "object" && item !== null ? new WeakRef(item) : { primitive: item },
		),
		fingerprints: items.map(fingerprintJsonArrayItem),
		endOffsets,
		fileSize: (endOffsets.at(-1) ?? 0) + 1,
	}
}

describe("fingerprintJsonArrayItem", () => {
	it("detects api_req_started token fields without hashing the request body", () => {
		const request = "x".repeat(2_000_000)
		const before = {
			ts: 1,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ request, tokensIn: 10, tokensOut: 2, cost: 0.1 }),
		}
		const after = {
			...before,
			text: JSON.stringify({ request, tokensIn: 99, tokensOut: 2, cost: 0.1 }),
		}
		expect(fingerprintJsonArrayItem(before)).not.toEqual(fingerprintJsonArrayItem(after))
		expect(fingerprintJsonArrayItem(before).length).toBeLessThan(400)
	})
})

describe("computeReusablePrefixCount", () => {
	it("reuses a pure append prefix", () => {
		const a = { ts: 1, role: "user", content: "one" }
		const b = { ts: 2, role: "assistant", content: "two" }
		const c = { ts: 3, role: "user", content: "three" }
		const cache = makeCache([a, b])
		expect(computeReusablePrefixCount(cache, [a, b, c])).toBe(2)
	})

	it("dirties from an in-place historical api_req_started mutation", () => {
		const head = { ts: 1, type: "say", say: "text", text: "hello" }
		const apiReq = {
			ts: 2,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ tokensIn: 1, tokensOut: 1, cost: 0 }),
		}
		const tail = { ts: 3, type: "say", say: "text", text: "later" }
		const cache = makeCache([head, apiReq, tail])
		apiReq.text = JSON.stringify({ tokensIn: 40, tokensOut: 9, cost: 0.2 })
		expect(computeReusablePrefixCount(cache, [head, apiReq, tail])).toBe(1)
	})

	it("still dirties an api_req_started that sits outside the 64-row fingerprint window", () => {
		const apiReq = {
			ts: 1,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ tokensIn: 1, tokensOut: 1, cost: 0 }),
		}
		const rest = Array.from({ length: 80 }, (_, i) => ({
			ts: i + 2,
			type: "say",
			say: "text",
			text: `row-${i}`,
		}))
		const items = [apiReq, ...rest]
		const cache = makeCache(items)
		apiReq.text = JSON.stringify({ tokensIn: 40, tokensOut: 9, cost: 0.2 })
		expect(computeReusablePrefixCount(cache, items)).toBe(0)
	})

	it("reuses a truncated prefix", () => {
		const a = { ts: 1, role: "user", content: "one" }
		const b = { ts: 2, role: "assistant", content: "two" }
		const c = { ts: 3, role: "user", content: "three" }
		expect(computeReusablePrefixCount(makeCache([a, b, c]), [a, b])).toBe(2)
	})

	it("reuses a fingerprint prefix when live WeakRefs miss but content is unchanged", () => {
		const original = { ts: 1, role: "user", content: "one" }
		const replacement = { ts: 1, role: "user", content: "one" }
		expect(computeReusablePrefixCount(makeCache([original]), [replacement])).toBe(1)
	})

	it("still dirties from the first fingerprint mismatch after identity is gone", () => {
		const a = { ts: 1, role: "user", content: "one" }
		const b = { ts: 2, role: "assistant", content: "two" }
		const cache = makeCache([a, b])
		expect(computeReusablePrefixCount(cache, [{ ...a, content: "changed" }, { ...b }])).toBe(0)
		expect(computeReusablePrefixCount(cache, [{ ...a }, { ...b, content: "changed" }])).toBe(1)
	})

	it("reuses a fingerprint prefix when the sidecar has no live WeakRefs", () => {
		const a = { ts: 1, role: "user", content: "one" }
		const b = { ts: 2, role: "assistant", content: "two" }
		const cache: ArrayWriteCache = {
			frozen: [],
			fingerprints: [fingerprintJsonArrayItem(a), fingerprintJsonArrayItem(b)],
			endOffsets: [10, 20],
			fileSize: 21,
		}
		expect(computeReusablePrefixCount(cache, [{ ...a }, { ...b }, { ts: 3, role: "user", content: "three" }])).toBe(2)
	})
})

describe("writeJsonArrayIncremental", () => {
	let tempDir: string

	afterEach(async () => {
		clearIncrementalJsonArrayCache()
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	async function setup() {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "inc-json-array-"))
		return path.join(tempDir, "history.json")
	}

	it("stringifies each first-write row only once", async () => {
		const filePath = await setup()
		const prefix = Array.from({ length: 20 }, (_, i) => ({
			ts: i + 1,
			role: i % 2 === 0 ? "user" : "assistant",
			content: `first-${i}-${"x".repeat(80)}`,
		}))
		const original = JSON.stringify
		const historyStringify: unknown[] = []
		JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
			if (isHistoryPayload(value)) {
				historyStringify.push(value)
			}
			return (original as typeof JSON.stringify)(value as never, ...(rest as never[]))
		}) as typeof JSON.stringify
		try {
			await writeJsonArrayIncremental(filePath, prefix)
		} finally {
			JSON.stringify = original
		}

		expect(historyStringify).toHaveLength(20)
		expect(historyStringify.every((value) => !Array.isArray(value))).toBe(true)
		expect(getLastIncrementalWriteStats().stringifiedCount).toBe(20)
		expect(getLastIncrementalWriteStats().reusedCount).toBe(0)
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toHaveLength(20)
	})

	it("writes a valid JSON array and reuses prefix bytes on append", async () => {
		const filePath = await setup()
		const prefix = Array.from({ length: 20 }, (_, i) => ({
			ts: i + 1,
			role: i % 2 === 0 ? "user" : "assistant",
			content: `msg-${i}-${"x".repeat(200)}`,
		}))
		await writeJsonArrayIncremental(filePath, prefix)
		const first = getLastIncrementalWriteStats()
		expect(first.stringifiedCount).toBe(20)
		expect(first.reusedCount).toBe(0)

		const historyStringify: unknown[] = []
		const original = JSON.stringify
		JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
			if (isHistoryPayload(value)) {
				historyStringify.push(value)
			}
			return (original as typeof JSON.stringify)(value as never, ...(rest as never[]))
		}) as typeof JSON.stringify
		try {
			const next = [...prefix, { ts: 21, role: "user", content: "tail" }]
			await writeJsonArrayIncremental(filePath, next)
		} finally {
			JSON.stringify = original
		}

		const stats = getLastIncrementalWriteStats()
		expect(stats.reusedCount).toBe(20)
		expect(stats.stringifiedCount).toBe(1)
		expect(stats.copiedBytes).toBeGreaterThan(0)
		expect(historyStringify).toHaveLength(1)
		expect(Array.isArray(historyStringify[0])).toBe(false)
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toHaveLength(21)
		expect(peekIncrementalJsonArrayCache(filePath)?.frozen).toHaveLength(21)
	})

	it("rewrites only the dirty tail when the last row mutates in place", async () => {
		const filePath = await setup()
		const rows = [
			{ ts: 1, type: "say", say: "text", text: "keep" },
			{ ts: 2, type: "say", say: "command_output", text: "partial" },
		]
		await writeJsonArrayIncremental(filePath, rows)
		rows[1].text = "partial\nmore output"

		const original = JSON.stringify
		let historyStringifyCount = 0
		JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
			if (isHistoryPayload(value)) {
				historyStringifyCount++
			}
			return (original as typeof JSON.stringify)(value as never, ...(rest as never[]))
		}) as typeof JSON.stringify
		try {
			await writeJsonArrayIncremental(filePath, rows)
		} finally {
			JSON.stringify = original
		}

		expect(getLastIncrementalWriteStats().reusedCount).toBe(1)
		expect(getLastIncrementalWriteStats().stringifiedCount).toBe(1)
		expect(historyStringifyCount).toBe(1)
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))[1].text).toBe("partial\nmore output")
	})

	it("skips I/O when identity and fingerprints are unchanged", async () => {
		const filePath = await setup()
		const rows = [{ ts: 1, role: "user", content: "same" }]
		await writeJsonArrayIncremental(filePath, rows)
		const before = await fs.stat(filePath)
		await writeJsonArrayIncremental(filePath, rows)
		expect(getLastIncrementalWriteStats().skipped).toBe(true)
		expect(getLastIncrementalWriteStats().stringifiedCount).toBe(0)
		const after = await fs.stat(filePath)
		expect(after.mtimeMs).toBe(before.mtimeMs)
	})

	it("reuses prefix bytes from sidecar after an in-memory cache miss", async () => {
		const filePath = await setup()
		const prefix = Array.from({ length: 12 }, (_, i) => ({
			ts: i + 1,
			role: i % 2 === 0 ? "user" : "assistant",
			content: `resume-${i}`,
		}))
		await writeJsonArrayIncremental(filePath, prefix)
		clearIncrementalJsonArrayCache()

		const cloned = prefix.map((row) => ({ ...row }))
		cloned.push({ ts: 13, role: "user", content: "after-resume" })
		const original = JSON.stringify
		const historyStringify: unknown[] = []
		JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
			if (isHistoryPayload(value)) {
				historyStringify.push(value)
			}
			return (original as typeof JSON.stringify)(value as never, ...(rest as never[]))
		}) as typeof JSON.stringify
		try {
			await writeJsonArrayIncremental(filePath, cloned)
		} finally {
			JSON.stringify = original
		}

		const stats = getLastIncrementalWriteStats()
		expect(stats.reusedCount).toBe(12)
		expect(stats.stringifiedCount).toBe(1)
		expect(stats.copiedBytes).toBeGreaterThan(0)
		expect(historyStringify).toHaveLength(1)
		expect(Array.isArray(historyStringify[0])).toBe(false)
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toHaveLength(13)
	})

	it("seeds byte offsets from already-read JSON when the sidecar is missing", async () => {
		const filePath = await setup()
		const prefix = Array.from({ length: 8 }, (_, i) => ({
			ts: i + 1,
			role: i % 2 === 0 ? "user" : "assistant",
			content: i === 0 ? `resume-中文😀-${i}` : `resume-${i}`,
		}))
		await writeJsonArrayIncremental(filePath, prefix)
		const written = peekIncrementalJsonArrayCache(filePath)
		expect(written?.endOffsets).toHaveLength(8)
		const offsetsBefore = [...(written?.endOffsets ?? [])]
		const fileSizeBefore = written?.fileSize

		await fs.unlink(`${filePath}.inc-idx.json`)
		clearIncrementalJsonArrayCache()

		const raw = await fs.readFile(filePath, "utf8")
		const parsed = JSON.parse(raw) as typeof prefix
		await seedIncrementalJsonArrayCache(filePath, parsed, raw)
		const seeded = peekIncrementalJsonArrayCache(filePath)
		expect(seeded?.endOffsets).toEqual(offsetsBefore)
		expect(seeded?.fileSize).toBe(fileSizeBefore)
		expect(seeded?.fileSize).toBe(Buffer.byteLength(raw, "utf8"))

		parsed.push({ ts: 9, role: "user", content: "after-missing-sidecar" })
		const original = JSON.stringify
		const historyStringify: unknown[] = []
		JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
			if (isHistoryPayload(value)) {
				historyStringify.push(value)
			}
			return (original as typeof JSON.stringify)(value as never, ...(rest as never[]))
		}) as typeof JSON.stringify
		try {
			await writeJsonArrayIncremental(filePath, parsed)
		} finally {
			JSON.stringify = original
		}

		const stats = getLastIncrementalWriteStats()
		expect(stats.reusedCount).toBe(8)
		expect(stats.stringifiedCount).toBe(1)
		expect(stats.copiedBytes).toBe(offsetsBefore[7])
		expect(historyStringify).toHaveLength(1)
		expect(Array.isArray(historyStringify[0])).toBe(false)
		expect((historyStringify[0] as { content?: string }).content).toBe("after-missing-sidecar")
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toHaveLength(9)
	})

	it("reuses prefix bytes when live objects are replaced with equal fingerprints", async () => {
		const filePath = await setup()
		const prefix = Array.from({ length: 10 }, (_, i) => ({
			ts: i + 1,
			role: i % 2 === 0 ? "user" : "assistant",
			content: `keep-${i}`,
		}))
		await writeJsonArrayIncremental(filePath, prefix)

		const replaced = prefix.map((row) => ({ ...row }))
		replaced.push({ ts: 11, role: "user", content: "after-replace" })
		const original = JSON.stringify
		const historyStringify: unknown[] = []
		JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
			if (isHistoryPayload(value)) {
				historyStringify.push(value)
			}
			return (original as typeof JSON.stringify)(value as never, ...(rest as never[]))
		}) as typeof JSON.stringify
		try {
			await writeJsonArrayIncremental(filePath, replaced)
		} finally {
			JSON.stringify = original
		}

		const stats = getLastIncrementalWriteStats()
		expect(stats.reusedCount).toBe(10)
		expect(stats.stringifiedCount).toBe(1)
		expect(historyStringify).toHaveLength(1)
		expect(Array.isArray(historyStringify[0])).toBe(false)
		await fs.access(`${filePath}.inc-idx.json`)
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toHaveLength(11)
	})

	it("stale on-disk size rewrites without stringifying the tail twice", async () => {
		const filePath = await setup()
		const prefix = Array.from({ length: 12 }, (_, i) => ({
			ts: i + 1,
			role: i % 2 === 0 ? "user" : "assistant",
			content: `stale-${i}`,
		}))
		await writeJsonArrayIncremental(filePath, prefix)
		await fs.appendFile(filePath, "\n")

		const next = [...prefix, { ts: 13, role: "user", content: "after-stale-size" }]
		const original = JSON.stringify
		const historyStringify: unknown[] = []
		JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
			if (isHistoryPayload(value)) {
				historyStringify.push(value)
			}
			return (original as typeof JSON.stringify)(value as never, ...(rest as never[]))
		}) as typeof JSON.stringify
		try {
			await writeJsonArrayIncremental(filePath, next)
		} finally {
			JSON.stringify = original
		}

		expect(historyStringify.every((value) => !Array.isArray(value))).toBe(true)
		expect(historyStringify).toHaveLength(13)
		expect(getLastIncrementalWriteStats().stringifiedCount).toBe(13)
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toHaveLength(13)
	})

	it("overlapping appends keep a matching sidecar and stringify only dirty tails", async () => {
		const filePath = await setup()
		const prefix = Array.from({ length: 16 }, (_, i) => ({
			ts: i + 1,
			role: i % 2 === 0 ? "user" : "assistant",
			content: `overlap-${i}`,
		}))
		await writeJsonArrayIncremental(filePath, prefix)

		const first = [...prefix, { ts: 17, role: "user", content: "first-tail" }]
		const second = [...first, { ts: 18, role: "assistant", content: "second-tail" }]
		const original = JSON.stringify
		const historyStringify: unknown[] = []
		JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
			if (isHistoryPayload(value)) {
				historyStringify.push(value)
			}
			return (original as typeof JSON.stringify)(value as never, ...(rest as never[]))
		}) as typeof JSON.stringify
		try {
			await Promise.all([writeJsonArrayIncremental(filePath, first), writeJsonArrayIncremental(filePath, second)])
		} finally {
			JSON.stringify = original
		}

		expect(historyStringify.every((value) => !Array.isArray(value))).toBe(true)
		expect(historyStringify.length).toBeLessThanOrEqual(3)
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toHaveLength(18)
		const sidecarRaw = await fs.readFile(`${filePath}.inc-idx.json`, "utf8")
		const sidecar = JSON.parse(sidecarRaw) as { fileSize: number; fingerprints: string[] }
		expect(sidecar.fileSize).toBe((await fs.stat(filePath)).size)
		expect(sidecar.fingerprints).toHaveLength(18)
	})
})
