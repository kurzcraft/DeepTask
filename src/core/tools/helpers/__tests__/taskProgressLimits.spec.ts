// npx vitest run src/core/tools/helpers/__tests__/taskProgressLimits.spec.ts

import { describe, expect, it } from "vitest"
import {
	countPhysicalLines,
	countTaskProgressNestingLevels,
	getTaskProgressWriteLimitError,
	isActiveTaskProgressMarkdownPath,
	isTaskProgressWriteGrowingOverflow,
	MAX_TASK_PROGRESS_NESTING_LEVELS,
	MAX_TASK_PROGRESS_PHYSICAL_LINES,
} from "../taskProgressLimits"

function lines(count: number, prefix = "item"): string {
	return Array.from({ length: count }, (_, i) => `- [ ] ${prefix} ${i + 1}`).join("\n")
}

describe("countPhysicalLines", () => {
	it("does not count a trailing newline as an extra line", () => {
		expect(countPhysicalLines("a\n")).toBe(1)
		expect(countPhysicalLines(lines(30) + "\n")).toBe(30)
	})

	it("counts interior blank lines", () => {
		expect(countPhysicalLines("a\n\nb")).toBe(3)
	})
})

describe("countTaskProgressNestingLevels", () => {
	it("counts a top-level item as level 1", () => {
		expect(countTaskProgressNestingLevels("- [ ] root")).toBe(1)
	})

	it("counts four-space children as deeper levels", () => {
		const content = ["- [ ] root", "    - [-] child", "        - [ ] grandchild", "            - [x] great"].join(
			"\n",
		)
		expect(countTaskProgressNestingLevels(content)).toBe(4)
	})

	it("rejects a fifth nesting level", () => {
		const content = [
			"- [ ] a",
			"    - [ ] b",
			"        - [ ] c",
			"            - [ ] d",
			"                - [ ] e",
		].join("\n")
		expect(countTaskProgressNestingLevels(content)).toBe(5)
	})
})

describe("isActiveTaskProgressMarkdownPath", () => {
	it("matches EXTRA/task markdown and nested light files", () => {
		expect(isActiveTaskProgressMarkdownPath("/ws", "EXTRA/task/ROOT.md")).toBe(true)
		expect(isActiveTaskProgressMarkdownPath("/ws", "EXTRA/task/title/light.md")).toBe(true)
	})

	it("ignores archives, non-markdown, and project files", () => {
		expect(isActiveTaskProgressMarkdownPath("/ws", "EXTRA/task/finished/OLD.md")).toBe(false)
		expect(isActiveTaskProgressMarkdownPath("/ws", "EXTRA/task/notes.txt")).toBe(false)
		expect(isActiveTaskProgressMarkdownPath("/ws", "src/core/task/Task.ts")).toBe(false)
	})
})

describe("isTaskProgressWriteGrowingOverflow", () => {
	it("allows a new 30-line file", () => {
		expect(
			isTaskProgressWriteGrowingOverflow({
				proposedContent: lines(MAX_TASK_PROGRESS_PHYSICAL_LINES),
				existingContent: null,
			}),
		).toBe(false)
	})

	it("rejects creating a 31-line file", () => {
		expect(
			isTaskProgressWriteGrowingOverflow({
				proposedContent: lines(31),
				existingContent: null,
			}),
		).toBe(true)
	})

	it("rejects growing an already-over-limit file", () => {
		expect(
			isTaskProgressWriteGrowingOverflow({
				proposedContent: lines(42),
				existingContent: lines(41),
			}),
		).toBe(true)
	})

	it("allows shrinking an already-over-limit file even while still over 30", () => {
		expect(
			isTaskProgressWriteGrowingOverflow({
				proposedContent: lines(35),
				existingContent: lines(41),
			}),
		).toBe(false)
	})

	it("allows a status-only rewrite of an already-over-limit file", () => {
		const existing = lines(41)
		const proposed = existing.replace("- [ ] item 1", "- [x] item 1")
		expect(
			isTaskProgressWriteGrowingOverflow({
				proposedContent: proposed,
				existingContent: existing,
			}),
		).toBe(false)
	})

	it("rejects deepening nesting past 4 levels", () => {
		const existing = ["- [ ] a", "    - [ ] b", "        - [ ] c", "            - [ ] d"].join("\n")
		const proposed = `${existing}\n                - [ ] e`
		expect(countTaskProgressNestingLevels(proposed)).toBe(5)
		expect(
			isTaskProgressWriteGrowingOverflow({
				proposedContent: proposed,
				existingContent: existing,
			}),
		).toBe(true)
	})
})

describe("getTaskProgressWriteLimitError", () => {
	it("tells the model to split instead of appending", () => {
		const message = getTaskProgressWriteLimitError({
			relPath: "EXTRA/task/ROOT.md",
			proposedContent: lines(31),
			existingContent: null,
		})
		expect(message).toContain("31 physical lines")
		expect(message).toContain(`limit ${MAX_TASK_PROGRESS_PHYSICAL_LINES} lines / ${MAX_TASK_PROGRESS_NESTING_LEVELS} levels`)
		expect(message).toContain("Split into EXTRA/task/<short-title>/")
		expect(message).toContain("Shrinks and status-only updates")
	})

	it("returns undefined for a shrink that remains over the cap", () => {
		expect(
			getTaskProgressWriteLimitError({
				relPath: "EXTRA/task/ROOT.md",
				proposedContent: lines(35),
				existingContent: lines(41),
			}),
		).toBeUndefined()
	})
})
