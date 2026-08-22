import type OpenAI from "openai"

const DESCRIPTION = `Run several self-contained subtasks in PARALLEL as isolated subagents. Each subagent is a full agent with its own conversation, integrated terminal, and file access. The main task BLOCKS until every subagent finishes, then receives all of their results. Set needs_workspace=true for subagents that write files (they get an isolated git worktree branch). If workspace:"<name>" is already occupied, a sibling worktree is created automatically. Afterwards merge workspace branches into the main branch with workspace_merge.`

export default {
	type: "function",
	function: {
		name: "dispatch_subagents",
		description: DESCRIPTION,
		parameters: {
			type: "object",
			properties: {
				tasks: {
					type: "array",
					minItems: 1,
					maxItems: 5,
					description: "Subagent specs to run in parallel",
					items: {
						type: "object",
						properties: {
							task: {
								type: "string",
								description: "Complete, self-contained instructions including all needed context",
							},
							label: {
								type: ["string", "null"],
								description: "Short display name for the subagent",
							},
							needs_workspace: {
								type: ["boolean", "null"],
								description:
									"Set true when the subagent writes files; gives it an isolated git workspace",
							},
							workspace: {
								type: ["string", "null"],
								description:
									"Name of an existing workspace to run in; a busy workspace is forked automatically",
							},
						},
						required: ["task"],
						additionalProperties: false,
					},
				},
			},
			required: ["tasks"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
