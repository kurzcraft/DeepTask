import { execa, ExecaError } from "execa"
import psList from "ps-list"
import process from "process"

import { getShell } from "../../utils/shell"
import type { RooTerminal } from "./types"
import { BaseTerminalProcess } from "./BaseTerminalProcess"

// kilocode_change start
const PROCESS_LOOKUP_TIMEOUT_MS = 2_000

/**
 * Child discovery is best-effort cleanup and must never block command completion.
 * Windows termination uses taskkill on the root shell PID and does not need a
 * full system process listing.
 */
async function getChildPids(parentPid: number): Promise<number[]> {
	if (process.platform === "win32") {
		return []
	}

	let timeoutId: NodeJS.Timeout | undefined
	try {
		const processes = await Promise.race([
			psList(),
			new Promise<never>((_, reject) => {
				timeoutId = setTimeout(() => reject(new Error("Process lookup timed out")), PROCESS_LOOKUP_TIMEOUT_MS)
			}),
		])
		return processes.filter((candidate) => candidate.ppid === parentPid).map((candidate) => candidate.pid)
	} catch (error) {
		console.warn(
			`Failed to get child processes for PID ${parentPid}: ${error instanceof Error ? error.message : String(error)}`,
		)
		return []
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId)
		}
	}
}
// kilocode_change end

export class ExecaTerminalProcess extends BaseTerminalProcess {
	private terminalRef: WeakRef<RooTerminal>
	private aborted = false
	private pid?: number
	private subprocess?: ReturnType<typeof execa>

	constructor(terminal: RooTerminal) {
		super()

		this.terminalRef = new WeakRef(terminal)

		this.once("completed", () => {
			this.terminal.busy = false
		})
	}

	public get terminal(): RooTerminal {
		const terminal = this.terminalRef.deref()

		if (!terminal) {
			throw new Error("Unable to dereference terminal")
		}

		return terminal
	}

	public override async run(command: string) {
		this.command = command

		try {
			this.isHot = true

			// kilocode_change start
			// The prompt and executor must use the same shell. `shell: true` silently
			// selects cmd.exe on Windows even when VS Code is configured for PowerShell.
			const shell = getShell()
			const env =
				process.platform === "win32"
					? { ...process.env }
					: {
							...process.env,
							LANG: "en_US.UTF-8",
							LC_ALL: "en_US.UTF-8",
						}

			this.subprocess = execa({
				shell,
				cwd: this.terminal.getCurrentWorkingDirectory(),
				all: true,
				stdin: "ignore",
				windowsHide: true,
				env,
			})`${command}`
			// kilocode_change end

			this.pid = this.subprocess.pid
			this.emit("shell_execution_started", this.pid)

			const rawStream = this.subprocess.iterable({ from: "all", preserveNewlines: true })

			// Wrap the stream to ensure all chunks are strings (execa can return Uint8Array)
			const stream = (async function* () {
				for await (const chunk of rawStream) {
					yield typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
				}
			})()

			this.terminal.setActiveStream(stream, this.pid)

			for await (const line of stream) {
				if (this.aborted) {
					break
				}

				this.fullOutput += line

				const now = Date.now()

				if (this.isListening && (now - this.lastEmitTime_ms > 500 || this.lastEmitTime_ms === 0)) {
					this.emitRemainingBufferIfListening()
					this.lastEmitTime_ms = now
				}

				this.startHotTimer(line)
			}

			this.emit("shell_execution_complete", { exitCode: this.aborted ? 1 : 0 })
		} catch (error) {
			if (error instanceof ExecaError) {
				console.error(`[ExecaTerminalProcess#run] shell execution error: ${error.message}`)
				this.emit("shell_execution_complete", { exitCode: error.exitCode ?? 1, signalName: error.signal })
			} else {
				console.error(
					`[ExecaTerminalProcess#run] shell execution error: ${error instanceof Error ? error.message : String(error)}`,
				)

				this.emit("shell_execution_complete", { exitCode: 1 })
			}
		} finally {
			// kilocode_change start
			// Completion is fail-soft: every startup, stream, and cancellation path
			// releases the terminal so the task cannot remain permanently busy.
			try {
				this.terminal.setActiveStream(undefined)
			} catch (error) {
				console.warn(
					`[ExecaTerminalProcess#run] Failed to clear active stream: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
			this.emitRemainingBufferIfListening()
			this.stopHotTimer()
			this.emit("completed", this.fullOutput)
			this.emit("continue")
			this.subprocess = undefined
			// kilocode_change end
		}
	}

	public override continue() {
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	public override abort() {
		this.aborted = true

		if (!this.pid) {
			return
		}

		const rootPid = this.pid

		// kilocode_change start
		if (process.platform === "win32") {
			// Node signals do not reliably terminate descendants on Windows. Do not
			// kill the root first: taskkill needs that PID to identify the full tree.
			void execa("taskkill", ["/PID", String(rootPid), "/T", "/F"], {
				windowsHide: true,
				timeout: 5_000,
				reject: false,
			}).catch((error) => {
				console.warn(
					`[ExecaTerminalProcess#abort] taskkill failed for PID ${rootPid}: ${error instanceof Error ? error.message : String(error)}`,
				)
			})
			return
		}

		// Capture descendants while the shell is still present, then terminate
		// children before the root. Lookup timeout keeps cancellation bounded.
		void getChildPids(rootPid).then((childPids) => {
			for (const childPid of childPids) {
				try {
					process.kill(childPid, "SIGKILL")
				} catch (error) {
					console.warn(
						`[ExecaTerminalProcess#abort] Failed to kill child PID ${childPid}: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}

			try {
				this.subprocess?.kill("SIGKILL")
			} catch (error) {
				console.warn(
					`[ExecaTerminalProcess#abort] Failed to kill subprocess: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		})
		// kilocode_change end
	}

	public override hasUnretrievedOutput() {
		return this.lastRetrievedIndex < this.fullOutput.length
	}

	public override getUnretrievedOutput() {
		let output = this.fullOutput.slice(this.lastRetrievedIndex)
		let index = output.lastIndexOf("\n")

		if (index === -1) {
			return ""
		}

		index++
		this.lastRetrievedIndex += index

		// console.log(
		// 	`[ExecaTerminalProcess#getUnretrievedOutput] fullOutput.length=${this.fullOutput.length} lastRetrievedIndex=${this.lastRetrievedIndex}`,
		// 	output.slice(0, index),
		// )

		return output.slice(0, index)
	}

	private emitRemainingBufferIfListening() {
		if (!this.isListening) {
			return
		}

		const output = this.getUnretrievedOutput()

		if (output !== "") {
			this.emit("line", output)
		}
	}
}
