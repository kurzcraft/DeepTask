// kilocode_change - new file
import * as vscode from "vscode"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { t } from "../../i18n"

import { CommitMessageRequest, CommitMessageResult } from "./types/core"
import { CommitMessageGenerator } from "./CommitMessageGenerator"
import { VSCodeCommitMessageAdapter } from "./adapters/VSCodeCommitMessageAdapter"
import { JetBrainsCommitMessageAdapter } from "./adapters/JetBrainsCommitMessageAdapter"
import { VscGenerationRequest } from "./types"
import { JetbrainsGenerationRequest } from "./types/jetbrains"

/**
 * Orchestrates commit message generation by routing requests to appropriate adapters.
 * This class handles command registration and coordinates between VSCode and JetBrains adapters.
 */
export class CommitMessageProvider implements vscode.Disposable {
	private generator: CommitMessageGenerator
	private vscodeAdapter: VSCodeCommitMessageAdapter
	private jetbrainsAdapter: JetBrainsCommitMessageAdapter

	constructor(
		private context: vscode.ExtensionContext,
		private outputChannel: vscode.OutputChannel,
	) {
		const providerSettingsManager = new ProviderSettingsManager(this.context)

		this.generator = new CommitMessageGenerator(providerSettingsManager)
		this.vscodeAdapter = new VSCodeCommitMessageAdapter(this.generator)
		this.jetbrainsAdapter = new JetBrainsCommitMessageAdapter(this.generator)
	}

	/**
	 * Activate the commit message service by registering commands.
	 */
	public async activate(): Promise<void> {
		this.outputChannel.appendLine(t("kilocode:commitMessage.activated"))

		const disposables = [
			vscode.commands.registerCommand("deeptask.vsc.generateCommitMessage", (...args: unknown[]) =>
				this.handleVSCodeCommand(args),
			),
			vscode.commands.registerCommand("kilo-code.vsc.generateCommitMessage", (...args: unknown[]) =>
				this.handleVSCodeCommand(args),
			),
			vscode.commands.registerCommand(
				"kilo-code.jetbrains.generateCommitMessage",
				(...args: JetbrainsGenerationRequest): Promise<CommitMessageResult> => {
					return this.handleJetBrainsCommand(...args)
				},
			),
		]
		this.context.subscriptions.push(...disposables)
	}

	/**
	 * Handle VSCode-specific command by converting VSCode inputs to generic request.
	 * SCM menus pass either a SourceControl or SourceControlInput object. Preserve
	 * that object so the generated message is written into the input box that was
	 * actually clicked instead of a newly guessed repository.
	 */
	private async handleVSCodeCommand(args: unknown[] = []): Promise<void> {
		try {
			this.outputChannel.appendLine(`[CommitMessage] SCM command invoked (${args.length} argument(s))`)
			const scmTarget = this.findVscodeTarget(args)
			const request: CommitMessageRequest = {
				workspacePath: this.determineWorkspacePath(scmTarget?.rootUri),
				vscodeTarget: scmTarget,
			}

			await this.vscodeAdapter.generateCommitMessage(request)
		} catch (error) {
			// kilocode_change start: command handlers must never reject invisibly.
			const errorMessage = error instanceof Error ? error.message : String(error)
			this.outputChannel.appendLine(`[CommitMessage] ${errorMessage}`)
			await vscode.window.showErrorMessage(t("kilocode:commitMessage.generationFailed", { errorMessage }))
			// kilocode_change end
		}
	}

	/**
	 * Handle JetBrains-specific command by creating request from provided args.
	 */
	private async handleJetBrainsCommand(...args: JetbrainsGenerationRequest): Promise<CommitMessageResult> {
		// JetBrains sends args as a nested array: [[workspacePath, selectedFiles]]
		const [workspacePath, selectedFiles] = args[0]
		const request = { workspacePath, selectedFiles }

		return this.jetbrainsAdapter.generateCommitMessage(request)
	}

	private findVscodeTarget(values: unknown[]): VscGenerationRequest | undefined {
		const pending = [...values]
		const visited = new Set<object>()

		while (pending.length > 0) {
			const value = pending.shift()
			const target = this.normalizeVscodeTarget(value)
			if (target) {
				return target
			}
			if (Array.isArray(value)) {
				pending.unshift(...value)
			}
			if (value && typeof value === "object" && !Array.isArray(value)) {
				const object = value as Record<string, unknown>
				if (visited.has(object)) {
					continue
				}
				visited.add(object)
				for (const key of ["inputBox", "sourceControl", "repository", "repositories"]) {
					const nested = object[key]
					if (nested !== undefined) {
						pending.push(nested)
					}
				}
			}
		}
		return undefined
	}

	private normalizeVscodeTarget(value: unknown): VscGenerationRequest | undefined {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return undefined
		}

		const candidate = value as VscGenerationRequest & {
			value?: string
			inputBox?: { value: string }
			repository?: { rootUri?: vscode.Uri; inputBox?: { value: string } }
			repositories?: Array<{ rootUri?: vscode.Uri; inputBox?: { value: string } }>
			sourceControl?: { rootUri?: vscode.Uri; inputBox?: { value: string } }
		}
		const repository = candidate.repository ?? candidate.repositories?.[0] ?? candidate.sourceControl
		const inputBox =
			candidate.inputBox ??
			repository?.inputBox ??
			(typeof candidate.value === "string" ? candidate : undefined)
		if (!inputBox || typeof inputBox.value !== "string") {
			return undefined
		}

		return {
			inputBox,
			rootUri: candidate.rootUri ?? repository?.rootUri,
		}
	}

	/**
	 * Determine the workspace path from the provided URI or current workspace.
	 */
	private determineWorkspacePath(resourceUri?: vscode.Uri): string {
		if (resourceUri) {
			return resourceUri.fsPath
		}

		// Fallback to current workspace
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (workspaceFolders && workspaceFolders.length > 0) {
			return workspaceFolders[0].uri.fsPath
		}

		throw new Error("Could not determine workspace path")
	}

	/**
	 * Dispose resources and cleanup.
	 */
	public dispose(): void {
		this.vscodeAdapter?.dispose()
		this.jetbrainsAdapter?.dispose()
	}
}
