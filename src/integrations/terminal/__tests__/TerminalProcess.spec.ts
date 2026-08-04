// npx vitest run src/integrations/terminal/__tests__/TerminalProcess.spec.ts

import * as vscode from "vscode"

import { mergePromise } from "../mergePromise"
import { TerminalProcess } from "../TerminalProcess"
import { Terminal } from "../Terminal"
import { TerminalRegistry } from "../TerminalRegistry"

class TestTerminalProcess extends TerminalProcess {
	public callTrimRetrievedOutput(): void {
		this.trimRetrievedOutput()
	}
}

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

describe("TerminalProcess", () => {
	let terminalProcess: TestTerminalProcess
	let mockTerminal: any
	type TestVscodeTerminal = vscode.Terminal & {
		shellIntegration: {
			executeCommand: any
		}
	}
	let mockTerminalInfo: Terminal
	let mockExecution: any
	let mockStream: AsyncIterableIterator<string>

	beforeEach(() => {
		// Create properly typed mock terminal
		mockTerminal = {
			shellIntegration: {
				executeCommand: vi.fn(),
			},
			name: "Kilo Code",
			processId: Promise.resolve(123),
			creationOptions: {},
			exitStatus: undefined,
			state: { isInteractedWith: true },
			dispose: vi.fn(),
			hide: vi.fn(),
			show: vi.fn(),
			sendText: vi.fn(),
		} as unknown as TestVscodeTerminal

		mockTerminalInfo = new Terminal(1, mockTerminal, "./")

		// Create a process for testing
		terminalProcess = new TestTerminalProcess(mockTerminalInfo)

		TerminalRegistry["terminals"].push(mockTerminalInfo)

		// Reset event listeners
		terminalProcess.removeAllListeners()
	})

	describe("run", () => {
		it("handles shell integration commands correctly", async () => {
			let lines: string[] = []

			terminalProcess.on("completed", (output) => {
				if (output) {
					lines = output.split("\n")
				}
			})

			// Mock stream data with shell integration sequences.
			mockStream = (async function* () {
				yield "\x1b]633;C\x07" // The first chunk contains the command start sequence with bell character.
				yield "Initial output\n"
				yield "More output\n"
				yield "Final output"
				terminalProcess.emit("shell_execution_complete", { exitCode: 0 })
				yield "\x1b]633;D\x07" // The last chunk contains the command end sequence with bell character.
			})()

			mockExecution = {
				read: vi.fn().mockReturnValue(mockStream),
			}

			mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

			const runPromise = terminalProcess.run("test command")
			terminalProcess.emit("stream_available", mockStream)
			await runPromise

			expect(lines).toEqual(["Initial output", "More output", "Final output"])
			expect(terminalProcess.isHot).toBe(false)
		})

		it("handles terminals without shell integration", async () => {
			// Temporarily suppress the expected console.warn for this test
			const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

			// Create a terminal without shell integration
			const noShellTerminal = {
				sendText: vi.fn(),
				shellIntegration: undefined,
				name: "No Shell Terminal",
				processId: Promise.resolve(456),
				creationOptions: {},
				exitStatus: undefined,
				state: { isInteractedWith: true },
				dispose: vi.fn(),
				hide: vi.fn(),
				show: vi.fn(),
			} as unknown as vscode.Terminal

			// Create new terminal info with the no-shell terminal
			const noShellTerminalInfo = new Terminal(2, noShellTerminal, "./")

			// Create new process with the no-shell terminal
			const noShellProcess = new TerminalProcess(noShellTerminalInfo)

			// Set up event listeners to verify events are emitted
			const eventPromises = Promise.all([
				new Promise<void>((resolve) =>
					noShellProcess.once("no_shell_integration", (_message: string) => resolve()),
				),
				new Promise<void>((resolve) => noShellProcess.once("completed", (_output?: string) => resolve())),
				new Promise<void>((resolve) => noShellProcess.once("continue", resolve)),
			])

			// Run command and wait for all events
			await noShellProcess.run("test command")
			await eventPromises

			// Verify sendText was called with the command
			expect(noShellTerminal.sendText).toHaveBeenCalledWith("test command", true)

			// Restore the original console.warn
			consoleWarnSpy.mockRestore()
		})

		it("sets hot state for compiling commands", async () => {
			let lines: string[] = []

			terminalProcess.on("completed", (output) => {
				if (output) {
					lines = output.split("\n")
				}
			})

			const completePromise = new Promise<void>((resolve) => {
				terminalProcess.on("shell_execution_complete", () => resolve())
			})

			mockStream = (async function* () {
				yield "\x1b]633;C\x07" // The first chunk contains the command start sequence with bell character.
				yield "compiling...\n"
				yield "still compiling...\n"
				yield "done"
				terminalProcess.emit("shell_execution_complete", { exitCode: 0 })
				yield "\x1b]633;D\x07" // The last chunk contains the command end sequence with bell character.
			})()

			mockTerminal.shellIntegration.executeCommand.mockReturnValue({
				read: vi.fn().mockReturnValue(mockStream),
			})

			const runPromise = terminalProcess.run("npm run build")
			terminalProcess.emit("stream_available", mockStream)

			expect(terminalProcess.isHot).toBe(true)
			await runPromise

			expect(lines).toEqual(["compiling...", "still compiling...", "done"])

			await completePromise
			expect(terminalProcess.isHot).toBe(false)
		})

		it("completes when the stream closes without a shell execution end event", async () => {
			let completedOutput = ""

			terminalProcess.on("completed", (output) => {
				completedOutput = output || ""
			})

			mockStream = (async function* () {
				yield "\x1b]633;C\x07"
				yield "checking packaging result\n"
				yield "exists True size 123\n"
				yield "\x1b]633;D\x07"
			})()

			mockTerminal.shellIntegration.executeCommand.mockReturnValue({
				read: vi.fn().mockReturnValue(mockStream),
			})

			const runPromise = terminalProcess.run(
				"echo 'checking packaging result' && python3 - <<'PY'\nprint('exists True')\nPY",
			)
			terminalProcess.emit("stream_available", mockStream)

			await expect(runPromise).resolves.toBeUndefined()
			expect(completedOutput).toContain("checking packaging result")
			expect(completedOutput).toContain("treated stream close as command completion")
			expect(terminalProcess.isHot).toBe(false)
		})

		it("retains output when shell execution completes before stream_available is emitted", async () => {
			let completedOutput = ""
			const continueSpy = vi.fn()
			const outputStream = (async function* () {
				yield "\x1b]633;C\x07"
				yield "output survived early completion\n"
				yield "\x1b]633;D\x07"
			})()

			terminalProcess.on("completed", (output) => {
				completedOutput = output || ""
			})
			terminalProcess.on("continue", continueSpy)

			mockTerminal.shellIntegration.executeCommand.mockReturnValue({
				read: vi.fn().mockReturnValue(outputStream),
			})

			const runPromise = terminalProcess.run(
				"sqlite3 /tmp/state.vscdb \"select value from ItemTable where key='deeptask.deeptask';\" | node - <<'NODE'\nconsole.log('done')\nNODE",
			)
			terminalProcess.emit("shell_execution_complete", { exitCode: 0 })

			await expect(runPromise).resolves.toBeUndefined()
			expect(completedOutput).toContain("output survived early completion")
			expect(completedOutput).not.toContain("output is unknown")
			expect(continueSpy).toHaveBeenCalled()
			expect(terminalProcess.isHot).toBe(false)
		})

		it("waits briefly for a stream that arrives after shell completion", async () => {
			let completedOutput = ""
			const continueSpy = vi.fn()
			const outputStream = (async function* () {
				yield "\x1b]633;C\x07"
				yield "late output from PIPESTATUS and exit tail\n"
				yield "\x1b]633;D\x07"
			})()

			terminalProcess.on("completed", (output) => {
				completedOutput = output || ""
			})
			terminalProcess.on("continue", continueSpy)

			mockTerminal.shellIntegration.executeCommand.mockReturnValue({
				read: vi.fn().mockReturnValue(outputStream),
			})

			const runPromise = terminalProcess.run(
				"python3 task.py 2>&1 | tee output.log; status=${PIPESTATUS[0]}; printf '\\nexit_status=%s\\n' \"$status\"; exit \"$status\"",
			)
			terminalProcess.emit("shell_execution_complete", { exitCode: 0 })

			await expect(runPromise).resolves.toBeUndefined()
			expect(completedOutput).toContain("late output from PIPESTATUS and exit tail")
			expect(completedOutput).not.toContain("output is unknown")
			expect(continueSpy).toHaveBeenCalledTimes(1)
			expect(terminalProcess.isHot).toBe(false)
		})

		it("completes when shell execution ends but the output stream never closes", async () => {
			let completedOutput = ""
			const continueSpy = vi.fn()
			const neverClosingStream: AsyncIterableIterator<string> = {
				next: vi
					.fn()
					.mockImplementationOnce(async () => ({ done: false, value: "]633;C" }))
					.mockImplementation(() => new Promise<IteratorResult<string>>(() => {})),
				return: vi.fn().mockResolvedValue({ done: true, value: undefined }),
				throw: vi.fn(),
				[Symbol.asyncIterator]() {
					return this
				},
			}

			terminalProcess.on("completed", (output) => {
				completedOutput = output || ""
			})
			terminalProcess.on("continue", continueSpy)
			mockTerminal.shellIntegration.executeCommand.mockReturnValue({
				read: vi.fn().mockReturnValue(neverClosingStream),
			})

			const runPromise = terminalProcess.run("python3 task.py 2>&1 | tee output.log; exit ${PIPESTATUS[0]}")
			terminalProcess.emit("stream_available", neverClosingStream)
			terminalProcess.emit("shell_execution_complete", { exitCode: 0 })

			await expect(runPromise).resolves.toBeUndefined()
			expect(completedOutput).not.toContain("output is unknown")
			expect(continueSpy).toHaveBeenCalledTimes(1)
		}, 3_000)

		it("reports unknown output when shell execution exposes no readable stream", async () => {
			let completedOutput = ""

			terminalProcess.on("completed", (output) => {
				completedOutput = output || ""
			})

			mockTerminal.shellIntegration.executeCommand.mockReturnValue({
				read: vi.fn(),
			})

			const runPromise = terminalProcess.run("printf done")
			terminalProcess.emit("shell_execution_complete", { exitCode: 0 })

			await expect(runPromise).resolves.toBeUndefined()
			expect(completedOutput).toContain("stream was not available before shell execution completed")
		})

		it("uses the executeCommand stream when the start event stream is not forwarded", async () => {
			let completedOutput = ""
			const continueSpy = vi.fn()

			terminalProcess.on("completed", (output) => {
				completedOutput = output || ""
			})
			terminalProcess.on("continue", continueSpy)

			mockStream = (async function* () {
				yield "\x1b]633;C\x07"
				yield "任务记录/vscode-deeptask-half-task-and-switches-20260706-043100.txt\n"
				yield "\x1b]633;D\x07"
				terminalProcess.emit("shell_execution_complete", { exitCode: 0 })
			})()

			mockTerminal.shellIntegration.executeCommand.mockReturnValue({
				read: vi.fn().mockReturnValue(mockStream),
			})

			const runPromise = terminalProcess.run(
				"out=任务记录/vscode-deeptask-half-task-and-switches-20260706-043100.txt; { echo '# Half task and switches'; python3 - <<'PY'\nprint('ok')\nPY\n} > \"$out\"; printf '%s\\n' \"$out\"",
			)

			await expect(runPromise).resolves.toBeUndefined()
			expect(completedOutput).toContain("任务记录/vscode-deeptask-half-task-and-switches-20260706-043100.txt")
			expect(continueSpy).toHaveBeenCalled()
			expect(terminalProcess.isHot).toBe(false)
		})
	})

	describe("continue", () => {
		it("stops listening and emits continue event", () => {
			const continueSpy = vi.fn()
			terminalProcess.on("continue", continueSpy)

			terminalProcess.continue()

			expect(continueSpy).toHaveBeenCalled()
			expect(terminalProcess["isListening"]).toBe(false)
		})
	})

	describe("getUnretrievedOutput", () => {
		it("returns and clears unretrieved output", () => {
			terminalProcess["fullOutput"] = `\x1b]633;C\x07previous\nnew output\x1b]633;D\x07`
			terminalProcess["lastRetrievedIndex"] = 17 // After "previous\n"

			const unretrieved = terminalProcess.getUnretrievedOutput()
			expect(unretrieved).toBe("new output")

			expect(terminalProcess["lastRetrievedIndex"]).toBe(terminalProcess["fullOutput"].length - "previous".length)
		})
	})

	describe("interpretExitCode", () => {
		it("handles undefined exit code", () => {
			const result = TerminalProcess.interpretExitCode(undefined)
			expect(result).toEqual({ exitCode: undefined })
		})

		it("handles normal exit codes (0-128)", () => {
			const result = TerminalProcess.interpretExitCode(0)
			expect(result).toEqual({ exitCode: 0 })

			const result2 = TerminalProcess.interpretExitCode(1)
			expect(result2).toEqual({ exitCode: 1 })

			const result3 = TerminalProcess.interpretExitCode(128)
			expect(result3).toEqual({ exitCode: 128 })
		})

		it("interprets signal exit codes (>128)", () => {
			// SIGTERM (15) -> 128 + 15 = 143
			const result = TerminalProcess.interpretExitCode(143)
			expect(result).toEqual({
				exitCode: 143,
				signal: 15,
				signalName: "SIGTERM",
				coreDumpPossible: false,
			})

			// SIGSEGV (11) -> 128 + 11 = 139
			const result2 = TerminalProcess.interpretExitCode(139)
			expect(result2).toEqual({
				exitCode: 139,
				signal: 11,
				signalName: "SIGSEGV",
				coreDumpPossible: true,
			})
		})

		it("handles unknown signals", () => {
			const result = TerminalProcess.interpretExitCode(255)
			expect(result).toEqual({
				exitCode: 255,
				signal: 127,
				signalName: "Unknown Signal (127)",
				coreDumpPossible: false,
			})
		})
	})

	describe("trimRetrievedOutput", () => {
		it("clears buffer when all output has been retrieved", () => {
			// Set up a scenario where all output has been retrieved
			terminalProcess["fullOutput"] = "test output data"
			terminalProcess["lastRetrievedIndex"] = 16 // Same as fullOutput.length

			terminalProcess.callTrimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})

		it("does not clear buffer when there is unretrieved output", () => {
			// Set up a scenario where not all output has been retrieved
			terminalProcess["fullOutput"] = "test output data"
			terminalProcess["lastRetrievedIndex"] = 5 // Less than fullOutput.length
			terminalProcess.callTrimRetrievedOutput()

			// Buffer should NOT be cleared - there's still unretrieved content
			expect(terminalProcess["fullOutput"]).toBe("test output data")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(5)
		})

		it("does nothing when buffer is already empty", () => {
			terminalProcess["fullOutput"] = ""
			terminalProcess["lastRetrievedIndex"] = 0
			terminalProcess.callTrimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})

		it("clears buffer when lastRetrievedIndex exceeds fullOutput length", () => {
			// Edge case: index is greater than current length (could happen if output was modified)
			terminalProcess["fullOutput"] = "short"
			terminalProcess["lastRetrievedIndex"] = 100
			terminalProcess.callTrimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})
	})

	describe("mergePromise", () => {
		it("merges promise methods with terminal process", async () => {
			const process = new TerminalProcess(mockTerminalInfo)
			const promise = Promise.resolve()

			const merged = mergePromise(process, promise)

			expect(merged).toHaveProperty("then")
			expect(merged).toHaveProperty("catch")
			expect(merged).toHaveProperty("finally")
			expect(merged instanceof TerminalProcess).toBe(true)

			await expect(merged).resolves.toBeUndefined()
		})
	})
})
