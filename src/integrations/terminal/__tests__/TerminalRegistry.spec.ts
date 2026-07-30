// npx vitest run src/integrations/terminal/__tests__/TerminalRegistry.spec.ts

import * as vscode from "vscode"
import { DEEPTASK_TERMINAL_NAME, LEGACY_KILOCODE_TERMINAL_NAME, Terminal } from "../Terminal"
import { TerminalRegistry } from "../TerminalRegistry"

const PAGER = process.platform === "win32" ? "" : "cat"

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("../../../utils/path", () => ({
	arePathsEqual: vi.fn((left: string, right: string) => left === right),
	getWorkspacePath: vi.fn(() => "/test/workspace"),
})) // kilocode_change

describe("TerminalRegistry", () => {
	let mockCreateTerminal: any

	beforeEach(() => {
		;(TerminalRegistry as any).terminals = []
		;(TerminalRegistry as any).completedTerminalOrder = new WeakMap()
		;(TerminalRegistry as any).disposedCompletedTerminals = new WeakSet()
		;(TerminalRegistry as any).nextCompletedTerminalOrder = 1
		;(vscode.window as any).terminals = []
		TerminalRegistry.setCompletedTerminalLimitEnabled(true)
		TerminalRegistry.setCompletedTerminalLimit(3)
		mockCreateTerminal = vi.spyOn(vscode.window, "createTerminal").mockImplementation((...args: any[]) => {
			const terminal = {
				exitStatus: undefined,
				name: DEEPTASK_TERMINAL_NAME,
				processId: Promise.resolve(123),
				creationOptions: {},
				state: {
					isInteractedWith: true,
					shell: { id: "test-shell", executable: "/bin/bash", args: [] },
				},
				dispose: vi.fn(),
				hide: vi.fn(),
				show: vi.fn(),
				sendText: vi.fn(),
				shellIntegration: {
					executeCommand: vi.fn(),
				},
			} as any
			;(vscode.window as any).terminals.push(terminal)
			return terminal
		})
	})

	afterEach(() => {
		;(TerminalRegistry as any).terminals = []
		;(vscode.window as any).terminals = []
		TerminalRegistry.setCompletedTerminalLimitEnabled(true)
		TerminalRegistry.setCompletedTerminalLimit(3)
		mockCreateTerminal.mockRestore()
	})

	describe("createTerminal", () => {
		it("creates terminal with PAGER set appropriately for platform", () => {
			TerminalRegistry.createTerminal("/test/path", "vscode")

			expect(mockCreateTerminal).toHaveBeenCalledWith({
				cwd: "/test/path",
				name: DEEPTASK_TERMINAL_NAME,
				iconPath: expect.any(Object),
				env: {
					PAGER,
					VTE_VERSION: "0",
					WORKSPACE_ROOT: "/test/workspace", // kilocode_change
					PROMPT_EOL_MARK: "",
				},
			})
		})

		it("adds PROMPT_COMMAND when Terminal.getCommandDelay() > 0", () => {
			// Set command delay to 50ms for this test
			const originalDelay = Terminal.getCommandDelay()
			Terminal.setCommandDelay(50)

			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: DEEPTASK_TERMINAL_NAME,
					iconPath: expect.any(Object),
					env: {
						PAGER,
						PROMPT_COMMAND: "sleep 0.05",
						VTE_VERSION: "0",
						WORKSPACE_ROOT: "/test/workspace", // kilocode_change
						PROMPT_EOL_MARK: "",
					},
				})
			} finally {
				// Restore original delay
				Terminal.setCommandDelay(originalDelay)
			}
		})

		it("adds Oh My Zsh integration env var when enabled", () => {
			Terminal.setTerminalZshOhMy(true)
			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: DEEPTASK_TERMINAL_NAME,
					iconPath: expect.any(Object),
					env: {
						PAGER,
						VTE_VERSION: "0",
						WORKSPACE_ROOT: "/test/workspace", // kilocode_change
						PROMPT_EOL_MARK: "",
						ITERM_SHELL_INTEGRATION_INSTALLED: "Yes",
					},
				})
			} finally {
				Terminal.setTerminalZshOhMy(false)
			}
		})

		it("adds Powerlevel10k integration env var when enabled", () => {
			Terminal.setTerminalZshP10k(true)
			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: DEEPTASK_TERMINAL_NAME,
					iconPath: expect.any(Object),
					env: {
						PAGER,
						VTE_VERSION: "0",
						WORKSPACE_ROOT: "/test/workspace", // kilocode_change
						PROMPT_EOL_MARK: "",
						POWERLEVEL9K_TERM_SHELL_INTEGRATION: "true",
					},
				})
			} finally {
				Terminal.setTerminalZshP10k(false)
			}
		})
	})

	// kilocode_change start
	describe("completed VS Code terminal limit", () => {
		it("restores Deeptask terminals that survived an extension-host restart", () => {
			const restoredDeeptask = {
				exitStatus: undefined,
				name: DEEPTASK_TERMINAL_NAME,
				shellIntegration: { cwd: { fsPath: "/test/restored" } },
				dispose: vi.fn(),
			} as any
			const restoredLegacy = {
				exitStatus: undefined,
				name: LEGACY_KILOCODE_TERMINAL_NAME,
				shellIntegration: { cwd: { fsPath: "/test/legacy" } },
				dispose: vi.fn(),
			} as any
			const unrelated = {
				exitStatus: undefined,
				name: "bash",
				dispose: vi.fn(),
			} as any
			;(vscode.window as any).terminals = [restoredDeeptask, restoredLegacy, unrelated]

			;(TerminalRegistry as any).restoreExistingTerminals()

			expect((TerminalRegistry as any).terminals).toHaveLength(2)
			expect((TerminalRegistry as any).terminals.map((terminal: Terminal) => terminal.terminal)).toEqual([
				restoredDeeptask,
				restoredLegacy,
			])
			expect((TerminalRegistry as any).terminals.every((terminal: Terminal) => terminal.hasCompletedCommand === false)).toBe(
				true,
			)
		})

		const markCompleted = (terminal: Terminal) => {
			;(TerminalRegistry as any).markTerminalCompleted(terminal)
		}

		it("disposes oldest completed VS Code terminals beyond the configured limit", () => {
			TerminalRegistry.setCompletedTerminalLimit(2)

			const first = TerminalRegistry.createTerminal("/test/one", "vscode") as Terminal
			const second = TerminalRegistry.createTerminal("/test/two", "vscode") as Terminal
			const third = TerminalRegistry.createTerminal("/test/three", "vscode") as Terminal
			markCompleted(first)
			markCompleted(second)
			markCompleted(third)

			TerminalRegistry.setCompletedTerminalLimit(2)

			expect(first.terminal.dispose).toHaveBeenCalledTimes(1)
			expect(second.terminal.dispose).not.toHaveBeenCalled()
			expect(third.terminal.dispose).not.toHaveBeenCalled()
		})

		it("does not count running VS Code terminals toward the completed terminal limit", () => {
			TerminalRegistry.setCompletedTerminalLimit(1)

			const running = TerminalRegistry.createTerminal("/test/running", "vscode") as Terminal
			const firstCompleted = TerminalRegistry.createTerminal("/test/one", "vscode") as Terminal
			const secondCompleted = TerminalRegistry.createTerminal("/test/two", "vscode") as Terminal
			running.busy = true
			running.running = true
			markCompleted(running)
			markCompleted(firstCompleted)
			markCompleted(secondCompleted)

			TerminalRegistry.setCompletedTerminalLimit(1)

			expect(running.terminal.dispose).not.toHaveBeenCalled()
			expect(firstCompleted.terminal.dispose).toHaveBeenCalledTimes(1)
			expect(secondCompleted.terminal.dispose).not.toHaveBeenCalled()
		})

		it("does not count never-run VS Code terminals toward the completed terminal limit", () => {
			TerminalRegistry.setCompletedTerminalLimit(1)

			const neverRun = TerminalRegistry.createTerminal("/test/never-run", "vscode") as Terminal
			const firstCompleted = TerminalRegistry.createTerminal("/test/one", "vscode") as Terminal
			const secondCompleted = TerminalRegistry.createTerminal("/test/two", "vscode") as Terminal
			markCompleted(firstCompleted)
			markCompleted(secondCompleted)

			TerminalRegistry.setCompletedTerminalLimit(1)

			expect(neverRun.terminal.dispose).not.toHaveBeenCalled()
			expect(firstCompleted.terminal.dispose).toHaveBeenCalledTimes(1)
			expect(secondCompleted.terminal.dispose).not.toHaveBeenCalled()
		})

		it("creates a fresh terminal for every new command", async () => {
			TerminalRegistry.setCompletedTerminalLimit(3)

			const first = await TerminalRegistry.getOrCreateTerminal("/test/path", "task-1", "vscode")
			;(first as Terminal).busy = false
			;(first as Terminal).running = false
			markCompleted(first as Terminal)

			const second = await TerminalRegistry.getOrCreateTerminal("/test/path", "task-1", "vscode")

			expect(second).not.toBe(first)
			expect(mockCreateTerminal).toHaveBeenCalledTimes(2)
		})

		it("prunes stale completed terminals after a new command terminal completes", async () => {
			TerminalRegistry.setCompletedTerminalLimit(3)

			const firstCompleted = TerminalRegistry.createTerminal("/test/path", "vscode") as Terminal
			const secondCompleted = TerminalRegistry.createTerminal("/test/path", "vscode") as Terminal
			const thirdCompleted = TerminalRegistry.createTerminal("/test/path", "vscode") as Terminal
			markCompleted(firstCompleted)
			markCompleted(secondCompleted)
			markCompleted(thirdCompleted)

			const selected = (await TerminalRegistry.getOrCreateTerminal("/test/path", "task-1", "vscode")) as Terminal
			markCompleted(selected)
			TerminalRegistry.setCompletedTerminalLimit(3)

			expect(firstCompleted.terminal.dispose).toHaveBeenCalledTimes(1)
			expect(secondCompleted.terminal.dispose).not.toHaveBeenCalled()
			expect(thirdCompleted.terminal.dispose).not.toHaveBeenCalled()
			expect(selected.terminal.dispose).not.toHaveBeenCalled()
		})

		it("prunes when a command promise completes after shellExecutionComplete without shell end pruning", async () => {
			TerminalRegistry.setCompletedTerminalLimit(1)

			const staleCompleted = TerminalRegistry.createTerminal("/test/stale", "vscode") as Terminal
			markCompleted(staleCompleted)

			const selected = (await TerminalRegistry.getOrCreateTerminal("/test/path", "task-1", "vscode")) as Terminal
			const process = selected.runCommand("printf done", {
				onLine: vi.fn(),
				onCompleted: vi.fn(),
				onShellExecutionStarted: vi.fn(),
				onShellExecutionComplete: vi.fn(),
			})

			await vi.waitFor(() => {
				expect(selected.terminal.shellIntegration?.executeCommand).toHaveBeenCalledWith("printf done")
			})

			selected.shellExecutionComplete({ exitCode: 0 })
			selected.process = process
			process.emit("continue")

			await process

			expect(staleCompleted.terminal.dispose).toHaveBeenCalledTimes(1)
			expect(selected.terminal.dispose).not.toHaveBeenCalled()
		})

		it("prunes on command promise completion even when shell end never marked hasCompletedCommand", async () => {
			// kilocode_change start
			// Heredoc / stream-close races can settle the command promise without a
			// prior shellExecutionComplete. Prune must still run every time.
			TerminalRegistry.setCompletedTerminalLimit(1)

			const staleCompleted = TerminalRegistry.createTerminal("/test/stale-no-shell-end", "vscode") as Terminal
			markCompleted(staleCompleted)

			const selected = (await TerminalRegistry.getOrCreateTerminal(
				"/test/path-no-shell-end",
				"task-no-shell-end",
				"vscode",
			)) as Terminal
			const process = selected.runCommand("python3 - <<'PY'\nprint(1)\nPY", {
				onLine: vi.fn(),
				onCompleted: vi.fn(),
				onShellExecutionStarted: vi.fn(),
				onShellExecutionComplete: vi.fn(),
			})

			await vi.waitFor(() => {
				expect(selected.terminal.shellIntegration?.executeCommand).toHaveBeenCalled()
			})

			// Simulate stream/continue settle without shellExecutionComplete.
			selected.busy = false
			selected.running = false
			selected.hasCompletedCommand = false
			selected.process = process
			process.emit("continue")

			await process

			expect(selected.hasCompletedCommand).toBe(true)
			expect(staleCompleted.terminal.dispose).toHaveBeenCalledTimes(1)
			expect(selected.terminal.dispose).not.toHaveBeenCalled()
			// kilocode_change end
		})

		it("prunes after notifyTerminalProcessCompleted without requiring prior completed flags", () => {
			// kilocode_change start
			TerminalRegistry.setCompletedTerminalLimit(1)

			const staleCompleted = TerminalRegistry.createTerminal("/test/stale-notify", "vscode") as Terminal
			markCompleted(staleCompleted)

			const selected = TerminalRegistry.createTerminal("/test/path-notify", "vscode") as Terminal
			selected.busy = true
			selected.running = true
			selected.hasCompletedCommand = false

			TerminalRegistry.notifyTerminalProcessCompleted(selected)

			expect(selected.hasCompletedCommand).toBe(true)
			expect(selected.busy).toBe(false)
			expect(selected.running).toBe(false)
			expect(staleCompleted.terminal.dispose).toHaveBeenCalledTimes(1)
			expect(selected.terminal.dispose).not.toHaveBeenCalled()
			// kilocode_change end
		})

		it("clears a settled active process before completed-terminal pruning", () => {
			TerminalRegistry.setCompletedTerminalLimit(1)

			const staleCompleted = TerminalRegistry.createTerminal("/test/stale-active", "vscode") as Terminal
			markCompleted(staleCompleted)

			const selected = TerminalRegistry.createTerminal("/test/selected-active", "vscode") as Terminal
			const settledProcess = {
				hasUnretrievedOutput: vi.fn(() => true),
			} as any
			selected.process = settledProcess
			selected.busy = true
			selected.running = true

			TerminalRegistry.notifyTerminalProcessCompleted(selected, settledProcess)

			expect(selected.process).toBeUndefined()
			expect(selected.completedProcesses).toContain(settledProcess)
			expect(staleCompleted.terminal.dispose).toHaveBeenCalledTimes(1)
		})

		it("ignores a late completion callback from an older process after replacement command starts", () => {
			TerminalRegistry.setCompletedTerminalLimit(0)

			const terminal = TerminalRegistry.createTerminal("/test/replaced", "vscode") as Terminal
			const oldProcess = { abort: vi.fn() } as any
			const newProcess = { abort: vi.fn() } as any
			terminal.process = newProcess
			terminal.busy = true
			terminal.running = true

			TerminalRegistry.notifyTerminalProcessCompleted(terminal, oldProcess)

			expect(terminal.process).toBe(newProcess)
			expect(terminal.busy).toBe(true)
			expect(terminal.running).toBe(true)
			expect(terminal.hasCompletedCommand).toBe(false)
			expect(terminal.terminal.dispose).not.toHaveBeenCalled()
		})

		it("does not resurrect or dispose a pruned terminal on duplicate completion notification", () => {
			TerminalRegistry.setCompletedTerminalLimit(1)

			const oldest = TerminalRegistry.createTerminal("/test/oldest-duplicate", "vscode") as Terminal
			const newest = TerminalRegistry.createTerminal("/test/newest-duplicate", "vscode") as Terminal
			markCompleted(oldest)
			markCompleted(newest)

			TerminalRegistry.setCompletedTerminalLimit(1)
			TerminalRegistry.notifyTerminalProcessCompleted(oldest)
			TerminalRegistry.notifyTerminalProcessCompleted(oldest)

			expect(oldest.terminal.dispose).toHaveBeenCalledTimes(1)
			expect(newest.terminal.dispose).not.toHaveBeenCalled()
			expect((TerminalRegistry as any).terminals).not.toContain(oldest)
		})

		it("disposes the oldest completed terminal even when VS Code terminal order is reversed", () => {
			TerminalRegistry.setCompletedTerminalLimit(1)

			const oldest = TerminalRegistry.createTerminal("/test/oldest", "vscode") as Terminal
			const newest = TerminalRegistry.createTerminal("/test/newest", "vscode") as Terminal
			markCompleted(oldest)
			markCompleted(newest)
			;(vscode.window as any).terminals = [newest.terminal, oldest.terminal]

			TerminalRegistry.setCompletedTerminalLimit(1)

			expect(oldest.terminal.dispose).toHaveBeenCalledTimes(1)
			expect(newest.terminal.dispose).not.toHaveBeenCalled()
		})

		it("keeps the latest completed terminals rather than the latest created terminals", () => {
			TerminalRegistry.setCompletedTerminalLimit(1)

			const createdFirstCompletedLast = TerminalRegistry.createTerminal(
				"/test/created-first",
				"vscode",
			) as Terminal
			const createdLastCompletedFirst = TerminalRegistry.createTerminal(
				"/test/created-last",
				"vscode",
			) as Terminal
			markCompleted(createdLastCompletedFirst)
			markCompleted(createdFirstCompletedLast)
			;(vscode.window as any).terminals = [createdLastCompletedFirst.terminal, createdFirstCompletedLast.terminal]

			TerminalRegistry.setCompletedTerminalLimit(1)

			expect(createdLastCompletedFirst.terminal.dispose).toHaveBeenCalledTimes(1)
			expect(createdFirstCompletedLast.terminal.dispose).not.toHaveBeenCalled()
		})

		it("never disposes an unregistered terminal whose completion state is unknown", () => {
			TerminalRegistry.setCompletedTerminalLimit(0)

			const unknownTerminal = {
				exitStatus: undefined,
				name: LEGACY_KILOCODE_TERMINAL_NAME,
				dispose: vi.fn(),
			} as any
			;(vscode.window as any).terminals.push(unknownTerminal)

			TerminalRegistry.setCompletedTerminalLimit(0)

			expect(unknownTerminal.dispose).not.toHaveBeenCalled()
		})

		it("does not dispose completed terminals when the limit is disabled", () => {
			TerminalRegistry.setCompletedTerminalLimitEnabled(false)
			TerminalRegistry.setCompletedTerminalLimit(1)

			const first = TerminalRegistry.createTerminal("/test/one", "vscode") as Terminal
			const second = TerminalRegistry.createTerminal("/test/two", "vscode") as Terminal
			const third = TerminalRegistry.createTerminal("/test/three", "vscode") as Terminal
			markCompleted(first)
			markCompleted(second)
			markCompleted(third)

			TerminalRegistry.setCompletedTerminalLimit(1)

			expect(first.terminal.dispose).not.toHaveBeenCalled()
			expect(second.terminal.dispose).not.toHaveBeenCalled()
			expect(third.terminal.dispose).not.toHaveBeenCalled()
		})

		it("keeps allocation integrated and ignores running terminals when pruning completed terminals", async () => {
			TerminalRegistry.setCompletedTerminalLimit(1)

			const staleCompleted = TerminalRegistry.createTerminal("/test/stale-before-allocation", "vscode") as Terminal
			const retainedCompleted = TerminalRegistry.createTerminal("/test/retained-before-allocation", "vscode") as Terminal
			const running = TerminalRegistry.createTerminal("/test/running-before-allocation", "vscode") as Terminal
			markCompleted(staleCompleted)
			markCompleted(retainedCompleted)
			running.busy = true
			running.running = true

			const selected = await TerminalRegistry.getOrCreateTerminal("/test/new-allocation", "task-new", "vscode")

			expect(selected.provider).toBe("vscode")
			expect(staleCompleted.terminal.dispose).not.toHaveBeenCalled()
			expect(retainedCompleted.terminal.dispose).not.toHaveBeenCalled()
			expect(running.terminal.dispose).not.toHaveBeenCalled()
			expect(mockCreateTerminal).toHaveBeenCalledTimes(4)

			;(selected as Terminal).busy = false
			;(selected as Terminal).running = false
			markCompleted(selected as Terminal)
			TerminalRegistry.enforceCompletedTerminalLimit()

			expect(staleCompleted.terminal.dispose).toHaveBeenCalledTimes(1)
			expect(retainedCompleted.terminal.dispose).toHaveBeenCalledTimes(1)
			expect(running.terminal.dispose).not.toHaveBeenCalled()
		})

		it("prunes oldest completed terminals beyond the limit while keeping the newest ones", () => {
			TerminalRegistry.setCompletedTerminalLimit(2)

			const first = TerminalRegistry.createTerminal("/test/one", "vscode") as Terminal
			const second = TerminalRegistry.createTerminal("/test/two", "vscode") as Terminal
			const third = TerminalRegistry.createTerminal("/test/three", "vscode") as Terminal
			markCompleted(first)
			markCompleted(second)
			markCompleted(third)

			TerminalRegistry.setCompletedTerminalLimit(2)

			expect(first.terminal.dispose).toHaveBeenCalledTimes(1)
			expect(second.terminal.dispose).not.toHaveBeenCalled()
			expect(third.terminal.dispose).not.toHaveBeenCalled()
		})
	})
	// kilocode_change end
})
