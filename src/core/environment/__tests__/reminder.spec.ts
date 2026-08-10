import { describe, it, expect } from "vitest"
import { formatReminderSection } from "../reminder"

describe("formatReminderSection", () => {
	it("describes the verified file-before-native-sync sequence for new-task continuations", () => {
		const text = formatReminderSection([], { requireProgressListExpansion: true })
		expect(text).toContain("CRITICAL: A new user instruction just arrived")
		expect(text).toContain("first inspect EXTRA/task and write/read that checklist")
		expect(text).toContain("then call `update_todo_list`")
		expect(text).not.toContain("FIRST tool call must be `update_todo_list`")
		expect(text).not.toContain("You have not created a todo list yet")
	})

	it("preserves todo hierarchy in reminder content", () => {
		const text = formatReminderSection([
			{ id: "parent", content: "Parent", status: "in_progress" },
			{ id: "child", content: "Child", status: "pending", depth: 1 },
			{ id: "grandchild", content: "Grandchild", status: "pending", depth: 2 },
		])

		expect(text).toContain("| 1 | Parent | In Progress |")
		expect(text).toContain("| 2 |   ↳ Child | Pending |")
		expect(text).toContain("| 3 |     ↳ Grandchild | Pending |")
	})
})
