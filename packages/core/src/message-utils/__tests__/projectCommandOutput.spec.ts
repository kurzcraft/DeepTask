import { describe, expect, it } from "vitest"
import type { ClineMessage } from "@roo-code/types"

import { COMMAND_OUTPUT_STRING } from "../consolidateCommands.js"
import {
	COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT,
	WEBVIEW_TRANSCRIPT_DISPLAY_TAIL,
	WEBVIEW_TRANSCRIPT_IMAGE_ROWS,
	projectClineMessagesForDisplay,
	projectClineMessagesForDisplayWithMeta,
	projectCommandMessageForDisplay,
	projectTranscriptBoundForDisplay,
	projectTranscriptBoundForDisplayWithMeta,
	truncateCommandOutputText,
} from "../projectCommandOutput.js"

const commandMessage = (overrides: Partial<ClineMessage> = {}): ClineMessage => ({
	ts: 1,
	type: "ask",
	ask: "command",
	text: "ls",
	...overrides,
})

const sayText = (ts: number, text: string, extra: Partial<ClineMessage> = {}): ClineMessage =>
	({ ts, type: "say", say: "text", text, ...extra }) as ClineMessage

/** Scientist wait-command field: 13k-row / 22MB snapshot that JSON.parse'd in the renderer. */
const FIELD_ROW_COUNT = 13_000
const FIELD_PAYLOAD_CHARS = 1_700

describe("projectCommandOutput", () => {
	it("keeps short command output unchanged", () => {
		const text = `ls\n${COMMAND_OUTPUT_STRING}ok`
		expect(truncateCommandOutputText(text)).toBe(text)
		expect(projectCommandMessageForDisplay(commandMessage({ text }))).toEqual(commandMessage({ text }))
	})

	it("truncates historical command output without mutating the original object", () => {
		const output = "a".repeat(COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT + 50)
		const original = commandMessage({ text: `cat log\n${COMMAND_OUTPUT_STRING}${output}` })
		const projected = projectCommandMessageForDisplay(original)

		expect(projected).not.toBe(original)
		expect(original.text).toContain(output)
		expect(projected.commandOutputTruncated).toBe(true)
		expect(projected.commandOutputOriginalLength).toBe(original.text!.length)
		expect(projected.text!.length).toBeLessThan(original.text!.length)
		expect(projected.text).toContain("truncated")
		expect(projected.text!.startsWith("cat log\n")).toBe(true)
	})

	it("truncates the last streaming command in a transcript projection", () => {
		const output = "b".repeat(COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT + 20)
		const historical = commandMessage({
			ts: 1,
			text: `old\n${COMMAND_OUTPUT_STRING}${output}`,
			partial: false,
		})
		const streaming = commandMessage({
			ts: 2,
			text: `tail -f\n${COMMAND_OUTPUT_STRING}${output}`,
			partial: true,
		})
		const projected = projectClineMessagesForDisplay([historical, streaming])

		expect(projected[0]!.commandOutputTruncated).toBe(true)
		expect(projected[1]).not.toBe(streaming)
		expect(projected[1]!.commandOutputTruncated).toBe(true)
		expect(projected[1]!.text).not.toBe(streaming.text)
		expect(projected[1]!.text!.length).toBeLessThan(streaming.text!.length)
		expect(streaming.text).toContain(output)
	})

	it("does not rewrite short non-command messages", () => {
		const text = commandMessage({
			ask: undefined,
			type: "say",
			say: "text",
			text: "note",
		})
		expect(projectCommandMessageForDisplay(text)).toBe(text)
	})

	it("truncates oversized non-command text inside the verbatim tail", () => {
		const original = commandMessage({
			ask: undefined,
			type: "say",
			say: "text",
			text: "x".repeat(COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT + 1),
		})
		const projected = projectCommandMessageForDisplay(original)

		expect(projected).not.toBe(original)
		expect(original.text).toHaveLength(COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT + 1)
		expect(projected.text!.length).toBeLessThan(original.text!.length)
	})

	it("truncates completed command_output messages without mutating storage", () => {
		const output = "c".repeat(COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT + 10)
		const original = commandMessage({
			ask: "command_output",
			text: `echo done\n${COMMAND_OUTPUT_STRING}${output}`,
			partial: false,
		})
		const projected = projectCommandMessageForDisplay(original)

		expect(projected).not.toBe(original)
		expect(original.text).toContain(output)
		expect(projected.commandOutputTruncated).toBe(true)
		expect(projected.text!.length).toBeLessThan(original.text!.length)
	})

	it("omits historical rows before they cross IPC, keeping row 0, two stubs, and the tail", () => {
		const messages = Array.from({ length: 30 }, (_, i) => sayText(i + 1, `payload-${i + 1}-`.padEnd(2000, "x")))
		const { messages: out, tombstonedCount } = projectTranscriptBoundForDisplayWithMeta(messages, 10, 5)

		expect(out.length).toBe(13)
		expect(out[0]).toBe(messages[0])
		expect(out[0]!.webviewTombstone).toBeUndefined()
		expect(out[1]!.webviewTombstone).toBe(true)
		expect(out[1]!.say).toBe("api_req_started")
		expect(out[2]!.webviewTombstone).toBe(true)
		expect(out[2]!.say).toBe("condense_context")
		for (let i = 0; i < 10; i++) {
			expect(out[3 + i]).toBe(messages[20 + i])
		}
		expect(tombstonedCount).toBe(19)
		expect(messages[1]!.text).toContain("payload-")
	})

	it("folds dropped-prefix token and condense totals into the two accounting stubs", () => {
		const taskRow = sayText(1, "do the thing")
		const apiReq = {
			ts: 2,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ tokensIn: 100, tokensOut: 50, cost: 0.5 }),
		} as ClineMessage
		const condense = {
			ts: 3,
			type: "say",
			say: "condense_context",
			text: "long summary".padEnd(5000, "y"),
			contextCondense: { cost: 0.25, newContextTokens: 1200 },
		} as unknown as ClineMessage
		const tail = Array.from({ length: 10 }, (_, i) => sayText(4 + i, `tail-${i}`))
		const out = projectTranscriptBoundForDisplay([taskRow, apiReq, condense, ...tail], 4, 5)

		expect(out.length).toBe(7)
		expect(out[1]!.webviewTombstone).toBe(true)
		expect(out[1]!.say).toBe("api_req_started")
		expect(JSON.parse(out[1]!.text!)).toEqual({
			tokensIn: 100,
			tokensOut: 50,
			cost: 0.75,
		})
		expect(out[2]!.webviewTombstone).toBe(true)
		expect(out[2]!.say).toBe("condense_context")
		expect(out[2]!.contextCondense).toEqual({
			cost: 0,
			prevContextTokens: 1200,
			newContextTokens: 1200,
			summary: "",
		})
		expect(condense.text).toContain("long summary")
	})

	it("strips images older than the newest IMAGE_ROWS inside the verbatim tail", () => {
		const messages = [
			sayText(1, "task"),
			...Array.from({ length: 20 }, (_, i) =>
				sayText(2 + i, `img-${2 + i}`, { images: ["data:image/png;base64," + "A".repeat(64)] }),
			),
		]
		const out = projectTranscriptBoundForDisplay(messages, 10, 5)
		const withImages = out.filter((m) => m.images !== undefined)
		const stripped = out.filter((m) => m.webviewImagesStripped === true)

		expect(withImages.length).toBeLessThanOrEqual(5)
		expect(stripped.length).toBeGreaterThan(0)
		for (const row of stripped) {
			expect(row.text).toContain("img-")
			expect(row.images).toBeUndefined()
		}
		expect(out.filter((m) => m.webviewTombstone === true && m.images !== undefined)).toHaveLength(0)
		expect(messages[2]!.images).toBeDefined()
	})

	it("does not rewrite a short transcript (identity preserved)", () => {
		const messages = Array.from({ length: 9 }, (_, i) => sayText(i + 1, `row-${i}`))
		expect(projectTranscriptBoundForDisplay(messages, 10, 5)).toBe(messages)
		expect(projectClineMessagesForDisplay(messages)).toBe(messages)
	})

	it("projects a 13k-row / 22MB Scientist wait-command snapshot without shipping a 16k tombstone array", () => {
		const payload = "x".repeat(FIELD_PAYLOAD_CHARS)
		const messages: ClineMessage[] = Array.from({ length: FIELD_ROW_COUNT }, (_, i) => {
			if (i === 0) {
				return sayText(1, "Scientist wait-command task")
			}
			if (i === FIELD_ROW_COUNT - 1) {
				return commandMessage({
					ts: i + 1,
					text: `tail -f log\n${COMMAND_OUTPUT_STRING}${"b".repeat(COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT + 20)}`,
					partial: true,
				})
			}
			return sayText(i + 1, payload)
		})

		const originalJsonBytes = JSON.stringify(messages).length
		expect(originalJsonBytes).toBeGreaterThan(20_000_000)

		const { messages: projected, tombstonedCount } = projectClineMessagesForDisplayWithMeta(messages)
		const projectedJsonBytes = JSON.stringify(projected).length

		expect(projected.length).toBe(1 + 2 + WEBVIEW_TRANSCRIPT_DISPLAY_TAIL)
		expect(projected[0]).toBe(messages[0])
		expect(projected[0]!.text).toBe("Scientist wait-command task")
		expect(projectedJsonBytes).toBeLessThan(originalJsonBytes / 8)
		expect(projectedJsonBytes).toBeLessThan(3_000_000)
		expect(tombstonedCount).toBe(FIELD_ROW_COUNT - WEBVIEW_TRANSCRIPT_DISPLAY_TAIL - 1)

		const tombstoned = projected.filter((m) => m.webviewTombstone === true)
		expect(tombstoned.length).toBe(2)
		expect(tombstoned[0]!.say).toBe("api_req_started")
		expect(tombstoned[1]!.say).toBe("condense_context")
		expect(messages[1]!.text).toHaveLength(FIELD_PAYLOAD_CHARS)

		const last = projected[projected.length - 1]!
		expect(last.webviewTombstone).toBeUndefined()
		expect(last.commandOutputTruncated).toBe(true)
		expect(last.partial).toBe(true)
		expect(last.text!.length).toBeLessThan(messages[FIELD_ROW_COUNT - 1]!.text!.length)
		expect(messages[FIELD_ROW_COUNT - 1]!.text).toContain("b".repeat(100))
	})

	it("keeps the default host bound aligned with the webview tail/image budget", () => {
		expect(WEBVIEW_TRANSCRIPT_DISPLAY_TAIL).toBe(800)
		expect(WEBVIEW_TRANSCRIPT_IMAGE_ROWS).toBe(24)
	})

	it("shrinks oversized tool JSON without slicing a string literal at char 3000", () => {
		const content = "line\n".repeat(2_000)
		const original = {
			ts: 1,
			type: "ask" as const,
			ask: "tool" as const,
			text: JSON.stringify({
				tool: "editedExistingFile",
				path: "EXTRA/task/DEEPTASK_90PCT_AND_TASK_SPLIT.md",
				content,
			}),
		}
		expect(original.text.length).toBeGreaterThan(COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT)

		const projected = projectCommandMessageForDisplay(original)
		expect(projected).not.toBe(original)
		expect(projected.text!.length).toBeLessThan(original.text.length)
		expect(() => JSON.parse(projected.text!)).not.toThrow()
		const parsed = JSON.parse(projected.text!) as { tool: string; path: string; content: string }
		expect(parsed.tool).toBe("editedExistingFile")
		expect(parsed.path).toContain("DEEPTASK_90PCT_AND_TASK_SPLIT.md")
		expect(parsed.content).toContain("truncated")
		expect(projected.text).not.toMatch(/\n… \[truncated/)
	})
})
