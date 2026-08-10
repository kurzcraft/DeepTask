import { TodoItem, TodoStatus } from "@roo-code/types"

/**
 * Format the reminders section as a markdown block in English, with basic instructions.
 */
export function formatReminderSection(
	todoList?: TodoItem[],
	options?: { requireProgressListExpansion?: boolean },
): string {
	if (options?.requireProgressListExpansion) {
		return [
			"====",
			"",
			"REMINDERS",
			"",
			"CRITICAL: A new user instruction just arrived. Do NOT restate or summarize previously completed work.",
			"If no authoritative EXTRA/task Markdown checklist exists, first inspect EXTRA/task and write/read that checklist, then call `update_todo_list`.",
			"During checklist preparation, do not edit project files, execute commands, browse, or call attempt_completion.",
			"After the file is written and read back, call `update_todo_list` to project the verified checklist into native state before real work.",
			"Discard finished old milestones, add concrete new milestones, mark the first new actionable item in_progress, then begin real tool work.",
			"",
		].join("\n")
	}

	if (!todoList || todoList.length === 0) {
		return "You have not created a todo list yet. Create one with `update_todo_list` if your task is complicated or involves multiple steps."
	}
	const statusMap: Record<TodoStatus, string> = {
		pending: "Pending",
		in_progress: "In Progress",
		completed: "Completed",
	}
	const lines: string[] = [
		"====",
		"",
		"REMINDERS",
		"",
		"Below is your current list of reminders for this task. Keep them updated as you progress.",
		"",
	]

	lines.push("| # | Content | Status |")
	lines.push("|---|---------|--------|")
	todoList.forEach((item, idx) => {
		const depthPrefix = item.depth ? `${"  ".repeat(item.depth)}↳ ` : ""
		const escapedContent = `${depthPrefix}${item.content}`.replace(/\\/g, "\\\\").replace(/\|/g, "\\|")
		lines.push(`| ${idx + 1} | ${escapedContent} | ${statusMap[item.status] || item.status} |`)
	})
	lines.push("")

	lines.push(
		"",
		"IMPORTANT: When task status changes, remember to call the `update_todo_list` tool to update your progress.",
		"",
	)
	return lines.join("\n")
}
