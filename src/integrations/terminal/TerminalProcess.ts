import stripAnsi from "strip-ansi"
import * as vscode from "vscode"
import { inspect } from "util"

import type { ExitCodeDetails } from "./types"
import { BaseTerminalProcess } from "./BaseTerminalProcess"
import { Terminal } from "./Terminal"
import { getTerminalShellExecutionStream } from "./TerminalShellExecutionStream"

export class TerminalProcess extends BaseTerminalProcess {
	private terminalRef: WeakRef<Terminal>
	private isReleased = false

	constructor(terminal: Terminal) {
		super()

		this.terminalRef = new WeakRef(terminal)

		this.once("completed", () => {
			this.terminal.busy = false
		})

		this.once("no_shell_integration", () => {
			this.emit("completed", "<no shell integration>")
			this.terminal.busy = false
			this.terminal.setActiveStream(undefined)
			this.continue()
		})
	}

	public get terminal(): Terminal {
		const terminal = this.terminalRef.deref()

		if (!terminal) {
			throw new Error("Unable to dereference terminal")
		}

		return terminal
	}

	public override async run(command: string) {
		this.command = command

		const terminal = this.terminal.terminal

		const isShellIntegrationAvailable = terminal.shellIntegration && terminal.shellIntegration.executeCommand

		if (!isShellIntegrationAvailable) {
			terminal.sendText(command, true)

			console.warn(
				"[TerminalProcess] Shell integration not available. Command sent without knowledge of response.",
			)

			this.emit(
				"no_shell_integration",
				"Command was submitted; output is not available, as shell integration is inactive.",
			)

			this.emit(
				"completed",
				"<shell integration is not available, so terminal output and command execution status is unknown>",
			)

			this.emit("continue")
			return
		}

		let isWaitingForStream = true

		// Create a promise that resolves when the stream becomes available
		const streamAvailable = new Promise<AsyncIterable<string>>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				isWaitingForStream = false

				// Remove event listener to prevent memory leaks
				this.removeAllListeners("stream_available")

				// Emit no_shell_integration event with descriptive message
				this.emit(
					"no_shell_integration",
					`VSCE shell integration stream did not start within ${Terminal.getShellIntegrationTimeout() / 1000} seconds. Terminal problem?`,
				)

				// Reject with descriptive error
				reject(
					new Error(
						`VSCE shell integration stream did not start within ${Terminal.getShellIntegrationTimeout() / 1000} seconds.`,
					),
				)
			}, Terminal.getShellIntegrationTimeout())

			// Clean up timeout if stream becomes available
			this.once("stream_available", (stream: AsyncIterable<string>) => {
				isWaitingForStream = false
				clearTimeout(timeoutId)
				resolve(stream)
			})
		})

		let shellExecutionDetails: ExitCodeDetails | undefined

		// Create promise that resolves when shell execution completes for this terminal
		const shellExecutionComplete = new Promise<ExitCodeDetails>((resolve) => {
			this.once("shell_execution_complete", (details: ExitCodeDetails) => {
				shellExecutionDetails = details
				resolve(details)
			})
		})

		// Execute command
		const defaultWindowsShellProfile = vscode.workspace
			.getConfiguration("terminal.integrated.defaultProfile")
			.get("windows")

		const isPowerShell =
			process.platform === "win32" &&
			(defaultWindowsShellProfile === null ||
				(defaultWindowsShellProfile as string)?.toLowerCase().includes("powershell"))

		let execution: vscode.TerminalShellExecution | undefined

		if (isPowerShell) {
			let commandToExecute = command

			// Only add the PowerShell counter workaround if enabled
			if (Terminal.getPowershellCounter()) {
				commandToExecute += ` ; "(Roo/PS Workaround: ${this.terminal.cmdCounter++})" > $null`
			}

			// Only add the sleep command if the command delay is greater than 0
			if (Terminal.getCommandDelay() > 0) {
				commandToExecute += ` ; start-sleep -milliseconds ${Terminal.getCommandDelay()}`
			}

			execution = terminal.shellIntegration.executeCommand(commandToExecute)
		} else {
			execution = terminal.shellIntegration.executeCommand(command)
		}

		// kilocode_change start
		const publishFallbackStream = () => {
			if (!isWaitingForStream || !execution) {
				return
			}

			try {
				const fallbackStream = getTerminalShellExecutionStream(execution)
				if (!fallbackStream) {
					return
				}

				if (this.terminal.process === this) {
					this.terminal.setActiveStream(fallbackStream)
				} else {
					this.emit("stream_available", fallbackStream)
				}
			} catch (error) {
				console.warn("[TerminalProcess] Failed to read shell execution output stream:", error)
			}
		}

		// VS Code can report shell completion before stream_available. Read the
		// execution immediately so finite commands do not lose their output.
		publishFallbackStream()
		setTimeout(publishFallbackStream, 0)
		// kilocode_change end

		this.isHot = true

		// Wait for stream to be available. Some complex commands can emit the shell
		// completion event before VS Code exposes an output stream. Give the stream
		// one short grace window after shell completion so finite commands do not lose
		// output merely because PIPESTATUS/tee/exit caused event ordering to invert.
		let stream: AsyncIterable<string>

		try {
			const streamOrCompletion = await Promise.race([
				streamAvailable.then((availableStream) => ({ type: "stream" as const, stream: availableStream })),
				shellExecutionComplete.then(() => ({ type: "completed" as const })),
			])

			if (streamOrCompletion.type === "completed") {
				const lateStream = await Promise.race([
					streamAvailable.then((availableStream) => ({ type: "stream" as const, stream: availableStream })),
					new Promise<{ type: "completed" }>((resolve) =>
						setTimeout(() => resolve({ type: "completed" }), 250),
					),
				])

				if (lateStream.type === "completed") {
					isWaitingForStream = false
					this.isHot = false
					this.terminal.busy = false
					this.terminal.setActiveStream(undefined)
					this.emit(
						"completed",
						"<VSCE shell integration stream was not available before shell execution completed; terminal output is unknown.>",
					)
					this.emit("continue")
					return
				}

				stream = lateStream.stream
			} else {
				stream = streamOrCompletion.stream
			}
		} catch (error) {
			isWaitingForStream = false

			// Stream timeout or other error occurred
			console.error("[Terminal Process] Stream error:", error.message)

			// Emit completed event with error message
			this.emit(
				"completed",
				"<VSCE shell integration stream did not start: terminal output and command execution status is unknown>",
			)

			this.terminal.busy = false

			// Emit continue event to allow execution to proceed
			this.emit("continue")
			return
		}

		let preOutput = ""
		let commandOutputStarted = false
		// kilocode_change start
		// Fresh-prompt lookback: VS Code sometimes never emits OSC 633;C for
		// multi-line / quoted inline commands, and may never fire the shell end
		// event either. Once the shell paints a NEW prompt (OSC 633;A / 133;A after
		// the command echo has already streamed), the command has finished and the
		// terminal is interactive again. Detect that boundary on the accumulated
		// buffer so the tool result can still settle.
		let freshPromptDetected: string | undefined
		// kilocode_change end

		/*
		 * Extract clean output from raw accumulated output. FYI:
		 * ]633 is a custom sequence number used by VSCode shell integration:
		 * - OSC 633 ; A ST - Mark prompt start
		 * - OSC 633 ; B ST - Mark prompt end
		 * - OSC 633 ; C ST - Mark pre-execution (start of command output)
		 * - OSC 633 ; D [; <exitcode>] ST - Mark execution finished with optional exit code
		 * - OSC 633 ; E ; <commandline> [; <nonce>] ST - Explicitly set command line with optional nonce
		 */

		// Process stream data. VS Code can report shell completion while leaving the
		// async output iterator open indefinitely, especially for tee/PIPESTATUS
		// commands. Once completion is known, bound the remaining drain window so the
		// agent cannot stay stuck waiting for a stream close that never arrives.
		const streamIterator = stream[Symbol.asyncIterator]()
		const closeStreamIterator = async () => {
			if (typeof streamIterator.return === "function") {
				try {
					await streamIterator.return()
				} catch (error) {
					console.debug("[TerminalProcess] Failed to close shell execution stream:", error)
				}
			}
		}
		const shellCompletionDeadline = shellExecutionComplete.then(
			() =>
				new Promise<"deadline">((resolve) => {
					setTimeout(() => resolve("deadline"), 1_000)
				}),
		)
	// If VS Code closes the backing terminal shell, neither the shell execution
	// end event nor the output iterator is guaranteed to resolve. Poll the
	// terminal close state so a failed/terminated bash cannot leave the command
	// tool waiting forever on an abandoned stream.
	let terminalClosePollId: NodeJS.Timeout | undefined
	const terminalClosed = new Promise<"terminal_closed">((resolve) => {
		terminalClosePollId = setInterval(() => {
			// kilocode_change: the terminal reference can be garbage-collected
			// while a retained process still polls; dereference defensively so the
			// poll itself can never crash the extension host.
			try {
				if (this.terminal.isClosed()) {
					if (terminalClosePollId) {
						clearInterval(terminalClosePollId)
						terminalClosePollId = undefined
					}
					resolve("terminal_closed")
				}
			} catch {
				if (terminalClosePollId) {
					clearInterval(terminalClosePollId)
					terminalClosePollId = undefined
				}
				resolve("terminal_closed")
			}
		}, 100)
	})
		while (true) {
			const next = await Promise.race([
				streamIterator.next().then((result) => ({ kind: "item" as const, result })),
				shellCompletionDeadline.then((kind) => ({ kind })),
				terminalClosed.then((kind) => ({ kind })),
			])
			if (next.kind === "deadline" || next.kind === "terminal_closed" || next.result.done) {
				break
			}

			let data = next.result.value
			// kilocode_change start

			if (!commandOutputStarted) {
				preOutput += data

				// The accumulated buffer makes marker matching robust to arbitrary
				// chunk boundaries; the previous single-chunk match silently dropped
				// output whenever VS Code split an OSC marker across chunks.
				const match = this.matchAfterVsceStartMarkers(preOutput)

				if (match !== undefined) {
					commandOutputStarted = true
					data = match
					this.fullOutput = "" // Reset fullOutput when command actually starts
					this.emit("line", "") // Trigger UI to proceed
				} else {
					// No C marker yet. Two bounded exits remain available for commands
					// whose C marker never arrives:
					//   1. A D marker in the pre-start buffer: VS Code already ran and
					//      finished the command without ever marking its start.
					//   2. A fresh prompt after the command echo: the shell returned
					//      to the interactive prompt, so the command has completed
					//      even though OSC 633;C was swallowed.
					const preEndMatch = this.matchBeforeVsceEndMarkers(preOutput)

					if (preEndMatch !== undefined) {
						// Command completed without a C marker: preserve the raw
						// output instead of looping forever waiting for one.
						freshPromptDetected = "end_marker_in_preoutput"
						this.fullOutput = preEndMatch
						commandOutputStarted = true
						break
					}

					// The initial pre-command prompt marker (633;A...633;B) is the
					// first marker in the buffer. Any additional 633;A/133;A marker
					// after the echoed command lines is a fresh interactive prompt:
					// the command has finished.
					if (this.hasFreshPromptAfterEcho(preOutput)) {
						freshPromptDetected = "fresh_prompt_after_echo"
						this.fullOutput = this.stripLeadingEchoAndPrompt(preOutput)
						commandOutputStarted = true
						break
					}

					continue
				}
			}
			// kilocode_change end

			// Command output started, accumulate data without filtering.
			// notice to future programmers: do not add escape sequence
			// filtering here: fullOutput cannot change in length (see getUnretrievedOutput),
			// and chunks may not be complete so you cannot rely on detecting or removing escape sequences mid-stream.
			this.fullOutput += data

			// The end marker is the command boundary. VS Code may keep the shared stream
			// open and immediately emit the interactive prompt (including carriage-return
			// redraws) after it. Do not consume that prompt as command output: doing so
			// makes the visible terminal path appear to move backwards one chunk at a time.
			const completedOutput = this.matchBeforeVsceEndMarkers(this.fullOutput)
			if (completedOutput !== undefined) {
				this.fullOutput = completedOutput
				break
			}

			// For non-immediately returning commands we want to show loading spinner
			// right away but this wouldn't happen until it emits a line break, so
			// as soon as we get any output we emit to let webview know to show spinner
			const now = Date.now()

			if (this.isListening && (now - this.lastEmitTime_ms > 100 || this.lastEmitTime_ms === 0)) {
				this.emitRemainingBufferIfListening()
				this.lastEmitTime_ms = now
			}

			this.startHotTimer(data)
		}

		// The stream has reached a terminal boundary, so the close poll is no
		// longer needed. Leaving it alive keeps the integrated-terminal command
		// shell marked active even after the child command returned successfully.
		if (terminalClosePollId) {
			clearInterval(terminalClosePollId)
			terminalClosePollId = undefined
		}

		await closeStreamIterator()

		// Set streamClosed immediately after stream ends.
		this.terminal.setActiveStream(undefined)

		// VS Code can close the shell integration stream without firing the matching
		// end event for complex commands (for example here-doc chains). Do not block
		// forever after the command output stream has ended.
		await this.waitForShellExecutionCompleteAfterStreamClose(shellExecutionComplete)
		const missingShellExecutionEndEvent = shellExecutionDetails === undefined

		this.isHot = false

		// kilocode_change start
		if (freshPromptDetected) {
			// The command completed through the fresh-prompt or pre-output D-marker
			// boundary. fullOutput already holds the preserved output; annotate the
			// completion so the model knows why no OSC 633;C marker framed it.
			this.emitRemainingBufferIfListening()
			this.stopHotTimer()
			const freshOutput = this.removeEscapeSequences(this.fullOutput)
			this.emit(
				"completed",
				`${freshOutput}\n<VSCE shell integration start marker missing (${freshPromptDetected}); command completion detected via fresh shell prompt / end marker in raw terminal output.>`,
			)
			this.continue()
			return
		}
		// kilocode_change end

		if (commandOutputStarted) {
			// Emit any remaining output before completing
			this.emitRemainingBufferIfListening()
		} else {
			const errorMsg =
				"VSCE output start escape sequence (]633;C or ]133;C) not received, but the stream has started."
			const inspectPreOutput = inspect(preOutput, { colors: false, breakLength: Infinity })
			console.warn(`[Terminal Process] ${errorMsg} Falling back to raw stream output: ${inspectPreOutput}`)

			// VSCodium can expose a readable command stream without emitting OSC 633/133
			// start markers. The command has still run, so preserve its output instead of
			// emitting no_shell_integration here. That event is a terminal-abort signal and
			// its constructor listener would otherwise complete the process with a placeholder
			// before the preserved raw output can be delivered.
			const cleanedPreOutput = this.removeEscapeSequences(preOutput).trim()

			if (cleanedPreOutput.length === 0) {
				// The stream produced no usable data at all (dropped stream, competing
				// consumer, or completion-before-stream ordering). Fall back to the
				// visible terminal transcript for the last command so the executed
				// command's output still reaches the model instead of an empty result.
				let screenFallback = ""

				try {
					// Note: this reads the *active* terminal panel; it is a last-resort
					// recovery path only, because no stream data survived to reuse.
					screenFallback = (await Terminal.getTerminalContents(1)).trim()
				} catch (error) {
					console.warn("[TerminalProcess] Terminal screen fallback failed:", error)
				}

				this.fullOutput = screenFallback

				this.emit(
					"completed",
					`${screenFallback}\n<VSCE shell integration start marker missing and stream data was empty; terminal screen content used as fallback output.>`,
				)
				this.continue()
				return
			}

		// kilocode_change start: echo-only stream recovery
		// When the C marker is missing, VS Code can hand us a stream that only
		// ever carried the echoed command line while the real command output
		// went straight to the terminal buffer. Preserving that echo as the
		// "output" shows the model the command text instead of its results and
		// made users report the output as swallowed. Strip the echo first; if
		// nothing meaningful remains, recover the visible terminal transcript.
		const preservedRaw = this.removeEscapeSequences(preOutput).trim()
		const strippedEcho = this.removeEscapeSequences(this.stripLeadingEchoAndPrompt(preOutput, command)).trim()

		// A marker-less stream whose only real content was the command echo (or
		// that carried no data at all) cannot satisfy any output requirement:
		// recover from the visible terminal transcript instead.
		if (preservedRaw.length === 0 || strippedEcho.length === 0) {
			let screenFallback = ""

			try {
				// Note: this reads the *active* terminal panel; it is a last-resort
				// recovery path only, because no stream data survived to reuse.
				screenFallback = (await Terminal.getTerminalContents(1)).trim()
			} catch (error) {
				console.warn("[TerminalProcess] Terminal screen fallback failed:", error)
			}

			const recovered = screenFallback.length > 0 ? screenFallback : preservedRaw
			this.fullOutput = recovered

			this.emit(
				"completed",
				`${recovered}\n<VSCE shell integration start marker missing; stream carried only the command echo or no data; terminal screen content used to recover the command output.>`,
			)
			this.continue()
			return
		}
		// kilocode_change end

			this.fullOutput = this.removeEscapeSequences(preOutput)
			this.emit(
				"completed",
				`${this.fullOutput}\n<VSCE shell integration start marker missing; raw terminal output preserved.>`,
			)
			this.continue()
			return
		}

		// fullOutput begins after C marker. The loop normally removes D as soon as
		// it arrives; retain this final guard for split markers and stream-close races.
		const match = this.matchBeforeVsceEndMarkers(this.fullOutput)

		if (match !== undefined) {
			this.fullOutput = match
		}

		// For now we don't want this delaying requests since we don't send
		// diagnostics automatically anymore (previous: "even though the
		// command is finished, we still want to consider it 'hot' in case
		// so that api request stalls to let diagnostics catch up").
		this.stopHotTimer()
		let output = this.removeEscapeSequences(this.fullOutput)

		// kilocode_change: a competing stream consumer (or a VS Code stream race)
		// can leave fullOutput empty even though the C/D markers framed normally.
		// An empty result would starve the model of the command output entirely,
		// so recover from the visible terminal transcript as a last resort.
		if (output.trim().length === 0) {
			let screenFallback = ""

			try {
				screenFallback = (await Terminal.getTerminalContents(1)).trim()
			} catch (error) {
				console.warn("[TerminalProcess] Terminal screen fallback failed:", error)
			}

			if (screenFallback.length > 0) {
				this.fullOutput = screenFallback
				output = screenFallback
				output += "\n<VSCE command stream produced no data; terminal screen content used to recover the command output.>"
			}
		}

		if (missingShellExecutionEndEvent) {
			output +=
				"\n<VSCE shell execution end event not received after stream closed; treated stream close as command completion.>"
		}
		if (this.terminal.isClosed()) {
			output +=
				"\n<VSCE terminal shell closed before command completion; treated terminal closure as command completion.>"
		}
		this.emit("completed", output)
		this.emit("continue")
	}

	private async waitForShellExecutionCompleteAfterStreamClose(
		shellExecutionComplete: Promise<ExitCodeDetails>,
	): Promise<void> {
		await Promise.race([
			shellExecutionComplete.then(() => undefined),
			new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
		])
	}

	public override continue() {
		if (this.isReleased) {
			return
		}

		this.isReleased = true
		this.emitRemainingBufferIfListening()
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	public override abort() {
		if (this.isListening) {
			// Send SIGINT using CTRL+C
			this.terminal.terminal.sendText("\x03")
		}
	}

	public override hasUnretrievedOutput(): boolean {
		// If the process is still active or has unretrieved content, return true
		return this.lastRetrievedIndex < this.fullOutput.length
	}

	public override getUnretrievedOutput(): string {
		// Get raw unretrieved output
		let outputToProcess = this.fullOutput.slice(this.lastRetrievedIndex)

		// Check for VSCE command end markers
		const index633 = outputToProcess.indexOf("\x1b]633;D")
		const index133 = outputToProcess.indexOf("\x1b]133;D")
		let endIndex = -1

		if (index633 !== -1 && index133 !== -1) {
			endIndex = Math.min(index633, index133)
		} else if (index633 !== -1) {
			endIndex = index633
		} else if (index133 !== -1) {
			endIndex = index133
		}

		// If no end markers were found yet (possibly due to VSCode bug#237208):
		//   For active streams: return only complete lines (up to last \n).
		//   For closed streams: return all remaining content.
		if (endIndex === -1) {
			if (!this.terminal.isStreamClosed) {
				// Stream still running - only process complete lines
				endIndex = outputToProcess.lastIndexOf("\n")

				if (endIndex === -1) {
					// No complete lines
					return ""
				}

				// Include carriage return
				endIndex++
			} else {
				// Stream closed - process all remaining output
				endIndex = outputToProcess.length
			}
		}

		// Update index and slice output
		this.lastRetrievedIndex += endIndex
		outputToProcess = outputToProcess.slice(0, endIndex)

		// Clean and return output
		return this.removeEscapeSequences(outputToProcess)
	}

	// kilocode_change start
	// Fresh-prompt lookback helpers: see the streaming loop in run(). When VS Code
	// swallows the OSC 633;C start marker for multi-line / quoted inline commands
	// but the shell still returns to a fresh interactive prompt after the command
	// finishes, use that prompt as the completion boundary instead of waiting
	// forever for a marker or end event that never arrives.
	private hasFreshPromptAfterEcho(buffer: string): boolean {
		// A prompt start marker that appears strictly after the first line break
		// cannot be part of the initial pre-command prompt echo.
		// eslint-disable-next-line no-control-regex
		const promptMarkerRe = /(?:\x1b\]633;A|\x1b\]133;A)[^\x07\x1b]*(?:\x07|\x1b\\)/g
		const firstNewline = buffer.indexOf("\n")

		if (firstNewline === -1) {
			return false
		}

		promptMarkerRe.lastIndex = 0
		let match: RegExpExecArray | null
		let freshPrompt = false

		while ((match = promptMarkerRe.exec(buffer)) !== null) {
			if (match.index > firstNewline) {
				freshPrompt = true
				break
			}
		}

		return freshPrompt
	}

	private stripLeadingEchoAndPrompt(buffer: string, command?: string): string {
		// Remove the leading pre-command prompt (OSC 633;A...633;B) and the echoed
		// command line so the preserved output resembles normal command output.
		// eslint-disable-next-line no-control-regex
		const promptEndMarker = /\x1b\]633;B[^\x07\x1b]*(?:\x07|\x1b\\)/
		const promptEndMatch = promptEndMarker.exec(buffer)

		if (promptEndMatch) {
			const afterPrompt = buffer.slice(promptEndMatch.index + promptEndMatch[0].length)
			// Skip the echoed command line: the first line after the prompt is the
			// command itself (or the first line of a multi-line command).
			const firstNewline = afterPrompt.indexOf("\n")

			if (firstNewline !== -1) {
				return afterPrompt.slice(firstNewline + 1)
			}

			return afterPrompt
		}

		// kilocode_change: no OSC prompt markers at all (marker-less stream). Such a
		// stream commonly carries only the echoed command line(s) while the real
		// command output went straight to the terminal buffer. Strip leading lines
		// that reproduce the command text so echo-only streams are recognized as
		// content-free and the screen-recovery path can supply the real output.
		if (command) {
			const cmdLines = command
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.length > 0)
			const lines = buffer.split("\n")
			let i = 0

			// Skip leading blank lines before the echo.
			while (i < lines.length && lines[i].trim().length === 0) {
				i++
			}

			for (const cmdLine of cmdLines) {
				const candidate = (lines[i] ?? "").trim()

				if (
					candidate.length === 0 ||
					candidate === cmdLine ||
					candidate.endsWith(cmdLine) ||
					cmdLine.startsWith(candidate)
				) {
					i++
				} else {
					break
				}
			}

			return lines.slice(i).join("\n")
		}

		return buffer
	}
	// kilocode_change end

	private emitRemainingBufferIfListening() {
		if (this.isListening) {
			const remainingBuffer = this.getUnretrievedOutput()

			if (remainingBuffer !== "") {
				this.emit("line", remainingBuffer)
			}
		}
	}

	private stringIndexMatch(
		data: string,
		prefix?: string,
		suffix?: string,
	): string | undefined {
		let startIndex: number
		let endIndex: number
		let prefixLength: number

		if (prefix === undefined) {
			startIndex = 0
			prefixLength = 0
		} else {
			startIndex = data.indexOf(prefix)

			if (startIndex === -1) {
				return undefined
			}

			// kilocode_change: OSC sequences can be terminated by either BEL
			// (\x07) or ST (\x1b\\). Accept whichever terminates the marker first.
			const belIndex = data.indexOf("\x07", startIndex + prefix.length)
			const stIndex = data.indexOf("\x1b\\", startIndex + prefix.length)
			let terminatorIndex = -1
			let terminatorLength = 0

			if (belIndex !== -1 && stIndex !== -1) {
				if (belIndex <= stIndex) {
					terminatorIndex = belIndex
					terminatorLength = 1
				} else {
					terminatorIndex = stIndex
					terminatorLength = 2
				}
			} else if (belIndex !== -1) {
				terminatorIndex = belIndex
				terminatorLength = 1
			} else if (stIndex !== -1) {
				terminatorIndex = stIndex
				terminatorLength = 2
			}

			if (terminatorIndex === -1) {
				return undefined
			}

			prefixLength = terminatorIndex - startIndex + terminatorLength
		}

		const contentStart = startIndex + prefixLength

		if (suffix === undefined) {
			// When suffix is undefined, match to end
			endIndex = data.length
		} else {
			endIndex = data.indexOf(suffix, contentStart)

			if (endIndex === -1) {
				return undefined
			}
		}

		return data.slice(contentStart, endIndex)
	}

	// Removes ANSI escape sequences and VSCode-specific terminal control codes from output.
	// While stripAnsi handles most ANSI codes, VSCode's shell integration adds custom
	// escape sequences (OSC 633) that need special handling. These sequences control
	// terminal features like marking command start/end and setting prompts.
	//
	// This method could be extended to handle other escape sequences, but any additions
	// should be carefully considered to ensure they only remove control codes and don't
	// alter the actual content or behavior of the output stream.
	private removeEscapeSequences(str: string): string {
		// kilocode_change: also strip OSC sequences terminated by ST (\x1b\\),
		// which VSCodium can emit instead of BEL (\x07). BEL-only matching left
		// raw ]633;... sequences visible in command output.
		// eslint-disable-next-line no-control-regex
		return stripAnsi(
			str
				.replace(/\x1b\]633;[^\x07\x1b]*(?:\x07|\x1b\\)/gs, "")
				.replace(/\x1b\]133;[^\x07\x1b]*(?:\x07|\x1b\\)/gs, ""),
		)
	}

	/**
	 * Helper function to match VSCode shell integration start markers (C).
	 * Looks for content after ]633;C or ]133;C markers.
	 * If both exist, takes the content after the last marker found.
	 */
	private matchAfterVsceStartMarkers(data: string): string | undefined {
		return this.matchVsceMarkers(data, "\x1b]633;C", "\x1b]133;C", undefined, undefined)
	}

	/**
	 * Helper function to match VSCode shell integration end markers (D).
	 * Looks for content before ]633;D or ]133;D markers.
	 * If both exist, takes the content before the first marker found.
	 */
	private matchBeforeVsceEndMarkers(data: string): string | undefined {
		return this.matchVsceMarkers(data, undefined, undefined, "\x1b]633;D", "\x1b]133;D")
	}

	/**
	 * Handles VSCode shell integration markers for command output:
	 *
	 * For C (Command Start):
	 * - Looks for content after ]633;C or ]133;C markers
	 * - These markers indicate the start of command output
	 * - If both exist, takes the content after the last marker found
	 * - This ensures we get the actual command output after any shell integration prefixes
	 *
	 * For D (Command End):
	 * - Looks for content before ]633;D or ]133;D markers
	 * - These markers indicate command completion
	 * - If both exist, takes the content before the first marker found
	 * - This ensures we don't include shell integration suffixes in the output
	 *
	 * In both cases, checks 633 first since it's more commonly used in VSCode shell integration
	 *
	 * @param data The string to search for markers in
	 * @param prefix633 The 633 marker to match after (for C markers)
	 * @param prefix133 The 133 marker to match after (for C markers)
	 * @param suffix633 The 633 marker to match before (for D markers)
	 * @param suffix133 The 133 marker to match before (for D markers)
	 * @returns The content between/after markers, or undefined if no markers found
	 *
	 * Note: Always makes exactly 2 calls to stringIndexMatch regardless of match results.
	 * Using string indexOf matching is ~500x faster than regular expressions, so even
	 * matching twice is still very efficient comparatively.
	 */
	private matchVsceMarkers(
		data: string,
		prefix633: string | undefined,
		prefix133: string | undefined,
		suffix633: string | undefined,
		suffix133: string | undefined,
	): string | undefined {
		// Support both VSCode shell integration markers (633 and 133)
		// Check 633 first since it's more commonly used in VSCode shell integration
		let match133: string | undefined
		const match633 = this.stringIndexMatch(data, prefix633, suffix633)

		// Must check explicitly for undefined because stringIndexMatch can return empty strings
		// that are valid matches (e.g., when a marker exists but has no content between markers)
		if (match633 !== undefined) {
			match133 = this.stringIndexMatch(match633, prefix133, suffix133)
		} else {
			match133 = this.stringIndexMatch(data, prefix133, suffix133)
		}

		return match133 !== undefined ? match133 : match633
	}
}
