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
			"If no authoritative EXTRA/task Markdown checklist exists, first inspect EXTRA/task and write/read that checklist, then call `bind_task_progress`.",
			"During checklist preparation, do not edit project files, execute commands, browse, or call attempt_completion.",
			"After the file is written and read back, call `bind_task_progress` once to bind native todos to that file. Call it again only to rebind a different root or light file.",
			"Add concrete new milestones to the EXTRA/task Markdown first (split into light files if a write would grow past 30 lines / 4 levels). Shrinks and status-only updates on an already-over-limit file are allowed. Native todos follow the bound file; do not invent extra native items.",
			"",
		].join("\n")
	}

	if (!todoList || todoList.length === 0) {
		return "Native todos are not bound yet. Write the EXTRA/task Markdown checklist first, then call `bind_task_progress` once. Call it again only to rebind a different root or light file."
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
		"IMPORTANT: Edit the bound EXTRA/task Markdown when status changes. Native todos follow that file. Call `bind_task_progress` again only to rebind a different root or light file.",
		"",
	)
	return lines.join("\n")
}
