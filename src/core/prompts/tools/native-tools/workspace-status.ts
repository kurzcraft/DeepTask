import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "workspace_status",
		description:
			"List all parallel agent workspaces with status, occupancy (conversations, subagents, busy claims), branch, dirty files, and commits ahead of the main branch. Always call before reusing an existing workspace or merging.",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
