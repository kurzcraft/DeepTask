// npx vitest run src/core/tools/helpers/__tests__/commandPhysicalLines.spec.ts

import { describe, expect, it } from "vitest"
import {
	countCommandPhysicalLines,
	getExecuteCommandPhysicalLineLimitError,
	isExecuteCommandOverPhysicalLineLimit,
	MAX_EXECUTE_COMMAND_PHYSICAL_LINES,
} from "../commandPhysicalLines"

describe("countCommandPhysicalLines", () => {
	it("counts a single line as 1", () => {
		expect(countCommandPhysicalLines("echo hi")).toBe(1)
		expect(isExecuteCommandOverPhysicalLineLimit("echo hi")).toBe(false)
	})

	it("counts two lines as 2", () => {
		expect(countCommandPhysicalLines("echo a\necho b")).toBe(2)
		expect(isExecuteCommandOverPhysicalLineLimit("echo a\necho b")).toBe(false)
	})

	it("rejects three lines", () => {
		expect(countCommandPhysicalLines("echo a\necho b\necho c")).toBe(3)
		expect(isExecuteCommandOverPhysicalLineLimit("echo a\necho b\necho c")).toBe(true)
	})

	it("does not count a trailing LF as an extra line", () => {
		expect(countCommandPhysicalLines("echo hi\n")).toBe(1)
		expect(countCommandPhysicalLines("echo a\necho b\n")).toBe(2)
		expect(isExecuteCommandOverPhysicalLineLimit("echo a\necho b\n")).toBe(false)
	})

	it("counts interior blank lines", () => {
		expect(countCommandPhysicalLines("echo a\n\necho b")).toBe(3)
		expect(isExecuteCommandOverPhysicalLineLimit("echo a\n\necho b")).toBe(true)
	})

	it("treats CRLF as one break", () => {
		expect(countCommandPhysicalLines("echo a\r\necho b")).toBe(2)
		expect(countCommandPhysicalLines("echo a\r\necho b\r\necho c")).toBe(3)
		expect(countCommandPhysicalLines("echo a\r\necho b\r\n")).toBe(2)
	})

	it("treats CR as one break", () => {
		expect(countCommandPhysicalLines("echo a\recho b")).toBe(2)
		expect(countCommandPhysicalLines("echo a\recho b\recho c")).toBe(3)
		expect(countCommandPhysicalLines("echo a\recho b\r")).toBe(2)
	})

	it("does not treat escaped two-character \\n as a newline", () => {
		expect(countCommandPhysicalLines("echo hello\\nworld")).toBe(1)
		expect(isExecuteCommandOverPhysicalLineLimit("echo hello\\nworld")).toBe(false)
	})

	it("rejects a heredoc spanning more than two physical lines", () => {
		const heredoc = ["cat <<'EOF'", "line one", "line two", "EOF"].join("\n")
		expect(countCommandPhysicalLines(heredoc)).toBe(4)
		expect(isExecuteCommandOverPhysicalLineLimit(heredoc)).toBe(true)
	})

	it("returns 0 for empty or missing command", () => {
		expect(countCommandPhysicalLines("")).toBe(0)
		expect(countCommandPhysicalLines(undefined)).toBe(0)
		expect(countCommandPhysicalLines(null)).toBe(0)
		expect(isExecuteCommandOverPhysicalLineLimit("")).toBe(false)
	})

	it("builds a retryable tool error", () => {
		const message = getExecuteCommandPhysicalLineLimitError(3)
		expect(message).toContain("3 physical lines")
		expect(message).toContain(`limit ${MAX_EXECUTE_COMMAND_PHYSICAL_LINES}`)
		expect(message).toContain("Do not wait for approval or a terminal")
		expect(message).toContain("EXTRA/bash/")
	})
})
