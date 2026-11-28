import type OpenAI from "openai"

const BIND_TASK_PROGRESS_DESCRIPTION = `Bind native todos to an EXTRA/task Markdown checklist and project that file into native state. Call this once after the authoritative checklist exists. Do not pass checklist items through this tool; write them into EXTRA/task first.

Default: omit path (or pass null) to keep the current binding, or to discover the unique owned root checklist.

Rebind only in a multi-file EXTRA/task system: pass a different root pointer, a light file under EXTRA/task/<title>/, or the parent task file when native todos should follow that file instead.

When NOT to Use:
- Repeating the same binding after native todos already follow the file
- Inventing native checklist items instead of editing EXTRA/task Markdown
- A single trivial request that does not need a durable checklist`

const PATH_PARAMETER_DESCRIPTION =
	"Optional EXTRA/task Markdown path relative to the workspace. Pass null to keep or discover the current binding. Pass a different root or light file only to rebind native todos."

export default {
	type: "function",
	function: {
		name: "bind_task_progress",
		description: BIND_TASK_PROGRESS_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: ["string", "null"],
					description: PATH_PARAMETER_DESCRIPTION,
				},
			},
			required: ["path"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
