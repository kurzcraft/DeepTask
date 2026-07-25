// kilocode_change - new file
import * as vscode from "vscode"
import { ICommitMessageAdapter } from "./ICommitMessageAdapter"
import { ICommitMessageIntegration } from "./ICommitMessageIntegration"
import { CommitMessageRequest, CommitMessageResult, MessageType, ProgressReporter } from "../types/core"
import { VscGenerationRequest, VSCodeMessageTypeMap } from "../types/vscode"
import { t } from "../../../i18n"
import { CommitMessageGenerator } from "../CommitMessageGenerator"
import { CommitMessageOrchestrator } from "../CommitMessageOrchestrator"

export class VSCodeCommitMessageAdapter implements ICommitMessageAdapter {
	private targetRepository: VscGenerationRequest | null = null
	private orchestrator: CommitMessageOrchestrator
	private activeGeneration?: AbortController // kilocode_change

	constructor(private messageGenerator: CommitMessageGenerator) {
		this.orchestrator = new CommitMessageOrchestrator()
	}

	async generateCommitMessage(request: CommitMessageRequest): Promise<CommitMessageResult> {
		// kilocode_change start
		// Supersede an earlier click. This prevents concurrent AI calls and, more
		// importantly, prevents an old late response from replacing the newest commit
		// message in the SCM input box.
		this.activeGeneration?.abort()
		const generation = new AbortController()
		this.activeGeneration = generation
		// kilocode_change end
		try {
			const targetRepository = await this.determineTargetRepository(request.workspacePath)
			if (!targetRepository?.rootUri) {
				throw new Error("Could not determine Git repository")
			}
			this.targetRepository = targetRepository

			return await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.SourceControl,
					title: t("kilocode:commitMessage.generating"),
					cancellable: true,
				},
				async (progress, cancellationToken) => {
					const cancellationDisposable = cancellationToken.onCancellationRequested(() => generation.abort())
					const integration: ICommitMessageIntegration = {
						abortSignal: generation.signal,
						reportProgress: (percentage: number, message?: string) => {
							progress.report({
								increment: Math.max(0, percentage - (progress as any)._lastPercentage || 0),
								message: message || t("kilocode:commitMessage.generating"),
							})
							;(progress as any)._lastPercentage = percentage
						},

						showMessage: async (message: string, type: MessageType) => {
							const methodName = VSCodeMessageTypeMap[type]
							const method = vscode.window[methodName] as (
								message: string,
							) => Thenable<string | undefined>
							await method(message)
						},

						handleResult: async (result: CommitMessageResult) => {
							if (generation.signal.aborted || this.activeGeneration !== generation) {
								return
							}
							if (result.message && targetRepository) {
								targetRepository.inputBox.value = result.message
							}
							if (result.error) {
								const methodName = VSCodeMessageTypeMap["error"]
								const method = vscode.window[methodName] as (
									message: string,
								) => Thenable<string | undefined>
								await method(
									t("kilocode:commitMessage.generationFailed", { errorMessage: result.error }),
								)
							}
						},
					}

					try {
						return await this.orchestrator.generateCommitMessage(
							request,
							integration,
							this.messageGenerator,
						)
					} finally {
						cancellationDisposable.dispose()
					}
				},
			)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
			if (!generation.signal.aborted) {
				await vscode.window.showErrorMessage(t("kilocode:commitMessage.generationFailed", { errorMessage }))
			}
			return { message: "", error: errorMessage }
		} finally {
			if (this.activeGeneration === generation) {
				this.activeGeneration = undefined
			}
		}
	}

	private async determineTargetRepository(workspacePath: string): Promise<VscGenerationRequest | null> {
		try {
			const gitExtension = vscode.extensions.getExtension("vscode.git")
			if (!gitExtension) {
				return null
			}

			if (!gitExtension.isActive) {
				try {
					await gitExtension.activate()
				} catch (activationError) {
					return null
				}
			}

			const gitApi = gitExtension.exports.getAPI(1)
			if (!gitApi) {
				return null
			}

			for (const repo of gitApi.repositories ?? []) {
				if (repo.rootUri && workspacePath.startsWith(repo.rootUri.fsPath)) {
					return repo
				}
			}

			return gitApi.repositories[0] ?? null
		} catch (error) {
			return null
		}
	}

	public dispose(): void {
		this.activeGeneration?.abort()
		this.activeGeneration = undefined
		this.targetRepository = null
	}
}
