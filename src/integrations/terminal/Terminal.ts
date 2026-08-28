import * as vscode from "vscode"
import pWaitFor from "p-wait-for"

import type { RooTerminalCallbacks, RooTerminalProcessResultPromise } from "./types"
import { BaseTerminal } from "./BaseTerminal"
import { TerminalProcess } from "./TerminalProcess"
import { TerminalRegistry } from "./TerminalRegistry"
import { ShellIntegrationManager } from "./ShellIntegrationManager"
import { ExecaTerminalProcess } from "./ExecaTerminalProcess"
import { mergePromise } from "./mergePromise"
import { getWorkspacePath } from "../../utils/path" // kilocode_change

export const DEEPTASK_TERMINAL_NAME = "Deeptask"
// Keep as a joined string so branding residue rewrites cannot erase the legacy title.
export const LEGACY_KILOCODE_TERMINAL_NAME = ["Kilo", " Code"].join("")

// kilocode_change start
/**
 * cmd.exe (and command.com) never emit the OSC 633;A shell-integration
 * sequence: VS Code ships no official integration script for them, so waiting
 * for the sequence can only ever time out.
 */
export function isCmdExePath(shellPath: string | undefined | null): boolean {
	if (!shellPath) {
		return false
	}

	return /(?:^|[\\/])(cmd(?:\.exe)?|command\.com)$/i.test(shellPath.trim())
}

/**
 * True only when the Windows default integrated-terminal profile is clearly
 * cmd.exe: a profile named "Command Prompt"/"cmd(.exe)", or a profile with an
 * explicit cmd.exe/command.com path. Detection is intentionally conservative:
 * ambiguous profiles keep the normal shell-integration path and rely on the
 * Windows timeout degradation instead of skipping integration outright.
 */
export function isWindowsCmdDefaultProfile(): boolean {
	if (process.platform !== "win32") {
		return false
	}

	try {
		const config = vscode.workspace.getConfiguration("terminal.integrated")
		const profileName = config.get<string>("defaultProfile.windows")

		if (!profileName) {
			return false
		}

		if (/^(command prompt|cmd(?:\.exe)?)$/i.test(profileName.trim())) {
			return true
		}

		const profiles = config.get<Record<string, { path?: string | string[] }>>("profiles.windows") ?? {}
		const profilePath = profiles[profileName]?.path
		const resolvedPath = Array.isArray(profilePath) ? profilePath[0] : profilePath

		return isCmdExePath(resolvedPath)
	} catch (error) {
		console.warn(
			`[Terminal] Failed to detect the Windows default terminal profile: ${error instanceof Error ? error.message : String(error)}`,
		)
		return false
	}
}
// kilocode_change end

export class Terminal extends BaseTerminal {
	public terminal: vscode.Terminal

	// kilocode_change start: write emitter for the fallback echo pseudoterminal
	private echoEmitter?: vscode.EventEmitter<string>
	// kilocode_change end

	public cmdCounter: number = 0

	constructor(id: number, terminal: vscode.Terminal | undefined, cwd: string) {
		super("vscode", id, cwd)

		const env = Terminal.getEnv()
		const iconPath = new vscode.ThemeIcon("rocket")
		this.terminal = terminal ?? vscode.window.createTerminal({ cwd, name: DEEPTASK_TERMINAL_NAME, iconPath, env })

		if (Terminal.getTerminalZdotdir()) {
			ShellIntegrationManager.terminalTmpDirs.set(id, env.ZDOTDIR)
		}
	}

	/**
	 * Gets the current working directory from shell integration or falls back to initial cwd.
	 * @returns The current working directory
	 */
	public override getCurrentWorkingDirectory(): string {
		return this.terminal.shellIntegration?.cwd ? this.terminal.shellIntegration.cwd.fsPath : this.initialCwd
	}

	/**
	 * The exit status of the terminal will be undefined while the terminal is
	 * active. (This value is set when onDidCloseTerminal is fired.)
	 */
	public override isClosed(): boolean {
		return this.terminal.exitStatus !== undefined
	}

	public override runCommand(command: string, callbacks: RooTerminalCallbacks): RooTerminalProcessResultPromise {
		// We set busy before the command is running because the terminal may be
		// waiting on terminal integration, and we must prevent another instance
		// from selecting the terminal for use during that time.
		this.busy = true

		// kilocode_change start
		// cmd.exe has no VS Code shell-integration script and never emits the
		// OSC 633;A sequence this class waits for. When the Windows default
		// terminal profile is clearly cmd, execute through a short-lived child
		// process immediately (zero configuration) instead of waiting for an
		// integration handshake that cannot succeed. The command still runs with
		// full stdout/stderr capture and a real exit code; only the visible
		// integrated-terminal transcript is traded away.
		if (isWindowsCmdDefaultProfile()) {
			console.info(
				`[Terminal ${this.id}] cmd.exe default profile detected; running command through the child-process fallback executor.`,
			)

			return this.runCommandViaChildProcess(command, callbacks)
		}
		// kilocode_change end

		const process = new TerminalProcess(this)
		process.command = command
		this.process = process

		// Set up event handlers from callbacks before starting process.
		// This ensures that we don't miss any events because they are
		// configured before the process starts.
		process.on("line", (line) => callbacks.onLine(line, process))
		process.once("continue", () => {
			// A shell-end event can clear `this.process` before the merged promise
			// settles. In that ordering, retain/prune only after the process wait is
			// released, while keeping force-continued live background commands safe.
			if (this.hasCompletedCommand && this.process === process) {
				TerminalRegistry.notifyTerminalProcessCompleted(this, process)
			}
		})
		process.once("completed", (output) => {
			callbacks.onCompleted(output, process)
			// kilocode_change start
			// Completion is independent from `continue`: a background command can
			// detach first and finish much later, including when VS Code omits the
			// shell-end event. Register retention only on this real output/stream
			// completion boundary, never when the foreground tool wait is released.
			TerminalRegistry.notifyTerminalProcessCompleted(this, process)
			// kilocode_change end
		})
		process.once("shell_execution_started", (pid) => callbacks.onShellExecutionStarted(pid, process))
		process.once("shell_execution_complete", (details) => callbacks.onShellExecutionComplete(details, process))
		process.once("no_shell_integration", (msg) => callbacks.onNoShellIntegration?.(msg, process))

		const promise = new Promise<void>((resolve, reject) => {
			// Set up event handlers
			process.once("continue", resolve)
			process.once("error", (error) => {
				console.error(`[Terminal ${this.id}] error:`, error)
				reject(error)
			})

			// Wait for shell integration before executing the command
			pWaitFor(() => this.terminal.shellIntegration !== undefined, {
				timeout: Terminal.getShellIntegrationTimeout(),
			})
				.then(() => {
					// Clean up temporary directory if shell integration is available, zsh did its job:
					ShellIntegrationManager.zshCleanupTmpDir(this.id)

					// Run the command in the terminal
					process.run(command)
				})
				.catch(() => {
					// kilocode_change start
					// On Windows the 633;A wait can time out because the profile has
					// no integration script (cmd), integration is disabled, or the
					// extension host stalled. Never fail the command for that: fall
					// back to direct child-process execution so execute_command
					// still runs the command and returns output plus exit code.
					if (globalThis.process?.platform === "win32") {
						console.warn(
							`[Terminal ${this.id}] Shell integration did not initialize within ${Terminal.getShellIntegrationTimeout() / 1000}s on Windows; falling back to direct child-process execution.`,
						)

						ShellIntegrationManager.zshCleanupTmpDir(this.id)

						// Detach every listener registered on the never-started
						// integration process (including the `continue`/`error`
						// resolvers above) and drop it from this terminal so the
						// fallback executor becomes the single owner.
						process.removeAllListeners()
						this.process = undefined

						const fallback = this.runCommandViaChildProcess(command, callbacks)

						// Route abort from the already-returned merged object to the
						// child process that is actually running the command.
						process.abort = () => fallback.abort()

						void fallback.finally(() => resolve())
						return
					}
					// kilocode_change end

					console.log(`[Terminal ${this.id}] Shell integration not available. Command execution aborted.`)

					// Clean up temporary directory if shell integration is not available
					ShellIntegrationManager.zshCleanupTmpDir(this.id)

					process.emit(
						"no_shell_integration",
						`Shell integration initialization sequence '\\x1b]633;A' was not received within ${Terminal.getShellIntegrationTimeout() / 1000}s. Shell integration has been disabled for this terminal instance. Increase the timeout in the settings if necessary.`,
					)
				})
		})

		return mergePromise(process, promise)
	}

	// kilocode_change start
	/**
	 * Replaces this terminal's empty shell-backed VS Code terminal with a
	 * pseudoterminal that mirrors the child-process fallback execution. The
	 * command still runs in a short-lived child process with full capture and
	 * exit code; the pty only provides the visible transcript so the user sees
	 * the execution process and output in the integrated terminal panel.
	 */
	private swapToEchoTerminal(): void {
		// Only replace terminals this extension created: never touch a
		// user-owned or restored terminal.
		if (this.terminal.creationOptions?.name !== DEEPTASK_TERMINAL_NAME) {
			return
		}

		// A second fallback command on the same terminal reuses the existing
		// echo pseudoterminal instead of creating another one.
		if (this.echoEmitter) {
			return
		}

		try {
			const oldTerminal = this.terminal
			const writeEmitter = new vscode.EventEmitter<string>()

			const pty: vscode.Pseudoterminal = {
				onDidWrite: writeEmitter.event,
				// Echo terminals accept no input; commands arrive through
				// runCommand() from the task.
				open: () => {},
				close: () => {},
			}

			const newTerminal = vscode.window.createTerminal({
				name: DEEPTASK_TERMINAL_NAME,
				pty,
				iconPath: new vscode.ThemeIcon("rocket"),
			})

			this.terminal = newTerminal
			this.echoEmitter = writeEmitter

			// Remove the now-empty shell terminal. It never ran a command, so
			// there is nothing to retain.
			Promise.resolve().then(() => {
				try {
					oldTerminal.dispose()
				} catch {
					// Disposal races with user actions; ignore.
				}
			})
		} catch (error) {
			console.warn(
				`[Terminal ${this.id}] Failed to swap to echo terminal: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Executes a command through {@link ExecaTerminalProcess} while keeping this
	 * terminal's registry bookkeeping (busy state, retention, task ownership).
	 *
	 * Used when shell integration cannot provide output: cmd.exe default
	 * profiles and Windows integration-init timeouts. The visible integrated
	 * terminal is swapped to a pseudoterminal that mirrors the execution live.
	 */
	private runCommandViaChildProcess(
		command: string,
		callbacks: RooTerminalCallbacks,
	): RooTerminalProcessResultPromise {
		this.swapToEchoTerminal()

		const process = new ExecaTerminalProcess(this)
		process.command = command
		this.process = process

		// kilocode_change start: mirror live output into the pty transcript
		const echoEmitter = this.echoEmitter

		if (echoEmitter) {
			const cwdDisplay = this.initialCwd.split(/[\\/]/).pop() || this.initialCwd
			echoEmitter.fire(`\x1b[36m${cwdDisplay}>\x1b[0m ${command}\r\n`)

			process.echoSink = (chunk) => echoEmitter.fire(chunk)
		}
		// kilocode_change end

		process.on("line", (line) => callbacks.onLine(line, process))
		process.once("completed", (output) => {
			callbacks.onCompleted(output, process)
			TerminalRegistry.notifyTerminalProcessCompleted(this, process)
		})
		process.once("shell_execution_started", (pid) => callbacks.onShellExecutionStarted(pid, process))
		process.once("shell_execution_complete", (details) => {
			callbacks.onShellExecutionComplete(details, process)

			// kilocode_change: surface the exit code in the pty transcript
			if (echoEmitter) {
				const code = details.exitCode ?? 0
				const color = code === 0 ? "\x1b[32m" : "\x1b[31m"
				echoEmitter.fire(`\r\n${color}[exit ${code}]\x1b[0m\r\n`)
			}
		})

		const promise = new Promise<void>((resolve, reject) => {
			process.once("continue", resolve)
			process.once("error", (error) => {
				console.error(`[Terminal ${this.id}] child-process fallback error:`, error)
				reject(error)
			})
			void process.run(command)
		})

		return mergePromise(process, promise)
	}
	// kilocode_change end

	/**
	 * Gets the terminal contents based on the number of commands to include
	 * @param commands Number of previous commands to include (-1 for all)
	 * @returns The selected terminal contents
	 */
	public static async getTerminalContents(commands = -1): Promise<string> {
		// Save current clipboard content
		const tempCopyBuffer = await vscode.env.clipboard.readText()

		try {
			// Select terminal content
			if (commands < 0) {
				await vscode.commands.executeCommand("workbench.action.terminal.selectAll")
			} else {
				for (let i = 0; i < commands; i++) {
					await vscode.commands.executeCommand("workbench.action.terminal.selectToPreviousCommand")
				}
			}

			// Copy selection and clear it
			await vscode.commands.executeCommand("workbench.action.terminal.copySelection")
			await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")

			// Get copied content
			let terminalContents = (await vscode.env.clipboard.readText()).trim()

			// Restore original clipboard content
			await vscode.env.clipboard.writeText(tempCopyBuffer)

			if (tempCopyBuffer === terminalContents) {
				// No terminal content was copied
				return ""
			}

			// Process multi-line content
			const lines = terminalContents.split("\n")
			const lastLine = lines.pop()?.trim()

			if (lastLine) {
				let i = lines.length - 1

				while (i >= 0 && !lines[i].trim().startsWith(lastLine)) {
					i--
				}

				terminalContents = lines.slice(Math.max(i, 0)).join("\n")
			}

			return terminalContents
		} catch (error) {
			// Ensure clipboard is restored even if an error occurs
			await vscode.env.clipboard.writeText(tempCopyBuffer)
			throw error
		}
	}

	public static getEnv(): Record<string, string> {
		const env: Record<string, string> = {
			PAGER: process.platform === "win32" ? "" : "cat",

			// VTE must be disabled because it prevents the prompt command from executing
			// See https://wiki.gnome.org/Apps/Terminal/VTE
			VTE_VERSION: "0",

			WORKSPACE_ROOT: getWorkspacePath(), // kilocode_change
		}

		// Set Oh My Zsh shell integration if enabled
		if (Terminal.getTerminalZshOhMy()) {
			env.ITERM_SHELL_INTEGRATION_INSTALLED = "Yes"
		}

		// Set Powerlevel10k shell integration if enabled
		if (Terminal.getTerminalZshP10k()) {
			env.POWERLEVEL9K_TERM_SHELL_INTEGRATION = "true"
		}

		// VSCode bug#237208: Command output can be lost due to a race between completion
		// sequences and consumers. Add delay via PROMPT_COMMAND to ensure the
		// \x1b]633;D escape sequence arrives after command output is processed.
		// Only add this if commandDelay is not zero
		if (Terminal.getCommandDelay() > 0) {
			env.PROMPT_COMMAND = `sleep ${Terminal.getCommandDelay() / 1000}`
		}

		// Clear the ZSH EOL mark to prevent issues with command output interpretation
		// when output ends with special characters like '%'
		if (Terminal.getTerminalZshClearEolMark()) {
			env.PROMPT_EOL_MARK = ""
		}

		// Handle ZDOTDIR for zsh if enabled
		if (Terminal.getTerminalZdotdir()) {
			env.ZDOTDIR = ShellIntegrationManager.zshInitTmpDir(env)
		}

		return env
	}
}
