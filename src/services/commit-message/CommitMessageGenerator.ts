import { ContextProxy } from "../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { singleCompletionHandler } from "../../utils/single-completion-handler"
import { supportPrompt } from "../../shared/support-prompt"
import { addCustomInstructions } from "../../core/prompts/sections/custom-instructions"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName, type ProviderSettings } from "@roo-code/types"

import { GenerateMessageParams, PromptOptions, ProgressUpdate } from "./types/core"

/**
 * Pure commit message generation logic without IDE-specific dependencies.
 */
const COMMIT_AI_TIMEOUT_MS = 75_000 // kilocode_change

export class CommitMessageGenerator {
	private readonly providerSettingsManager: ProviderSettingsManager
	private previousGitContext: string | null = null
	private previousCommitMessage: string | null = null

	constructor(providerSettingsManager: ProviderSettingsManager) {
		this.providerSettingsManager = providerSettingsManager
	}

	async generateMessage(params: GenerateMessageParams): Promise<string> {
		const { gitContext, onProgress, abortSignal } = params

		try {
			onProgress?.({
				message: "Generating commit message...",
				percentage: 75,
			})

			const generatedMessage = await this.callAIForCommitMessage(gitContext, onProgress, abortSignal)

			this.previousGitContext = gitContext
			this.previousCommitMessage = generatedMessage

			TelemetryService.instance.captureEvent(TelemetryEventName.COMMIT_MSG_GENERATED)

			onProgress?.({
				message: "Commit message generated successfully",
				percentage: 100,
			})

			return generatedMessage
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
			throw new Error(`Failed to generate commit message: ${errorMessage}`)
		}
	}

	async buildPrompt(gitContext: string, options: PromptOptions): Promise<string> {
		const { customSupportPrompts = {}, previousContext, previousMessage } = options

		const customInstructions = await addCustomInstructions("", "", "", "commit", {
			language: "zh-CN",
			localRulesToggleState: undefined,
			globalRulesToggleState: undefined,
		})

		const shouldGenerateDifferentMessage =
			(previousContext === gitContext || this.previousGitContext === gitContext) &&
			(previousMessage !== null || this.previousCommitMessage !== null)

		const targetPreviousMessage = previousMessage || this.previousCommitMessage

		if (shouldGenerateDifferentMessage && targetPreviousMessage) {
			const differentMessagePrefix = `# CRITICAL INSTRUCTION: GENERATE A COMPLETELY DIFFERENT COMMIT MESSAGE
The user has requested a new commit message for the same changes.
The previous message was: "${targetPreviousMessage}"
YOU MUST create a message that is COMPLETELY DIFFERENT by:
- Using entirely different wording and phrasing
- Focusing on different aspects of the changes
- Using a different structure or format if appropriate
- Possibly using a different type or scope if justifiable
This is the MOST IMPORTANT requirement for this task.

`
			const baseTemplate = supportPrompt.get(customSupportPrompts, "COMMIT_MESSAGE")
			const modifiedTemplate =
				differentMessagePrefix +
				baseTemplate +
				`

FINAL REMINDER: Your message MUST be COMPLETELY DIFFERENT from the previous message: "${targetPreviousMessage}". This is a critical requirement.`

			return supportPrompt.create(
				"COMMIT_MESSAGE",
				{
					gitContext,
					customInstructions: customInstructions || "",
				},
				{
					...customSupportPrompts,
					COMMIT_MESSAGE: modifiedTemplate,
				},
			)
		} else {
			return supportPrompt.create(
				"COMMIT_MESSAGE",
				{
					gitContext,
					customInstructions: customInstructions || "",
				},
				customSupportPrompts,
			)
		}
	}

	private async callAIForCommitMessage(
		gitContextString: string,
		onProgress?: (progress: ProgressUpdate) => void,
		abortSignal?: AbortSignal,
	): Promise<string> {
		const contextProxy = ContextProxy.instance
		if (!contextProxy.isInitialized) {
			throw new Error("ContextProxy not initialized. Please try again after the extension has fully loaded.")
		}
		const apiConfiguration = contextProxy.getProviderSettings()
		const commitMessageApiConfigId = contextProxy.getValue("commitMessageApiConfigId")
		const listApiConfigMeta = contextProxy.getValue("listApiConfigMeta") || []
		const customSupportPrompts = contextProxy.getValue("customSupportPrompts") || {}

		let configToUse: ProviderSettings = apiConfiguration

		if (
			commitMessageApiConfigId &&
			listApiConfigMeta.find(({ id }: { id: string }) => id === commitMessageApiConfigId)
		) {
			try {
				await this.providerSettingsManager.initialize()
				const { name: _, ...providerSettings } = await this.providerSettingsManager.getProfile({
					id: commitMessageApiConfigId,
				})

				if (providerSettings.apiProvider) {
					configToUse = providerSettings
				}
			} catch (error) {
				// Fall back to default configuration
			}
		}

		const filteredPrompts = Object.fromEntries(
			Object.entries(customSupportPrompts).filter(([_, value]) => value !== undefined),
		) as Record<string, string>

		const prompt = await this.buildPrompt(gitContextString, { customSupportPrompts: filteredPrompts })

		onProgress?.({
			message: "Calling AI service...",
			increment: 10,
		})

		// kilocode_change start
		// Provider completion APIs are not uniformly cancellable. Race them against a
		// bounded lifecycle so a broken relay cannot leave Source Control spinning
		// forever; ignore any late result after cancellation/timeout. Commit generation
		// uses the normalized chat stream first because OpenAI-compatible reasoning
		// relays may hang or omit content on their non-streaming endpoint.
		let timeout: NodeJS.Timeout | undefined
		let abortHandler: (() => void) | undefined
		const lifecycle = new Promise<never>((_, reject) => {
			timeout = setTimeout(
				() => reject(new Error("Commit message AI request timed out after 75 seconds")),
				COMMIT_AI_TIMEOUT_MS,
			)
			if (abortSignal) {
				abortHandler = () => reject(new Error("Commit message generation was cancelled"))
				abortSignal.addEventListener("abort", abortHandler, { once: true })
			}
		})
		let response: string
		try {
			response = await Promise.race([
				singleCompletionHandler(configToUse, prompt, { preferStream: true }),
				lifecycle,
			])
		} finally {
			if (timeout) clearTimeout(timeout)
			if (abortSignal && abortHandler) abortSignal.removeEventListener("abort", abortHandler)
		}
		// kilocode_change end

		onProgress?.({
			message: "Processing AI response...",
			increment: 10,
		})

		const commitMessage = this.extractCommitMessage(response)
		if (!commitMessage) {
			throw new Error("AI returned an empty commit message")
		}
		return commitMessage
	}

	private extractCommitMessage(response: string): string {
		const cleaned = response.trim()
		const withoutCodeBlocks = cleaned.replace(/```[a-z]*\n|```/g, "")
		const withoutQuotes = withoutCodeBlocks.replace(/^["'`]|["'`]$/g, "")
		return withoutQuotes.trim()
	}
}
