import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "workspace_merge",
		description:
			"Merge a parallel workspace branch back into the main branch. Auto-commits pending workspace changes; never dirties the user's checkout (merges through a temporary worktree when needed). On conflict the merge aborts and returns the conflicted files — resolve them inside the workspace worktree, commit, and retry.",
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "The workspace name to merge",
				},
				delete_after: {
					type: ["boolean", "null"],
					description: "Remove the workspace worktree after a successful merge (branch is kept)",
				},
			},
			required: ["name"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
