import { describe, expect, it } from "vitest"
import type { ClineMessage } from "@roo-code/types"

import { COMMAND_OUTPUT_STRING } from "../consolidateCommands.js"
import {
	COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT,
	USER_MESSAGE_RAIL_PREVIEW_CHARS,
	WEBVIEW_TRANSCRIPT_DISPLAY_TAIL,
	WEBVIEW_TRANSCRIPT_HISTORICAL_CHAR_LIMIT,
	WEBVIEW_TRANSCRIPT_IMAGE_ROWS,
	projectClineMessagesForDisplay,
	projectClineMessagesForDisplayWithMeta,
	projectCommandMessageForDisplay,
	projectTranscriptBoundForDisplay,
	projectTranscriptBoundForDisplayWithMeta,
	projectUserMessageRailIndex,
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

	it("keeps every historical row in order and cheap-previews payloads older than the tail", () => {
		const messages = Array.from({ length: 30 }, (_, i) => sayText(i + 1, `payload-${i + 1}-`.padEnd(2000, "x")))
		const { messages: out, tombstonedCount } = projectTranscriptBoundForDisplayWithMeta(messages, 10, 5)

		expect(out).toHaveLength(30)
		expect(out[0]!.webviewTombstone).toBeUndefined()
		expect(out[0]!.ts).toBe(1)
		expect(out[0]!.text!.length).toBeLessThanOrEqual(WEBVIEW_TRANSCRIPT_HISTORICAL_CHAR_LIMIT + 1)
		expect(out[0]!.text).toContain("payload-1-")
		expect(out[1]!.text!.length).toBeLessThanOrEqual(WEBVIEW_TRANSCRIPT_HISTORICAL_CHAR_LIMIT + 1)
		expect(out[1]!.text).toContain("payload-2-")
		for (let i = 0; i < 10; i++) {
			expect(out[20 + i]).toBe(messages[20 + i])
		}
		expect(tombstonedCount).toBe(0)
		expect(messages[0]!.text).toHaveLength(2000)
		expect(messages[1]!.text).toHaveLength(2000)
	})

	it("keeps historical api_req cost JSON and blanks condense summaries without dropping rows", () => {
		const taskRow = sayText(1, "do the thing")
		const apiReq = {
			ts: 2,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ tokensIn: 100, tokensOut: 50, cost: 0.5, request: "x".repeat(4000) }),
		} as ClineMessage
		const condense = {
			ts: 3,
			type: "say",
			say: "condense_context",
			text: "long summary".padEnd(5000, "y"),
			contextCondense: { cost: 0.25, newContextTokens: 1200, summary: "long summary".padEnd(5000, "y") },
		} as unknown as ClineMessage
		const tail = Array.from({ length: 10 }, (_, i) => sayText(4 + i, `tail-${i}`))
		const out = projectTranscriptBoundForDisplay([taskRow, apiReq, condense, ...tail], 4, 5)

		expect(out).toHaveLength(13)
		expect(out[1]!.webviewTombstone).toBeUndefined()
		expect(out[1]!.say).toBe("api_req_started")
		expect(JSON.parse(out[1]!.text!)).toEqual({
			tokensIn: 100,
			tokensOut: 50,
			cost: 0.5,
		})
		expect(out[2]!.webviewTombstone).toBeUndefined()
		expect(out[2]!.say).toBe("condense_context")
		expect(out[2]!.contextCondense).toEqual({
			cost: 0.25,
			newContextTokens: 1200,
			summary: "",
		})
		expect(out[2]!.text!.length).toBeLessThanOrEqual(WEBVIEW_TRANSCRIPT_HISTORICAL_CHAR_LIMIT + 1)
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

		expect(projected).toHaveLength(FIELD_ROW_COUNT)
		expect(projected[0]).toBe(messages[0])
		expect(projected[0]!.text).toBe("Scientist wait-command task")
		expect(projected[1]!.text!.length).toBeLessThanOrEqual(WEBVIEW_TRANSCRIPT_HISTORICAL_CHAR_LIMIT + 1)
		expect(projectedJsonBytes).toBeLessThan(originalJsonBytes / 8)
		expect(projectedJsonBytes).toBeLessThan(3_000_000)
		expect(tombstonedCount).toBe(0)
		expect(projected.filter((m) => m.webviewTombstone === true)).toHaveLength(0)
		expect(messages[1]!.text).toHaveLength(FIELD_PAYLOAD_CHARS)

		const last = projected[projected.length - 1]!
		expect(last.webviewTombstone).toBeUndefined()
		expect(last.commandOutputTruncated).toBe(true)
		expect(last.partial).toBe(true)
		expect(last.text!.length).toBeLessThan(messages[FIELD_ROW_COUNT - 1]!.text!.length)
		expect(messages[FIELD_ROW_COUNT - 1]!.text).toContain("b".repeat(100))
	})

	it("keeps the default host bound aligned with the webview tail/image budget", () => {
		expect(WEBVIEW_TRANSCRIPT_DISPLAY_TAIL).toBe(64)
		expect(WEBVIEW_TRANSCRIPT_HISTORICAL_CHAR_LIMIT).toBe(120)
		expect(WEBVIEW_TRANSCRIPT_IMAGE_ROWS).toBe(4)
	})

	it("indexes every completed user_feedback row with a capped preview", () => {
		const messages: ClineMessage[] = [
			sayText(1, "task"),
			{ ts: 2, type: "say", say: "user_feedback", text: "first" } as ClineMessage,
			sayText(3, "assistant"),
			{
				ts: 4,
				type: "say",
				say: "user_feedback",
				text: "x".repeat(USER_MESSAGE_RAIL_PREVIEW_CHARS + 40),
			} as ClineMessage,
			{ ts: 5, type: "say", say: "user_feedback", text: "streaming", partial: true } as ClineMessage,
		]
		const ticks = projectUserMessageRailIndex(messages)
		expect(ticks).toHaveLength(2)
		expect(ticks[0]).toEqual({ ts: 2, index: 1, preview: "first" })
		expect(ticks[1]!.ts).toBe(4)
		expect(ticks[1]!.index).toBe(3)
		expect(ticks[1]!.preview.length).toBe(USER_MESSAGE_RAIL_PREVIEW_CHARS + 1)
		expect(ticks[1]!.preview.endsWith("…")).toBe(true)
	})

	it("ships a continuous 200-row list instead of a sliding 64-row page", () => {
		const messages = Array.from({ length: 200 }, (_, i) => sayText(i + 1, `row ${i + 1}`))
		const projected = projectTranscriptBoundForDisplay(messages)
		expect(projected).toHaveLength(200)
		expect(projected[0]!.ts).toBe(1)
		expect(projected[79]!.ts).toBe(80)
		expect(projected[199]!.ts).toBe(200)
		expect(projected.filter((message) => message.webviewTombstone === true)).toHaveLength(0)
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
