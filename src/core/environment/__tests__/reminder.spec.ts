import { describe, it, expect } from "vitest"
import { formatReminderSection } from "../reminder"

describe("formatReminderSection", () => {
	it("forces progress expansion message for new-task continuations", () => {
		const text = formatReminderSection([], { requireProgressListExpansion: true })
		expect(text).toContain("CRITICAL: A new user instruction just arrived")
		expect(text).toContain("FIRST tool call must be `update_todo_list`")
		expect(text).not.toContain("You have not created a todo list yet")
	})
})
