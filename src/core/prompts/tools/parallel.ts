/**
 * Tool descriptions for parallel subagents & workspaces (kilocode_change - new files)
 */

export function getDispatchSubagentsDescription(enabled: boolean | undefined): string | undefined {
	if (enabled === false) {
		return undefined
	}
	return `## dispatch_subagents
Description: Run several self-contained subtasks in PARALLEL as isolated subagents. Each subagent is a full agent with its own conversation, integrated terminal, and file access. The main task BLOCKS until every subagent finishes, then receives all of their results at once. Use this for independent chunks of work (e.g., "implement feature A" + "write tests for B" + "investigate C") that do not need to coordinate with each other.

Workspace rules (write-conflict prevention):
- A subagent that WRITES files should get its own isolated git workspace: set "needs_workspace": true. It then works on its own branch in a git worktree — no conflicts with other agents or the main checkout.
- A subagent that only reads/analyzes should run without a workspace (omit the flag) to keep things light.
	- To reuse an existing workspace by name, set "workspace": "<name>". If that workspace is already occupied, a sibling git worktree is created automatically so two writers never share a directory.
- After all subagents finish, merge their workspace branches into the main branch yourself with workspace_merge (resolve reported conflicts in the workspace worktree first, then retry the merge).

Parameters:
- tasks: (required) JSON array of subagent specs, each object:
  - task: (required) Complete, self-contained instructions for the subagent. Include all needed context — subagents cannot see this conversation.
  - label: (optional) Short display name.
  - needs_workspace: (optional, default false) Set true when the subagent will write files; it gets a fresh isolated git workspace.
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
Description: Merge a parallel workspace's branch back into the main branch. Pending changes in the workspace are auto-committed first. The user's checked-out working copy is never dirtied: when the main branch is not checked out (or is dirty) the merge happens through a temporary worktree. On conflict the merge is aborted cleanly and the conflicted file list is returned — resolve the conflicts INSIDE the workspace worktree, commit there, then call workspace_merge again. Do not merge a workspace while it is busy.

Parameters:
- name: (required) The workspace name to merge.
- delete_after: (optional, default false) Remove the workspace worktree after a successful merge (the branch is kept).

Usage:
<workspace_merge>
<name>refactor-auth</name>
</workspace_merge>`
}
