import type OpenAI from "openai"

const DESCRIPTION = `Dispatch self-contained subtasks as isolated subagents (THE default subtask tool — the new_task tool was removed). Each subagent is a full agent with its own conversation, integrated terminal, and file access; the parent BLOCKS until every dispatched subagent finishes, then receives all results. When the user says "subtask"/子任务 or wants ONE clean-context task (single independent review, isolated analysis), pass a single-element tasks array. Use a multi-element array (2+) only for genuinely independent subtasks that can run in parallel. A subagent may itself dispatch further subagents with dispatch_subagents (nesting is unbounded) when its own work decomposes into independent pieces. Workspace rule: every subagent gets its own isolated git workspace by DEFAULT — set needs_workspace:false ONLY for pure read-only tasks (analysis/review/search) so parallel reads stay light; decide by whether the subagent writes files. Per subtask: mode (optional, defaults to the parent's mode), provider_profile + model_id (optional, defaults to the parent's provider config), workspace:"<name>" to reuse an existing workspace (busy ones are forked automatically). Merge write-bearing workspace branches afterwards with workspace_merge.`

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
							mode: {
								type: ["string", "null"],
								description:
									"Mode slug for the subagent (e.g. 'code', 'ask', 'architect'); defaults to the parent's mode",
							},
							provider_profile: {
								type: ["string", "null"],
								description:
									"Provider profile name for the subagent; defaults to the parent's provider configuration",
							},
							model_id: {
								type: ["string", "null"],
								description:
									"Model ID to use within provider_profile; defaults to the profile's saved model",
							},
						needs_workspace: {
							type: ["boolean", "null"],
							description:
								"DEFAULT TRUE: every subagent gets an isolated git workspace. Set false ONLY for pure read-only tasks (analysis/review/search) so parallel reads stay light",
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
