import { ToolArgs } from "./types"

/**
 * Get the description for the bind_task_progress tool.
 */
export function getUpdateTodoListDescription(args?: ToolArgs): string {
	return `## bind_task_progress

**Description:**
Bind native todos to an EXTRA/task Markdown checklist and project that file into native state. Do not pass checklist items through this tool; write them into EXTRA/task first, then bind.

This tool is usually called **once** per conversation, after the authoritative checklist exists. Native todos then follow file events. Call it again only to rebind:

- a light file under \`EXTRA/task/<title>/\` when native todos should follow that subtask file
- the parent/root EXTRA/task pointer when native todos should follow the parent checklist again

**Parameters:**
- path: (optional) EXTRA/task Markdown path relative to the workspace. Omit it to keep the current binding, or to discover the unique owned root checklist. Pass a different root or light file only to rebind.

**Usage Example:**
<bind_task_progress>
</bind_task_progress>

*Rebind native todos to a light file in a multi-file checklist:*
<bind_task_progress>
<path>EXTRA/task/my-task/light-file.md</path>
</bind_task_progress>

**When to Use:**
- After the EXTRA/task Markdown checklist has been written and read back
- When native todos should follow a different root or light file in a split checklist

**When NOT to Use:**
- Repeating the same binding after native todos already follow the file
- Inventing native checklist items instead of editing EXTRA/task Markdown
- A single trivial request that does not need a durable checklist
`
}
