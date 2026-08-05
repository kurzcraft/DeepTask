// kilocode_change - new file

import type { VscGenerationRequest } from "./vscode"

export interface CommitMessageRequest {
	workspacePath: string
	selectedFiles?: string[]
	// Preserve the SCM object supplied by VS Code when the command is clicked
	// from the source-control input/title menu.
	vscodeTarget?: VscGenerationRequest
}

export interface CommitMessageResult {
	message: string
	error?: string
}

export interface GenerateMessageParams {
	workspacePath: string
	selectedFiles: string[]
	gitContext: string
	onProgress?: (progress: ProgressUpdate) => void
	abortSignal?: AbortSignal // kilocode_change
}

export interface PromptOptions {
	customSupportPrompts?: Record<string, string>
	previousContext?: string
	previousMessage?: string
}

export interface ProgressUpdate {
	message?: string
	percentage?: number
	increment?: number
}

export interface ProgressTask<T> {
	execute: (progress: ProgressReporter) => Promise<T>
	title: string
	location: ProgressLocation
	cancellable?: boolean
}

export interface ProgressReporter {
	report(value: { message?: string; increment?: number }): void
}

export type MessageType = "info" | "error" | "warning"

export type ProgressLocation = "SourceControl" | "Notification" | "Window"
