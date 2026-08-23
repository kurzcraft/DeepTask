import type OpenAI from "openai"

export default {
	type: "function",
	function: {
		name: "workspace_merge",
		description:
			"The only workspace change tool. Merge a parallel workspace branch back into the main branch, optionally switch this conversation to another path first, and optionally delete the old worktree. The current conversation may leave a workspace it occupies. Auto-commits pending workspace changes; never dirties the user's checkout. On conflict the merge aborts and returns the conflicted files.",
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Workspace name or path to merge. Use the current worktree name when leaving it.",
				},
				delete_after: {
					type: ["boolean", "null"],
					description: "Remove the workspace worktree after a successful merge (branch is kept)",
				},
				switch_to: {
					type: ["string", "null"],
					description:
						'Optional destination for this conversation before merge. Use "main" for the parent repo, or another workspace name/path.',
				},
			},
			required: ["name"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
