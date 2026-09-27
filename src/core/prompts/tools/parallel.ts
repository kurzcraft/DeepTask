/**
 * Tool descriptions for parallel subagents & workspaces (kilocode_change - new files)
 */

export function getDispatchSubagentsDescription(enabled: boolean | undefined): string | undefined {
	if (enabled === false) {
		return undefined
	}
	return `## dispatch_subagents
Description: Dispatch self-contained subtasks as isolated subagents — this is THE default subtask tool (the new_task tool was removed in 9.2.4). Each subagent is a full agent with its own conversation, integrated terminal, and file access; the parent task BLOCKS until every dispatched subagent finishes, then receives all of their results at once. When the user says "subtask"/子任务 or wants a SINGLE clean-context task (one independent review, one isolated analysis), pass a single-element tasks array — that is the default path. Use a multi-element array (2+) only for genuinely independent chunks of work (e.g., "implement feature A" + "write tests for B" + "investigate C") that can run simultaneously. A subagent may itself dispatch further subagents with dispatch_subagents (nesting is unbounded) when its own work decomposes into independent pieces.

Workspace rules (write-conflict prevention):
- Every subagent gets its own isolated git workspace by DEFAULT (a fresh git worktree branch) — you do NOT need to set anything when the subagent writes files.
- Only for pure READ-ONLY tasks (analysis, review, search) set "needs_workspace": false — the subagent then runs in the parent workspace with no worktree. This is how parallel read tasks stay light.
- Decide by whether the subagent will WRITE files: writes → default (workspace); pure reads → needs_workspace:false.
	- To reuse an existing workspace by name, set "workspace": "<name>". If that workspace is already occupied, a sibling git worktree is created automatically so two writers never share a directory.
- After all subagents finish, merge their workspace branches into the main branch yourself with workspace_merge (resolve reported conflicts in the workspace worktree first, then retry the merge).

Parameters:
- tasks: (required) JSON array of subagent specs (single-element array for one subtask — the default), each object:
  - task: (required) Complete, self-contained instructions for the subagent. Include all needed context — subagents cannot see this conversation.
  - label: (optional) Short display name.
  - mode: (optional) Mode slug for the subagent (e.g. "code", "ask", "architect"); defaults to the parent's mode.
  - provider_profile: (optional) Provider profile name for the subagent; defaults to the parent's provider configuration.
  - model_id: (optional) Model ID within provider_profile; defaults to the profile's saved model.
  - needs_workspace: (optional, default TRUE) Every subagent gets a fresh isolated git workspace by default. Set FALSE only for pure read-only tasks (analysis/review/search) so parallel reads stay light.
	  - workspace: (optional) Name of an existing workspace to run in; a busy workspace is forked automatically.

Usage:
<dispatch_subagents>
<tasks>
[
  {"task": "Implement X end to end, run tests, and summarize", "label": "impl-x", "needs_workspace": true},
  {"task": "Read src/a.ts and report the public API", "label": "audit-a"}
]
</tasks>
</dispatch_subagents>`
}

export function getWorkspaceStatusDescription(enabled: boolean | undefined): string | undefined {
	if (enabled === false) {
		return undefined
	}
	return `## workspace_status
	Description: List all parallel agent workspaces with their status (available / busy / merged / conflicted), git branch, dirty files, occupancy by conversations/subagents, and how far each is ahead of the main branch. ALWAYS call this before dispatching a subagent into an existing workspace or merging. Occupied directories are isolated automatically by creating a sibling worktree.

Parameters: none

Usage:
<workspace_status>
</workspace_status>`
}

export function getWorkspaceCreateDescription(enabled: boolean | undefined): string | undefined {
	if (enabled === false) {
		return undefined
	}
	return `## workspace_create
	Description: Create a new isolated git workspace (a git worktree on its own branch based on the current folder) that this conversation and its subagents can safely write to. The creating task is switched into that worktree and the left-rail conversation moves with it. The workspace is claimed until you merge it.

Parameters:
- name: (optional) Short workspace name; auto-generated from the description when omitted.
- task_description: (optional) What the workspace will be used for (used for the default name).

Usage:
<workspace_create>
<name>refactor-auth</name>
<task_description>Refactor the auth module</task_description>
</workspace_create>`
}

export function getWorkspaceMergeDescription(enabled: boolean | undefined): string | undefined {
	if (enabled === false) {
		return undefined
	}
	return `## workspace_merge
Description: The only workspace change tool. Merge a parallel workspace's branch back into the main branch, optionally switch this conversation first, and optionally delete the old worktree. The current conversation may leave a workspace it occupies. Pending changes are auto-committed first. The user's checkout is never dirtied. On conflict the merge aborts and returns the conflicted files.

Parameters:
- name: (required) Workspace name or path to merge.
- delete_after: (optional, default false) Remove the workspace worktree after a successful merge (the branch is kept).
- switch_to: (optional) Move this conversation first. Use "main" for the parent repo, or another workspace name/path. Valid targets ONLY: "main", a registered workspace name, or an existing absolute path. Never pass literal "null"; omit the parameter instead.

Usage:
<workspace_merge>
<name>refactor-auth</name>
<switch_to>main</switch_to>
<delete_after>true</delete_after>
</workspace_merge>`
}
