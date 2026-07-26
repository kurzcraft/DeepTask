// npx vitest run integrations/terminal/__tests__/ExecaTerminalProcess.spec.ts

const { mockPid, mockKill } = vi.hoisted(() => ({
	mockPid: 12345,
	mockKill: vi.fn(),
}))

vitest.mock("execa", () => {
	const subprocess = {
		pid: mockPid,
		iterable: (_opts: any) =>
			(async function* () {
				yield "test output\n"
			})(),
		kill: mockKill,
	}
	const execa = vitest.fn((commandOrOptions: any) => {
		if (typeof commandOrOptions === "string") {
			return Promise.resolve({ exitCode: 0 })
		}
		return (_template: TemplateStringsArray, ..._args: any[]) => subprocess
	})
	return { execa, ExecaError: class extends Error {} }
})

// kilocode_change start
vitest.mock("ps-list", () => ({
	default: vitest.fn(async () => []),
}))

vitest.mock("../../../utils/shell", () => ({
	getShell: vitest.fn(() => "/bin/bash"),
}))
// kilocode_change end

import { execa } from "execa"
import psList from "ps-list"
import { getShell } from "../../../utils/shell"
import { ExecaTerminalProcess } from "../ExecaTerminalProcess"
import type { RooTerminal } from "../types"

describe("ExecaTerminalProcess", () => {
	let mockTerminal: RooTerminal
	let terminalProcess: ExecaTerminalProcess
	let originalEnv: NodeJS.ProcessEnv
	let originalPlatform: NodeJS.Platform

	beforeEach(() => {
		originalEnv = { ...process.env }
		originalPlatform = process.platform
		vitest.mocked(getShell).mockReturnValue("/bin/bash")
		mockTerminal = {
			provider: "execa",
			id: 1,
			busy: false,
			running: false,
			getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/cwd"),
			isClosed: vitest.fn().mockReturnValue(false),
			runCommand: vitest.fn(),
			setActiveStream: vitest.fn(),
			shellExecutionComplete: vitest.fn(),
			getProcessesWithOutput: vitest.fn().mockReturnValue([]),
			getUnretrievedOutput: vitest.fn().mockReturnValue(""),
			getLastCommand: vitest.fn().mockReturnValue(""),
			cleanCompletedProcessQueue: vitest.fn(),
		} as unknown as RooTerminal
		terminalProcess = new ExecaTerminalProcess(mockTerminal)
	})

	afterEach(() => {
		process.env = originalEnv
		Object.defineProperty(process, "platform", { value: originalPlatform })
		vitest.clearAllMocks()
	})

	describe("cross-platform shell contract", () => {
		it("uses the same allowlisted shell as the system prompt", async () => {
			vitest.mocked(getShell).mockReturnValue("/bin/bash")

			await terminalProcess.run("echo test")

			expect(execa).toHaveBeenCalledWith(
				expect.objectContaining({
					shell: "/bin/bash",
					cwd: "/test/cwd",
					all: true,
					stdin: "ignore",
					windowsHide: true,
				}),
			)
		})

		it("sets POSIX UTF-8 locale without dropping existing variables", async () => {
			process.env.EXISTING_VAR = "existing"

			await terminalProcess.run("echo test")

			const calledOptions = vitest.mocked(execa).mock.calls[0][0] as any
			expect(calledOptions.env).toEqual(
				expect.objectContaining({
					EXISTING_VAR: "existing",
					LANG: "en_US.UTF-8",
					LC_ALL: "en_US.UTF-8",
				}),
			)
		})

		it("uses PowerShell on Windows without injecting POSIX locale", async () => {
			Object.defineProperty(process, "platform", { value: "win32" })
			vitest.mocked(getShell).mockReturnValue(
				"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
			)
			process.env.LANG = "windows-locale"
			delete process.env.LC_ALL

			await terminalProcess.run("Write-Output test")

			const calledOptions = vitest.mocked(execa).mock.calls[0][0] as any
			expect(calledOptions.shell).toBe(
				"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
			)
			expect(calledOptions.windowsHide).toBe(true)
			expect(calledOptions.env.LANG).toBe("windows-locale")
			expect(calledOptions.env.LC_ALL).toBeUndefined()
		})

		it("overrides existing POSIX locale values", async () => {
			process.env.LANG = "C"
			process.env.LC_ALL = "POSIX"
			terminalProcess = new ExecaTerminalProcess(mockTerminal)
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			const calledOptions = execaMock.mock.calls[0][0] as any
			expect(calledOptions.env.LANG).toBe("en_US.UTF-8")
			expect(calledOptions.env.LC_ALL).toBe("en_US.UTF-8")
		})
	})

	describe("basic functionality", () => {
		it("should create instance with terminal reference", () => {
			expect(terminalProcess).toBeInstanceOf(ExecaTerminalProcess)
			expect(terminalProcess.terminal).toBe(mockTerminal)
		})

		it("emits shell_execution_started with the real root PID", async () => {
			const spy = vitest.fn()
			terminalProcess.on("shell_execution_started", spy)

			await terminalProcess.run("echo test")

			expect(spy).toHaveBeenCalledWith(mockPid)
		})

		it("should emit shell_execution_complete with exitCode 0", async () => {
			const spy = vitest.fn()
			terminalProcess.on("shell_execution_complete", spy)
			await terminalProcess.run("echo test")
			expect(spy).toHaveBeenCalledWith({ exitCode: 0 })
		})

		it("should emit completed event with full output", async () => {
			const spy = vitest.fn()
			terminalProcess.on("completed", spy)
			await terminalProcess.run("echo test")
			expect(spy).toHaveBeenCalledWith("test output\n")
		})

		it("should set and clear active stream", async () => {
			await terminalProcess.run("echo test")
			expect(mockTerminal.setActiveStream).toHaveBeenCalledWith(expect.any(Object), mockPid)
			expect(mockTerminal.setActiveStream).toHaveBeenLastCalledWith(undefined)
		})

		it("releases a busy terminal when process startup throws", async () => {
			mockTerminal.busy = true
			vitest.mocked(execa).mockImplementationOnce(() => {
				throw new Error("spawn failed")
			})
			const completeSpy = vitest.fn()
			const completedSpy = vitest.fn()
			terminalProcess.on("shell_execution_complete", completeSpy)
			terminalProcess.on("completed", completedSpy)

			await terminalProcess.run("echo test")

			expect(completeSpy).toHaveBeenCalledWith({ exitCode: 1 })
			expect(completedSpy).toHaveBeenCalledWith("")
			expect(mockTerminal.busy).toBe(false)
			expect(mockTerminal.setActiveStream).toHaveBeenLastCalledWith(undefined)
		})
	})

	describe("Windows cancellation", () => {
		it("uses bounded taskkill tree termination without ps-list", async () => {
			Object.defineProperty(process, "platform", { value: "win32" })
			;(terminalProcess as any).pid = mockPid
			;(terminalProcess as any).subprocess = { kill: mockKill }

			terminalProcess.abort()
			await vi.waitFor(() => {
				expect(execa).toHaveBeenCalledWith("taskkill", ["/PID", String(mockPid), "/T", "/F"], {
					windowsHide: true,
					timeout: 5_000,
					reject: false,
				})
			})

			expect(psList).not.toHaveBeenCalled()
			expect(mockKill).not.toHaveBeenCalled()
		})
	})

	describe("trimRetrievedOutput", () => {
		it("clears buffer when all output has been retrieved", () => {
			// Set up a scenario where all output has been retrieved
			terminalProcess["fullOutput"] = "test output data"
			terminalProcess["lastRetrievedIndex"] = 16 // Same as fullOutput.length

			// Access the protected method through type casting
			;(terminalProcess as any).trimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})

		it("does not clear buffer when there is unretrieved output", () => {
			// Set up a scenario where not all output has been retrieved
			terminalProcess["fullOutput"] = "test output data"
			terminalProcess["lastRetrievedIndex"] = 5 // Less than fullOutput.length
			;(terminalProcess as any).trimRetrievedOutput()

			// Buffer should NOT be cleared - there's still unretrieved content
			expect(terminalProcess["fullOutput"]).toBe("test output data")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(5)
		})

		it("does nothing when buffer is already empty", () => {
			terminalProcess["fullOutput"] = ""
			terminalProcess["lastRetrievedIndex"] = 0
			;(terminalProcess as any).trimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})

		it("clears buffer when lastRetrievedIndex exceeds fullOutput length", () => {
			// Edge case: index is greater than current length (could happen if output was modified)
			terminalProcess["fullOutput"] = "short"
			terminalProcess["lastRetrievedIndex"] = 100
			;(terminalProcess as any).trimRetrievedOutput()

			expect(terminalProcess["fullOutput"]).toBe("")
			expect(terminalProcess["lastRetrievedIndex"]).toBe(0)
		})
	})
})
