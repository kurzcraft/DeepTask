import * as vscode from "vscode"

import { RooTerminal, RooTerminalProvider } from "./types"
import { TerminalProcess } from "./TerminalProcess"
import { DEEPTASK_TERMINAL_NAME, LEGACY_KILOCODE_TERMINAL_NAME, Terminal } from "./Terminal"
import { ExecaTerminal } from "./ExecaTerminal"
import { ShellIntegrationManager } from "./ShellIntegrationManager"
import { getTerminalShellExecutionStream } from "./TerminalShellExecutionStream"

// Although vscode.window.terminals provides a list of all open terminals,
// there's no way to know whether they're busy or not (exitStatus does not
// provide useful information for most commands). In order to prevent creating
// too many terminals, we need to keep track of terminals through the life of
// the extension, as well as session specific terminals for the life of a task
// (to get latest unretrieved output).
// Since we have promises keeping track of terminal processes, we get the added
// benefit of keep track of busy terminals even after a task is closed.

export class TerminalRegistry {
	private static terminals: RooTerminal[] = []
	private static nextTerminalId = 1
	private static disposables: vscode.Disposable[] = []
	private static isInitialized = false
	// kilocode_change start
	private static completedTerminalLimitEnabled = true
	private static completedTerminalLimit = 3
	private static completedTerminalOrder = new WeakMap<vscode.Terminal, number>()
	// Unknown terminals are never eligible for automatic pruning because VS Code
	// does not expose enough state to prove that their current shell command ended.
	// VS Code updates exitStatus asynchronously after dispose(). Keep an explicit
	// tombstone so duplicate shell-end / promise-finally notifications cannot
	// resurrect or dispose the same terminal again during that window.
	private static disposedCompletedTerminals = new WeakSet<vscode.Terminal>()
	private static nextCompletedTerminalOrder = 1
	// kilocode_change end

	public static initialize() {
		if (this.isInitialized) {
			throw new Error("TerminalRegistry.initialize() should only be called once")
		}

		this.isInitialized = true

		// Re-register terminals that survived an extension-host restart. VS Code
		// keeps these terminal objects alive, but the extension's in-memory registry
		// is rebuilt from scratch. A terminal that survived the restart has no
		// command process owned by this extension anymore, so it is treated as a
		// retained completed terminal and participates in the configured bound.
		this.restoreExistingTerminals(true)
		this.pruneCompletedVscodeTerminals()

		// TODO: This initialization code is VSCode specific, and therefore
		// should probably live elsewhere.

		// Register handler for terminal close events to clean up temporary
		// directories.
		const closeDisposable = vscode.window.onDidCloseTerminal((vsceTerminal) => {
			const terminal = this.getTerminalByVSCETerminal(vsceTerminal)

			if (terminal) {
				this.removeTerminal(terminal.id)
			}
		})

		this.disposables.push(closeDisposable)

		try {
			const startDisposable = vscode.window.onDidStartTerminalShellExecution?.(
				async (e: vscode.TerminalShellExecutionStartEvent) => {
					// kilocode_change start
					// Reuse the stream claimed by executeCommand(). Reading the same
					// execution twice can create competing consumers and lose output.
					const stream = getTerminalShellExecutionStream(e.execution)
					// kilocode_change end
					const terminal = this.getTerminalByVSCETerminal(e.terminal)

					console.info("[onDidStartTerminalShellExecution]", {
						command: e.execution?.commandLine?.value,
						terminalId: terminal?.id,
					})

					if (terminal) {
						if (stream) {
							terminal.setActiveStream(stream)
						}
						terminal.busy = true // Mark terminal as busy when shell execution starts
					} else {
						console.error(
							"[onDidStartTerminalShellExecution] Shell execution started, but not from a Kilo Code-registered terminal:",
							e,
						)
					}
				},
			)

			if (startDisposable) {
				this.disposables.push(startDisposable)
			}

			const endDisposable = vscode.window.onDidEndTerminalShellExecution?.(
				async (e: vscode.TerminalShellExecutionEndEvent) => {
					const terminal = this.getTerminalByVSCETerminal(e.terminal)
					const process = terminal?.process
					const exitDetails = TerminalProcess.interpretExitCode(e.exitCode)

					console.info("[onDidEndTerminalShellExecution]", {
						command: e.execution?.commandLine?.value,
						terminalId: terminal?.id,
						...exitDetails,
					})

					if (!terminal) {
						console.error(
							"[onDidEndTerminalShellExecution] Shell execution ended, but not from a Kilo Code-registered terminal:",
							e,
						)

						return
					}

					if (!terminal.running) {
						console.error(
							"[TerminalRegistry] Shell execution end event received, but process is not running for terminal:",
							{ terminalId: terminal?.id, command: process?.command, exitCode: e.exitCode },
						)

						// Stream-close can finish before the shell end event. Complete the
						// process here as well, otherwise the active process blocks pruning.
						this.completeTerminalProcess(terminal, process)
						return
					}

					if (!process) {
						console.error(
							"[TerminalRegistry] Shell execution end event received on running terminal, but process is undefined:",
							{ terminalId: terminal.id, exitCode: e.exitCode },
						)

						this.completeTerminalProcess(terminal)
						return
					}

					// Signal completion to any waiting processes and make the terminal
					// eligible for retention pruning immediately.
					terminal.shellExecutionComplete(exitDetails)
					this.markTerminalCompleted(terminal)
					this.pruneCompletedVscodeTerminals()
				},
			)

			if (endDisposable) {
				this.disposables.push(endDisposable)
			}
		} catch (error) {
			console.error("[TerminalRegistry] Error setting up shell execution handlers:", error)
		}
	}

	public static createTerminal(cwd: string, provider: RooTerminalProvider): RooTerminal {
		let newTerminal

		if (provider === "vscode") {
			newTerminal = new Terminal(this.nextTerminalId++, undefined, cwd)
		} else {
			newTerminal = new ExecaTerminal(this.nextTerminalId++, cwd)
		}

		this.terminals.push(newTerminal)

		return newTerminal
	}

	/**
	 * Gets an existing terminal or creates a new one for the given working
	 * directory.
	 *
	 * @param cwd The working directory path
	 * @param taskId Optional task ID to associate with the terminal
	 * @returns A Terminal instance
	 */
	public static async getOrCreateTerminal(
		cwd: string,
		taskId?: string,
		provider: RooTerminalProvider = "vscode",
	): Promise<RooTerminal> {
		// Every command gets an isolated terminal. Retention is evaluated only
		// when commands complete (and when surviving terminals are restored at
		// extension startup), so running integrated terminals are never counted.
		const terminal = this.createTerminal(cwd, provider)

		// kilocode_change start
		this.markTerminalInUse(terminal)
		// kilocode_change end
		terminal.taskId = taskId

		return terminal
	}

	/**
	 * Gets unretrieved output from a terminal process.
	 *
	 * @param id The terminal ID
	 * @returns The unretrieved output as a string, or empty string if terminal not found
	 */
	public static getUnretrievedOutput(id: number): string {
		return this.getTerminalById(id)?.getUnretrievedOutput() ?? ""
	}

	/**
	 * Checks if a terminal process is "hot" (recently active).
	 *
	 * @param id The terminal ID
	 * @returns True if the process is hot, false otherwise
	 */
	public static isProcessHot(id: number): boolean {
		return this.getTerminalById(id)?.process?.isHot ?? false
	}

	/**
	 * Gets terminals filtered by busy state and optionally by task id.
	 *
	 * @param busy Whether to get busy or non-busy terminals
	 * @param taskId Optional task ID to filter terminals by
	 * @returns Array of Terminal objects
	 */
	public static getTerminals(busy: boolean, taskId?: string): RooTerminal[] {
		return this.getAllTerminals().filter((t) => {
			// Filter by busy state.
			if (t.busy !== busy) {
				return false
			}

			// If taskId is provided, also filter by taskId.
			if (taskId !== undefined && t.taskId !== taskId) {
				return false
			}

			return true
		})
	}

	/**
	 * Gets background terminals (taskId undefined) that have unretrieved output
	 * or are still running.
	 *
	 * @param busy Whether to get busy or non-busy terminals
	 * @returns Array of Terminal objects
	 */
	public static getBackgroundTerminals(busy?: boolean): RooTerminal[] {
		return this.getAllTerminals().filter((t) => {
			// Only get background terminals (taskId undefined).
			if (t.taskId !== undefined) {
				return false
			}

			// If busy is undefined, return all background terminals.
			if (busy === undefined) {
				return t.getProcessesWithOutput().length > 0 || t.process?.hasUnretrievedOutput()
			}

			// Filter by busy state.
			return t.busy === busy
		})
	}

	// kilocode_change start
	public static setCompletedTerminalLimitEnabled(enabled: boolean): void {
		this.completedTerminalLimitEnabled = enabled
		this.enforceCompletedTerminalLimit()
	}

	public static getCompletedTerminalLimitEnabled(): boolean {
		return this.completedTerminalLimitEnabled
	}

	public static setCompletedTerminalLimit(limit: number): void {
		this.completedTerminalLimit = Math.max(0, Math.floor(limit))
		this.enforceCompletedTerminalLimit()
	}

	public static getCompletedTerminalLimit(): number {
		return this.completedTerminalLimit
	}
	// kilocode_change end

	public static cleanup() {
		// Clean up all temporary directories.
		ShellIntegrationManager.clear()
		this.disposables.forEach((disposable) => disposable.dispose())
		this.disposables = []
	}

	/**
	 * Releases all terminals associated with a task.
	 *
	 * @param taskId The task ID
	 */
	public static releaseTerminalsForTask(taskId: string): void {
		this.terminals.forEach((terminal) => {
			if (terminal.taskId === taskId) {
				terminal.taskId = undefined
			}
		})
	}

	// kilocode_change start
	/**
	 * Re-register Deeptask terminals that VS Code kept alive while the extension
	 * host restarted. This restores event routing and makes the startup terminal
	 * bound enforceable before the first new command is allocated.
	 */
	private static restoreExistingTerminals(assumeCompleted = false): void {
		const existingTerminals = vscode.window.terminals ?? []

		for (const vsceTerminal of existingTerminals) {
			if (
				vsceTerminal.name !== DEEPTASK_TERMINAL_NAME &&
				vsceTerminal.name !== LEGACY_KILOCODE_TERMINAL_NAME
			) {
				continue
			}

			if (this.getTerminalByVSCETerminal(vsceTerminal)) {
				continue
			}

			const cwd =
				vsceTerminal.shellIntegration?.cwd?.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ""
			const restored = new Terminal(this.nextTerminalId++, vsceTerminal, cwd)
			if (assumeCompleted) {
				// The old extension-host process is gone. No command process can still be
				// owned by this registry, so restored terminals are eligible for retention
				// pruning immediately. New commands call markTerminalInUse() before run.
				restored.hasCompletedCommand = true
				this.markTerminalCompleted(restored)
			} else {
				this.terminals.push(restored)
			}
		}
	}

	/**
	 * Reconcile host terminals before every allocation/configuration boundary.
	 * VS Code can materialize terminals after activation, so relying only on the
	 * initial snapshot allows late Deeptask terminals to bypass retention.
	 */
	public static enforceCompletedTerminalLimit(): void {
		// Only terminals registered by this extension can be classified safely.
		// Unknown host terminals may belong to the user or another extension.
		this.pruneCompletedVscodeTerminals()
	}

	private static markTerminalInUse(terminal: RooTerminal): void {
		terminal.hasCompletedCommand = false

		if (terminal instanceof Terminal) {
			this.completedTerminalOrder.delete(terminal.terminal)
		}

		this.terminals = [...this.terminals.filter((t) => t !== terminal), terminal]
	}

	private static isCompletedVscodeTerminal(terminal: RooTerminal): boolean {
		return (
			terminal instanceof Terminal &&
			terminal.provider === "vscode" &&
			terminal.hasCompletedCommand &&
			!terminal.busy &&
			!terminal.running &&
			!terminal.isClosed()
		)
	}

	private static isRetainedCompletedTerminal(terminal: RooTerminal): boolean {
		return this.isCompletedVscodeTerminal(terminal) && !terminal.process
	}

	private static completeTerminalProcess(terminal: RooTerminal, completedProcess?: RooTerminal["process"]): void {
		if (terminal instanceof Terminal && terminal.provider === "vscode" && !terminal.isClosed()) {
			terminal.busy = false
			terminal.running = false
			if (completedProcess && terminal.process === completedProcess) {
				if (completedProcess.hasUnretrievedOutput()) {
					terminal.completedProcesses.unshift(completedProcess)
				}
				terminal.process = undefined
			}
			this.markTerminalCompleted(terminal)
			this.pruneCompletedVscodeTerminals()
		}
	}

	public static notifyTerminalProcessCompleted(terminal: RooTerminal, completedProcess?: RooTerminal["process"]): void {
		// An old process can settle after the same terminal has already started a
		// replacement command (for example after force-continue). Its late callback
		// must not mark the replacement terminal as completed or trigger pruning.
		if (completedProcess && terminal.process && terminal.process !== completedProcess) {
			return
		}

		// kilocode_change start
		// Command completion must always re-check the completed-terminal limit.
		// Do not require hasCompletedCommand beforehand: shell end events can be
		// missing (heredoc / stream-close races). Force-complete + prune every time
		// a VS Code integrated terminal command promise settles.
		if (
			!(terminal instanceof Terminal) ||
			terminal.provider !== "vscode" ||
			terminal.isClosed() ||
			this.disposedCompletedTerminals.has(terminal.terminal)
		) {
			return
		}

		this.completeTerminalProcess(terminal, completedProcess)
		// kilocode_change end
	}

	private static markTerminalCompleted(terminal: RooTerminal): void {
		terminal.hasCompletedCommand = true

		if (terminal instanceof Terminal && !this.completedTerminalOrder.has(terminal.terminal)) {
			this.completedTerminalOrder.set(terminal.terminal, this.nextCompletedTerminalOrder++)
		}

		this.terminals = [...this.terminals.filter((t) => t !== terminal), terminal]
	}

	private static pruneCompletedVscodeTerminals(): void {
		if (!this.completedTerminalLimitEnabled) {
			return
		}

		// Remove tombstoned wrappers before collecting candidates. This makes the
		// configured limit an invariant even while VS Code still exposes a disposed
		// terminal with exitStatus === undefined.
		this.terminals = this.terminals.filter(
			(terminal) => !(terminal instanceof Terminal && this.disposedCompletedTerminals.has(terminal.terminal)),
		)

		type CompletedCandidate = { kind: "registered"; terminal: Terminal; order: number }

		const registeredCompletedTerminalByVsceTerminal = new Map<vscode.Terminal, Terminal>(
			this.getAllTerminals()
				.filter((t): t is Terminal => this.isCompletedVscodeTerminal(t))
				.map((terminal) => [terminal.terminal, terminal]),
		)
		// Prefer the live VS Code terminal list, but fall back to the registry so
		// unit tests and racey window.terminals snapshots still prune correctly.
		const windowTerminals = vscode.window.terminals ?? []
		const completedFromWindow = windowTerminals.flatMap((terminal): CompletedCandidate[] => {
			const registeredTerminal = registeredCompletedTerminalByVsceTerminal.get(terminal)

			if (registeredTerminal) {
				let order = this.completedTerminalOrder.get(registeredTerminal.terminal)

				if (order === undefined) {
					order = this.nextCompletedTerminalOrder++
					this.completedTerminalOrder.set(registeredTerminal.terminal, order)
				}

				return [{ kind: "registered", terminal: registeredTerminal, order }]
			}

			// Do not infer completion from a title or an undefined exitStatus. An
			// unregistered terminal may still be running a long-lived command.
			return []
		})
		const completedFromRegistry = [...registeredCompletedTerminalByVsceTerminal.values()]
			.filter((terminal) => !completedFromWindow.some((c) => c.kind === "registered" && c.terminal === terminal))
			.map((terminal) => {
				let order = this.completedTerminalOrder.get(terminal.terminal)

				if (order === undefined) {
					order = this.nextCompletedTerminalOrder++
					this.completedTerminalOrder.set(terminal.terminal, order)
				}

				return { kind: "registered" as const, terminal, order }
			})
		const completedVscodeTerminals = [...completedFromWindow, ...completedFromRegistry]
		const terminalsToClose = completedVscodeTerminals
			.sort((left, right) => left.order - right.order)
			.slice(0, Math.max(0, completedVscodeTerminals.length - this.completedTerminalLimit))

		for (const candidate of terminalsToClose) {
			const vsceTerminal = candidate.terminal.terminal
			if (this.disposedCompletedTerminals.has(vsceTerminal)) {
				continue
			}

			// Re-check immediately before disposal because a command may have started
			// after candidate collection.
			if (!this.isCompletedVscodeTerminal(candidate.terminal)) {
				continue
			}

			// Tombstone before dispose(): dispose synchronously triggers close hooks in
			// some hosts and asynchronously in others.
			this.disposedCompletedTerminals.add(vsceTerminal)
			vsceTerminal.dispose()
			this.removeTerminal(candidate.terminal.id)
		}
	}
	// kilocode_change end

	private static getAllTerminals(): RooTerminal[] {
		this.terminals = this.terminals.filter((t) => !t.isClosed())
		return this.terminals
	}

	private static getTerminalById(id: number): RooTerminal | undefined {
		const terminal = this.terminals.find((t) => t.id === id)

		if (terminal?.isClosed()) {
			this.removeTerminal(id)
			return undefined
		}

		return terminal
	}

	/**
	 * Gets a terminal by its VSCode terminal instance
	 * @param terminal The VSCode terminal instance
	 * @returns The Terminal object, or undefined if not found
	 */
	private static getTerminalByVSCETerminal(vsceTerminal: vscode.Terminal): RooTerminal | undefined {
		const found = this.terminals.find((t) => t instanceof Terminal && t.terminal === vsceTerminal)

		if (found?.isClosed()) {
			this.removeTerminal(found.id)
			return undefined
		}

		return found
	}

	private static removeTerminal(id: number) {
		ShellIntegrationManager.zshCleanupTmpDir(id)
		this.terminals = this.terminals.filter((t) => t.id !== id)
	}
}
