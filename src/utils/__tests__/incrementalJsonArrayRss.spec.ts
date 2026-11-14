import { describe, it, expect, afterEach } from "vitest"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

import {
	writeJsonArrayIncremental,
	clearIncrementalJsonArrayCache,
	seedIncrementalJsonArrayCache,
	getLastIncrementalWriteStats,
} from "../incrementalJsonArrayWrite"

function heapUsed(): number {
	return process.memoryUsage().heapUsed
}

async function maybeGc(): Promise<void> {
	if (typeof globalThis.gc === "function") {
		globalThis.gc()
		await new Promise((resolve) => setTimeout(resolve, 20))
		globalThis.gc()
	}
}

describe("incremental JSON array RSS", () => {
	let tempDir: string

	afterEach(async () => {
		clearIncrementalJsonArrayCache()
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	it("first write stringifies each row once instead of doubling the history", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "inc-json-rss-first-"))
		const filePath = path.join(tempDir, "history.json")
		const prefix = Array.from({ length: 400 }, (_, i) => ({
			ts: i + 1,
			role: i % 2 === 0 ? "user" : "assistant",
			content: `row-${i}-${"中文😀".repeat(80)}-${"x".repeat(8_000)}`,
		}))

		await writeJsonArrayIncremental(filePath, prefix)
		const stats = getLastIncrementalWriteStats()
		expect(stats.reusedCount).toBe(0)
		expect(stats.stringifiedCount).toBe(400)
		expect(stats.skipped).toBe(false)
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toHaveLength(400)
	})

	it("keeps no-sidecar resume append far below a full-history stringify", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "inc-json-rss-"))
		const filePath = path.join(tempDir, "history.json")
		const prefix = Array.from({ length: 400 }, (_, i) => ({
			ts: i + 1,
			role: i % 2 === 0 ? "user" : "assistant",
			content: `row-${i}-${"中文😀".repeat(80)}-${"x".repeat(8_000)}`,
		}))

		await writeJsonArrayIncremental(filePath, prefix)
		const raw = await fs.readFile(filePath, "utf8")
		expect(Buffer.byteLength(raw, "utf8")).toBeGreaterThan(3_000_000)

		await fs.unlink(`${filePath}.inc-idx.json`)
		clearIncrementalJsonArrayCache()
		const parsed = JSON.parse(raw) as typeof prefix
		await seedIncrementalJsonArrayCache(filePath, parsed, raw)
		parsed.push({ ts: 401, role: "user", content: "after-resume-rss" })

		await maybeGc()
		const beforeIncremental = heapUsed()
		await writeJsonArrayIncremental(filePath, parsed)
		const afterIncremental = heapUsed()
		const incrementalDelta = Math.max(0, afterIncremental - beforeIncremental)
		const stats = getLastIncrementalWriteStats()
		expect(stats.reusedCount).toBe(400)
		expect(stats.stringifiedCount).toBe(1)
		expect(stats.copiedBytes).toBeGreaterThan(3_000_000)

		await maybeGc()
		const beforeFull = heapUsed()
		const full = JSON.stringify(parsed)
		const afterFull = heapUsed()
		const fullDelta = Math.max(Buffer.byteLength(full, "utf8"), afterFull - beforeFull)

		expect(incrementalDelta).toBeLessThan(fullDelta * 0.35)
		expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toHaveLength(401)
	})
})
