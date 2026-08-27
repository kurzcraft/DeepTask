import { z } from "zod"

/**
 * Parallel subagents & workspaces (kilocode_change - new file)
 *
 * Shared view types for the parallel orchestration feature: the fixed left
 * rail and the right slide-over panel in the chat UI, plus the workspace
 * registry used to prevent write conflicts between parallel agents.
 */

export const parallelSessionStatuses = ["running", "completed", "error", "cancelled"] as const
export const parallelSessionStatusSchema = z.enum(parallelSessionStatuses)
export type ParallelSessionStatus = z.infer<typeof parallelSessionStatusSchema>

export const parallelWorkspaceStatuses = ["available", "busy", "merged", "conflicted", "error"] as const
export const parallelWorkspaceStatusSchema = z.enum(parallelWorkspaceStatuses)
export type ParallelWorkspaceStatus = z.infer<typeof parallelWorkspaceStatusSchema>

/** A subagent session spawned by the dispatch_subagents tool. */
export const parallelSessionSchema = z.object({
	sessionId: z.string(),
	taskId: z.string(),
	parentTaskId: z.string(),
	label: z.string(),
	task: z.string(),
	status: parallelSessionStatusSchema,
	workspaceName: z.string().optional(),
	workspacePath: z.string().optional(),
	branch: z.string().optional(),
	startedAt: z.number(),
	endedAt: z.number().optional(),
	result: z.string().optional(),
	error: z.string().optional(),
})

export type ParallelSession = z.infer<typeof parallelSessionSchema>

/** Display name of a folder's default workspace (the main checkout). */
export const PARALLEL_MAIN_WORKSPACE = "main"

/** A registered git-worktree workspace used by parallel agents. */
export const parallelWorkspaceSchema = z.object({
	name: z.string(),
	path: z.string(),
	branch: z.string(),
	baseBranch: z.string(),
	status: parallelWorkspaceStatusSchema,
	owner: z.string().optional(),
	/** Parent sidebar folder this workspace belongs to (not a sibling folder). */
	folderPath: z.string().optional(),
	createdAt: z.number(),
	updatedAt: z.number(),
})

export type ParallelWorkspace = z.infer<typeof parallelWorkspaceSchema>

/**
 * A globally-registered folder shown in the chat sidebar. The list is stored
 * in global state, so every editor window shows the same folders.
 */
export const parallelFolderKinds = ["main", "worktree"] as const
export const parallelFolderKindSchema = z.enum(parallelFolderKinds)
export type ParallelFolderKind = z.infer<typeof parallelFolderKindSchema>

export const parallelFolderSchema = z.object({
	name: z.string(),
	path: z.string(),
	kind: parallelFolderKindSchema,
	createdAt: z.number(),
	archivedAt: z.number().optional(),
})

export type ParallelFolder = z.infer<typeof parallelFolderSchema>

/**
 * A user-facing conversation registered under a folder (kilocode_change).
 * Extra conversations run alongside the first one instead of replacing it;
 * `sessionId` binds the conversation to its Task once the first message is
 * sent (before that the conversation is a fresh, still-empty chat).
 */
export const parallelConversationSchema = z.object({
	id: z.string(),
	folderPath: z.string(),
	/** Workspace this conversation runs in; defaults to the folder (main). */
	workspacePath: z.string().optional(),
	title: z.string().optional(),
	sessionId: z.string().optional(),
	createdAt: z.number(),
	lastActiveAt: z.number(),
	archivedAt: z.number().optional(),
	/** Set when a green completion_result is persisted for this conversation. */
	completedAt: z.number().optional(),
})

export type ParallelConversation = z.infer<typeof parallelConversationSchema>
