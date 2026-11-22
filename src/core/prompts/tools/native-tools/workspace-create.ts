import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "workspace_create",
		description:
			"Create an isolated git workspace (worktree on its own branch from the current folder) for write-heavy work that must not share this cwd. Calling this MOVES the current conversation. Do not call it merely because another conversation also uses this cwd; occupancy isolation already relocates later conversations.",
		parameters: {
			type: "object",
			properties: {
				name: {
					type: ["string", "null"],
					description: "Short workspace name; auto-generated from task_description when omitted",
				},
				task_description: {
					type: ["string", "null"],
					description: "What the workspace will be used for",
				},
			},
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
