import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "workspace_create",
		description:
			"Create an isolated git workspace (worktree on its own branch from the current folder). This conversation is moved into the new worktree and claimed until merged with workspace_merge.",
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
