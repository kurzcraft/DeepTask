import fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import delay from "delay"

import { CommandExecutionStatus, DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../task/Task"

import { ToolUse, ToolResponse } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { unescapeHtmlEntities } from "../../utils/text-normalization"
import { ExitCodeDetails, RooTerminalCallbacks, RooTerminalProcess } from "../../integrations/terminal/types"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../integrations/terminal/Terminal"
import { Package } from "../../shared/package"
import { t } from "../../i18n"
import { BaseTool, ToolCallbacks } from "./BaseTool"

class ShellIntegrationError extends Error {}

interface ExecuteCommandParams {
	command: string
	cwd?: string
}

export class ExecuteCommandTool extends BaseTool<"execute_command"> {
	readonly name = "execute_command" as const

	parseLegacy(params: Partial<Record<string, string>>): ExecuteCommandParams {
		return {
			command: params.command || "",
			cwd: params.cwd,
		}
	}

	async execute(params: ExecuteCommandParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { command, cwd: customCwd } = params
		const { handleError, pushToolResult, askApproval, removeClosingTag, toolProtocol } = callbacks

		try {
			if (!command) {
				task.consecutiveMistakeCount++
				task.recordToolError("execute_command")
				pushToolResult(await task.sayAndCreateMissingParamError("execute_command", "command"))
				return
			}

			const ignoredFileAttemptedToAccess = task.rooIgnoreController?.validateCommand(command)

			if (ignoredFileAttemptedToAccess) {
				await task.say("rooignore_error", ignoredFileAttemptedToAccess)
				pushToolResult(formatResponse.rooIgnoreError(ignoredFileAttemptedToAccess, toolProtocol))
				return
			}

			task.consecutiveMistakeCount = 0

			const unescapedCommand = unescapeHtmlEntities(command)
			const didApprove = await askApproval("command", unescapedCommand)

			if (!didApprove) {
				return
			}

			const executionId = task.lastMessageTs?.toString() ?? Date.now().toString()
			const provider = await task.providerRef.deref()
			const providerState = await provider?.getState()

			const {
				terminalOutputLineLimit = 500,
				terminalOutputCharacterLimit = DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT,
				terminalShellIntegrationDisabled = true,
			} = providerState ?? {}

			// Get command execution timeout from VSCode configuration (in seconds)
			const commandExecutionTimeoutSeconds = vscode.workspace
				.getConfiguration(Package.name)
				.get<number>("commandExecutionTimeout", 0)

			// Get command timeout allowlist from VSCode configuration
			const commandTimeoutAllowlist = vscode.workspace
				.getConfiguration(Package.name)
				.get<string[]>("commandTimeoutAllowlist", [])

			// Check if command matches any prefix in the allowlist
			const isCommandAllowlisted = commandTimeoutAllowlist.some((prefix) =>
				unescapedCommand.startsWith(prefix.trim()),
			)

			// Convert seconds to milliseconds for internal use, but skip timeout if command is allowlisted
			const commandExecutionTimeout = isCommandAllowlisted ? 0 : commandExecutionTimeoutSeconds * 1000

			const options: ExecuteCommandOptions = {
				executionId,
				command: unescapedCommand,
				customCwd,
				terminalShellIntegrationDisabled,
				terminalOutputLineLimit,
				terminalOutputCharacterLimit,
				commandExecutionTimeout,
			}

			try {
				const [rejected, result] = await executeCommandInTerminal(task, options)

				if (rejected) {
					task.didRejectTool = true
				}

				pushToolResult(result)
			} catch (error: unknown) {
				const status: CommandExecutionStatus = { executionId, status: "fallback" }
				provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
				await task.say("shell_integration_warning")

				// Invalidate pending ask from first execution to prevent race condition
				task.supersedePendingAsk()

				if (error instanceof ShellIntegrationError) {
					const [rejected, result] = await executeCommandInTerminal(task, {
						...options,
						terminalShellIntegrationDisabled: true,
					})

					if (rejected) {
						task.didRejectTool = true
					}

					pushToolResult(result)
				} else {
					pushToolResult(`Command failed to execute in terminal due to a shell integration error.`)
				}
			}

			return
		} catch (error) {
			await handleError("executing command", error as Error)
			return
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"execute_command">): Promise<void> {
		const command = block.params.command
		await task
			.ask("command", this.removeClosingTag("command", command, block.partial), block.partial)
			.catch(() => {})
	}
}

export type ExecuteCommandOptions = {
	executionId: string
	command: string
	customCwd?: string
	terminalShellIntegrationDisabled?: boolean
	terminalOutputLineLimit?: number
	terminalOutputCharacterLimit?: number
	commandExecutionTimeout?: number
}

export async function executeCommandInTerminal(
	task: Task,
	{
		executionId,
		command,
		customCwd,
		terminalShellIntegrationDisabled = true,
		terminalOutputLineLimit = 500,
		terminalOutputCharacterLimit = DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT,
		commandExecutionTimeout = 0,
	}: ExecuteCommandOptions,
): Promise<[boolean, ToolResponse]> {
	// Convert milliseconds back to seconds for display purposes.
	const commandExecutionTimeoutSeconds = commandExecutionTimeout / 1000
	let workingDir: string

	if (!customCwd) {
		workingDir = task.cwd
	} else if (path.isAbsolute(customCwd)) {
		workingDir = customCwd
	} else {
		workingDir = path.resolve(task.cwd, customCwd)
	}

	try {
		await fs.access(workingDir)
	} catch (error) {
		return [false, `Working directory '${workingDir}' does not exist.`]
	}

	let message: { text?: string; images?: string[] } | undefined
	let runInBackground = false
	let completed = false
	let commandOutputAskSettled = false
	let finalStatusPosted = false
	let result: string = ""
	let exitDetails: ExitCodeDetails | undefined
	let shellIntegrationError: string | undefined
	let hasAskedForCommandOutput = false
	let finalCommandOutputPersisted: Promise<undefined> | undefined
	let resolveShellExecutionSettled: (() => void) | undefined
	let resolveProcessCompleted: (() => void) | undefined
	const shellExecutionSettled = new Promise<void>((resolve) => {
		resolveShellExecutionSettled = resolve
	})
	const processCompleted = new Promise<void>((resolve) => {
		resolveProcessCompleted = resolve
	})

	const terminalProvider = terminalShellIntegrationDisabled ? "execa" : "vscode"
	const provider = await task.providerRef.deref()

	let accumulatedOutput = ""
	const callbacks: RooTerminalCallbacks = {
		onLine: async (lines: string, process: RooTerminalProcess) => {
			accumulatedOutput += lines
			const compressedOutput = Terminal.compressTerminalOutput(
				accumulatedOutput,
				terminalOutputLineLimit,
				terminalOutputCharacterLimit,
			)
			const status: CommandExecutionStatus = { executionId, status: "output", output: compressedOutput }
			provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })

			if (runInBackground || hasAskedForCommandOutput) {
				return
			}

			// Mark that we've asked to prevent multiple concurrent asks
			hasAskedForCommandOutput = true

			try {
				const { response, text, images } = await waitForCommandOutputResponse(task)
				commandOutputAskSettled = true

				if (response === "messageResponse" || response === "noButtonClicked") {
					runInBackground = true
					message = { text, images }
					process.continue()
				}
			} catch (_error) {
				commandOutputAskSettled = true
				// Silently handle ask errors (e.g., "Current ask promise was ignored")
			}
		},
		onCompleted: (output: string | undefined) => {
			if (completed) {
				return
			}

			// Prefer the completed stream payload. If completion arrives empty after
			// line streaming already captured text (or after continue() detached the
			// line listener), fall back to accumulated live output so the model still
			// receives terminal-visible content.
			const completedOutput = output && output.length > 0 ? output : accumulatedOutput
			result = Terminal.compressTerminalOutput(
				completedOutput ?? "",
				terminalOutputLineLimit,
				terminalOutputCharacterLimit,
			)

			// kilocode_change start
			// Register the final output write before releasing the command wait. The
			// next model request must not start first and then be visually replaced by
			// a late command_output row that re-lights the recovery Continue button.
			finalCommandOutputPersisted = task.say(
				"command_output",
				result,
				undefined,
				undefined,
				undefined,
				undefined,
				{ isNonInteractive: true },
			)
			// kilocode_change end
			completed = true
			// The completion event is the authoritative boundary for the tool
			// result. A provider can emit it after the shell exits but miss the
			// separate process `continue` event, so do not wait on that event.
			resolveProcessCompleted?.()
		},
		onShellExecutionStarted: (pid: number | undefined) => {
			const status: CommandExecutionStatus = { executionId, status: "started", pid, command }
			provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
		},
		onShellExecutionComplete: (details: ExitCodeDetails) => {
			if (!finalStatusPosted) {
				const status: CommandExecutionStatus = { executionId, status: "exited", exitCode: details.exitCode }
				provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
				finalStatusPosted = true
			}
			exitDetails = details
			resolveShellExecutionSettled?.()
		},
	}

	if (terminalProvider === "vscode") {
		callbacks.onNoShellIntegration = async (error: string) => {
			TelemetryService.instance.captureShellIntegrationError(task.taskId)
			shellIntegrationError = error
		}
	}

	const terminal = await TerminalRegistry.getOrCreateTerminal(workingDir, task.taskId, terminalProvider)

	if (terminal instanceof Terminal) {
		terminal.terminal.show(true)

		// Update the working directory in case the terminal we asked for has
		// a different working directory so that the model will know where the
		// command actually executed.
		workingDir = terminal.getCurrentWorkingDirectory()
	}

	const process = terminal.runCommand(command, callbacks)
	task.terminalProcess = process

	const shellExitCompletionFallback = shellExecutionSettled.then(async () => {
		// kilocode_change: shell exit can precede the final output callback while
		// VS Code drains its stream. Release only as a last-resort fallback, and do
		// not call continue(), which detaches the line listener and loses output.
		// Prefer any live-streamed text already captured so force-continue / late
		// tool results still include terminal-visible content.
		await delay(5_000)
		if (completed) {
			return
		}

		result = Terminal.compressTerminalOutput(
			accumulatedOutput,
			terminalOutputLineLimit,
			terminalOutputCharacterLimit,
		)
		finalCommandOutputPersisted =
			finalCommandOutputPersisted ??
			task.say("command_output", result, undefined, undefined, undefined, undefined, {
				isNonInteractive: true,
			})
		completed = true
		if (!finalStatusPosted) {
			const status: CommandExecutionStatus = {
				executionId,
				status: "exited",
				exitCode: exitDetails?.exitCode,
			}
			provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
			finalStatusPosted = true
		}
		resolveProcessCompleted?.()
	})

	// Implement command execution timeout (skip if timeout is 0).
	if (commandExecutionTimeout > 0) {
		let timeoutId: NodeJS.Timeout | undefined
		let isTimedOut = false

		const timeoutPromise = new Promise<void>((_, reject) => {
			timeoutId = setTimeout(() => {
				isTimedOut = true
				task.terminalProcess?.abort()
				reject(new Error(`Command execution timed out after ${commandExecutionTimeout}ms`))
			}, commandExecutionTimeout)
		})

		try {
			await Promise.race([process, shellExitCompletionFallback, processCompleted, timeoutPromise])
		} catch (error) {
			if (isTimedOut) {
				const status: CommandExecutionStatus = { executionId, status: "timeout" }
				provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
				finalStatusPosted = true
				await task.say("error", t("common:errors:command_timeout", { seconds: commandExecutionTimeoutSeconds }))
				task.didToolFailInCurrentTurn = true
				task.terminalProcess = undefined

				return [
					false,
					`The command was terminated after exceeding a user-configured ${commandExecutionTimeoutSeconds}s timeout. Do not try to re-run the command.`,
				]
			}
			throw error
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId)
			}

			task.terminalProcess = undefined
		}
	} else {
		// No timeout - wait for the process to complete, but do not let a missed
		// terminal continue event block after the shell has reported exit.
		try {
			await Promise.race([process, shellExitCompletionFallback, processCompleted])
		} finally {
			task.terminalProcess = undefined
		}
	}

	// kilocode_change start
	// command_output asks are advisory while output streams. After the command exits,
	// never leave that ask as the current wait point: the final tool result below is
	// what should drive the next model turn. Some asks can settle as superseded while
	// still leaving a visible pending command_output row, so check the actual pending
	// state instead of relying only on the local commandOutputAskSettled flag.
	if (hasAskedForCommandOutput && message === undefined) {
		await waitForPendingCommandOutputAsk(task, () => commandOutputAskSettled)

		if (task.hasPendingWebviewAskResponse?.()) {
			task.handleWebviewAskResponse("yesButtonClicked")
		}
	}
	// kilocode_change end

	// kilocode_change start
	// Preserve command-output ordering across the tool/model boundary. Without
	// this barrier, a slow save/post can arrive after the next api_req_started and
	// leave the UI parked on the stale recovery Continue state.
	await finalCommandOutputPersisted
	// kilocode_change end

	if (shellIntegrationError) {
		throw new ShellIntegrationError(shellIntegrationError)
	}

	// Wait for a short delay to ensure all messages are sent to the webview.
	// This delay allows time for non-awaited promises to be created and
	// for their associated messages to be sent to the webview, maintaining
	// the correct order of messages (although the webview is smart about
	// grouping command_output messages despite any gaps anyways).
	await delay(50)

	// kilocode_change start
	message = message ?? task.consumePendingCommandOutputFeedback()
	// kilocode_change end

	// User feedback during a live command must not be reported as "still running"
	// once the shell has already exited or the completion callback fired. That
	// mislabel leaves the model without a finished tool result and makes force-
	// continue look like it never received terminal output.
	const commandFinished = completed || exitDetails !== undefined

	if (message && !commandFinished) {
		const { text, images } = message
		// kilocode_change start
		if (!task.consumeCommandOutputFeedbackAlreadyShown()) {
			await task.say("user_feedback", text, images)
		}
		// kilocode_change end
		task.processQueuedMessages()

		return [
			true,
			formatResponse.toolResult(
				[
					`Command is still running in terminal from '${terminal.getCurrentWorkingDirectory().toPosix()}'.`,
					result.length > 0 ? `Here's the output so far:\n${result}\n` : "\n",
					`The user provided the following feedback:`,
					`<feedback>\n${text}\n</feedback>`,
				].join("\n"),
				images,
			),
		]
	} else if (commandFinished) {
		task.processQueuedMessages()
		let exitStatus: string = ""

		if (exitDetails !== undefined) {
			if (exitDetails.signalName) {
				exitStatus = `Process terminated by signal ${exitDetails.signalName}`

				if (exitDetails.coreDumpPossible) {
					exitStatus += " - core dump possible"
				}
			} else if (exitDetails.exitCode === undefined) {
				result += "<VSCE exit code is undefined: terminal output and command execution status is unknown.>"
				exitStatus = `Exit code: <undefined, notify user>`
			} else {
				if (exitDetails.exitCode !== 0) {
					exitStatus += "Command execution was not successful, inspect the cause and adjust as needed.\n"
				}

				exitStatus += `Exit code: ${exitDetails.exitCode}`
			}
		} else {
			result += "<VSCE exitDetails == undefined: terminal output and command execution status is unknown.>"
			exitStatus = `Exit code: <undefined, notify user>`
		}

		let workingDirInfo = ` within working directory '${terminal.getCurrentWorkingDirectory().toPosix()}'`

		// If the user typed feedback after the command already finished (common
		// with recovery Continue / force-continue), attach it to the finished
		// tool result instead of inventing a still-running state.
		if (message) {
			const { text, images } = message
			if (!task.consumeCommandOutputFeedbackAlreadyShown()) {
				await task.say("user_feedback", text, images)
			}

			return [
				false,
				[
					`Command executed in terminal ${workingDirInfo}. ${exitStatus}`,
					`Output:\n${result}`,
					`The user provided the following feedback after the command finished:`,
					`<feedback>\n${text}\n</feedback>`,
				].join("\n"),
			]
		}

		return [false, `Command executed in terminal ${workingDirInfo}. ${exitStatus}\nOutput:\n${result}`]
	} else {
		return [
			false,
			[
				`Command is still running in terminal ${workingDir ? ` from '${workingDir.toPosix()}'` : ""}.`,
				result.length > 0 ? `Here's the output so far:\n${result}\n` : "\n",
				"You will be updated on the terminal status and new output in the future.",
			].join("\n"),
		]
	}
}

// kilocode_change start
async function waitForCommandOutputResponse(
	task: Task,
): Promise<{ response: "messageResponse" | "yesButtonClicked" | "noButtonClicked"; text?: string; images?: string[] }> {
	let timeoutId: NodeJS.Timeout | undefined
	const askPromise = task.ask("command_output", "")
	const autoContinuePromise = new Promise<{
		response: "yesButtonClicked"
		text?: string
		images?: string[]
	}>((resolve) => {
		timeoutId = setTimeout(() => {
			// kilocode_change: clear the transient UI ask without detaching terminal
			// output capture. BaseTerminalProcess.continue() removes the line listener,
			// so calling it here can make terminal-visible output unavailable to the model.
			task.handleWebviewAskResponse("yesButtonClicked")
			resolve({ response: "yesButtonClicked" })
		}, 250)
	})

	try {
		const result = await Promise.race([askPromise, autoContinuePromise])
		return {
			response: result.response as "messageResponse" | "yesButtonClicked" | "noButtonClicked",
			text: result.text,
			images: result.images,
		}
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId)
		}
	}
}
// kilocode_change end

async function waitForPendingCommandOutputAsk(task: Task, isSettled: () => boolean): Promise<void> {
	const maxAttempts = 20

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		if (isSettled() || task.hasPendingWebviewAskResponse?.()) {
			return
		}

		await delay(25)
	}
}

export const executeCommandTool = new ExecuteCommandTool()
