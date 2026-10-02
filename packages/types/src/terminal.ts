import { z } from "zod"

/**
 * CommandExecutionStatus
 */

export const commandExecutionStatusSchema = z.discriminatedUnion("status", [
	z.object({
		executionId: z.string(),
		status: z.literal("started"),
		pid: z.number().optional(),
		command: z.string(),
		// kilocode_change: owning task id so the webview can ignore events from
		// background conversations (cross-conversation button crosstalk).
		taskId: z.string().optional(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("output"),
		output: z.string(),
		// kilocode_change: owning task id (see "started" variant).
		taskId: z.string().optional(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("exited"),
		exitCode: z.number().optional(),
		// kilocode_change: owning task id (see "started" variant).
		taskId: z.string().optional(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("fallback"),
		// kilocode_change: owning task id (see "started" variant).
		taskId: z.string().optional(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("timeout"),
		// kilocode_change: owning task id (see "started" variant).
		taskId: z.string().optional(),
	}),
])

export type CommandExecutionStatus = z.infer<typeof commandExecutionStatusSchema>
