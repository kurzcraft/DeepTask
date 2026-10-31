import { describe, expect, it } from "vitest"
import type { ClineMessage } from "@roo-code/types"

import { COMMAND_OUTPUT_STRING } from "../consolidateCommands.js"
import {
	COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT,
	projectClineMessagesForDisplay,
	projectCommandMessageForDisplay,
	truncateCommandOutputText,
} from "../projectCommandOutput.js"

const commandMessage = (overrides: Partial<ClineMessage> = {}): ClineMessage => ({
	ts: 1,
	type: "ask",
	ask: "command",
	text: "ls",
	...overrides,
})

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

	it("does not rewrite non-command messages", () => {
		const text = commandMessage({
			ask: undefined,
			type: "say",
			say: "text",
			text: `note\n${COMMAND_OUTPUT_STRING}${"x".repeat(COMMAND_OUTPUT_DISPLAY_CHAR_LIMIT + 1)}`,
		})
		expect(projectCommandMessageForDisplay(text)).toBe(text)
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
})
