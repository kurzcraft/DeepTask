// npx vitest run integrations/terminal/__tests__/TerminalCmdFallback.spec.ts
// kilocode_change - new file

// Regression tests for Windows cmd.exe robustness:
// 1. A clearly-cmd default profile must never wait for the OSC 633;A handshake;
//    it routes straight to the child-process fallback executor.
// 2. On Windows, a 633;A wait timeout must degrade to child-process execution
//    instead of failing execute_command.
// 3. Non-Windows platforms keep the original no-shell-integration failure path.

vi.mock("execa", () => {
	const createSubprocess = () => ({
		pid: 4242,
		iterable: (_opts: unknown) =>
			(async function* () {
				yield "fallback output\n"
			})(),
		kill: vi.fn(),
	})

	const execa = vi.fn((commandOrOptions: unknown) => {
		if (typeof commandOrOptions === "string") {
			// Direct call form (for example taskkill) resolves immediately.
			return Promise.resolve({ exitCode: 0 })
		}

		// Template-tag form: execa(options)`command`
		return (_template: TemplateStringsArray, ..._args: unknown[]) => createSubprocess()
	})

	return { execa, ExecaError: class extends Error {} }
})

vi.mock("../../../utils/shell", () => ({
	getShell: vi.fn(() => "C:\\Windows\\System32\\cmd.exe"),
}))

import * as vscode from "vscode"
import { Terminal, isCmdExePath, isWindowsCmdDefaultProfile } from "../Terminal"
import { TerminalRegistry } from "../TerminalRegistry"
import { BaseTerminal } from "../BaseTerminal"
import type { RooTerminalCallbacks } from "../types"

interface CallbackEvents {
	lines: string[]
	completed: string[]
	started: Array<number | undefined>
	exits: Array<{ exitCode: number | undefined }>
	noShellIntegration: string[]
}

function makeCallbacks(): { callbacks: RooTerminalCallbacks; events: CallbackEvents } {
	const events: CallbackEvents = {
		lines: [],
		completed: [],
		started: [],
		exits: [],
		noShellIntegration: [],
	}

	const callbacks: RooTerminalCallbacks = {
		onLine: (line) => events.lines.push(line),
		onCompleted: (output) => events.completed.push(output ?? ""),
		onShellExecutionStarted: (pid) => events.started.push(pid),
		onShellExecutionComplete: (details) => events.exits.push(details),
		onNoShellIntegration: (msg) => events.noShellIntegration.push(msg),
	}

	return { callbacks, events }
}

function mockWindowsPlatform(value: NodeJS.Platform) {
	Object.defineProperty(process, "platform", { value })
}

describe("Terminal cmd fallback", () => {
	let originalPlatform: NodeJS.Platform
	let originalTimeout: number
	let configValues: Record<string, unknown>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let getConfigurationSpy: any

	beforeEach(() => {
		originalPlatform = process.platform
		originalTimeout = BaseTerminal.getShellIntegrationTimeout()
		configValues = {}

		getConfigurationSpy = vi.spyOn(vscode.workspace, "getConfiguration").mockImplementation(
			((section?: string) => ({
				get: (key: string, defaultValue?: unknown) => {
					if (section === "terminal.integrated") {
						return configValues[key] ?? defaultValue
					}

					return defaultValue
				},
			})) as never,
		)
	})

	afterEach(() => {
		mockWindowsPlatform(originalPlatform)
		BaseTerminal.setShellIntegrationTimeout(originalTimeout)
		getConfigurationSpy.mockRestore()
		TerminalRegistry["terminals"] = []
	})

	function makeTerminal(shellIntegration?: unknown) {
		const vsceTerminal = {
			name: "Deeptask",
			processId: Promise.resolve(1),
			creationOptions: {},
			exitStatus: undefined,
			state: { isInteractedWith: true },
			shellIntegration,
			dispose: vi.fn(),
			hide: vi.fn(),
			show: vi.fn(),
			sendText: vi.fn(),
		} as unknown as vscode.Terminal

		return new Terminal(1, vsceTerminal, "C:\\test")
	}

	describe("isCmdExePath", () => {
		it("matches cmd.exe variants in any casing and separator style", () => {
			expect(isCmdExePath("C:\\WINDOWS\\System32\\cmd.exe")).toBe(true)
			expect(isCmdExePath("C:\\windows\\system32\\CMD.EXE")).toBe(true)
			expect(isCmdExePath("cmd")).toBe(true)
			expect(isCmdExePath("C:/Windows/System32/cmd.exe")).toBe(true)
			expect(isCmdExePath("C:\\Windows\\system32\\command.com")).toBe(true)
		})

		it("rejects powershell, bash, and empty values", () => {
			expect(isCmdExePath("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe(false)
			expect(isCmdExePath("C:\\Program Files\\Git\\bin\\bash.exe")).toBe(false)
			expect(isCmdExePath("mycmdwrapper")).toBe(false)
			expect(isCmdExePath("")).toBe(false)
			expect(isCmdExePath(undefined)).toBe(false)
			expect(isCmdExePath(null)).toBe(false)
		})
	})

	describe("isWindowsCmdDefaultProfile", () => {
		it("is false on non-Windows platforms", () => {
			mockWindowsPlatform("linux")
			configValues["defaultProfile.windows"] = "Command Prompt"
			expect(isWindowsCmdDefaultProfile()).toBe(false)
		})

		it("detects the standard Command Prompt profile name", () => {
			mockWindowsPlatform("win32")
			configValues["defaultProfile.windows"] = "Command Prompt"
			expect(isWindowsCmdDefaultProfile()).toBe(true)

			configValues["defaultProfile.windows"] = "cmd"
			expect(isWindowsCmdDefaultProfile()).toBe(true)
		})

		it("detects an explicit cmd.exe profile path", () => {
			mockWindowsPlatform("win32")
			configValues["defaultProfile.windows"] = "My Shell"
			configValues["profiles.windows"] = {
				"My Shell": { path: "C:\\WINDOWS\\system32\\cmd.exe" },
			}
			expect(isWindowsCmdDefaultProfile()).toBe(true)
		})

		it("does not claim PowerShell or unknown profiles", () => {
			mockWindowsPlatform("win32")
			configValues["defaultProfile.windows"] = "Windows PowerShell"
			expect(isWindowsCmdDefaultProfile()).toBe(false)

			configValues["defaultProfile.windows"] = "Custom"
			configValues["profiles.windows"] = { Custom: { path: "C:\\shells\\custom.exe" } }
			expect(isWindowsCmdDefaultProfile()).toBe(false)

			configValues["defaultProfile.windows"] = undefined
			expect(isWindowsCmdDefaultProfile()).toBe(false)
		})
	})

	describe("runCommand routing", () => {
		it("routes a cmd default profile to the child-process executor without waiting for 633;A", async () => {
			mockWindowsPlatform("win32")
			configValues["defaultProfile.windows"] = "Command Prompt"

			const terminal = makeTerminal(undefined)
			TerminalRegistry["terminals"].push(terminal)

			const { callbacks, events } = makeCallbacks()
			const result = terminal.runCommand("echo ok", callbacks)
			await result

			expect(events.completed.join("")).toContain("fallback output")
			expect(events.exits).toEqual([{ exitCode: 0 }])
			expect(events.noShellIntegration).toEqual([])
			expect(events.started).toContain(4242)
			// The shell-integration path never ran, so nothing was typed into the terminal.
			expect(terminal.terminal.sendText).not.toHaveBeenCalled()
		})

		it("degrades to child-process execution on Windows when the 633;A wait times out", async () => {
			mockWindowsPlatform("win32")
			// A PowerShell-like profile keeps the shell-integration attempt alive.
			configValues["defaultProfile.windows"] = "Windows PowerShell"
			BaseTerminal.setShellIntegrationTimeout(60)

			const terminal = makeTerminal(undefined)
			TerminalRegistry["terminals"].push(terminal)

			const { callbacks, events } = makeCallbacks()
			const result = terminal.runCommand("echo degraded", callbacks)
			await result

			expect(events.completed.join("")).toContain("fallback output")
			expect(events.exits).toEqual([{ exitCode: 0 }])
			// The tool must not fail with the old hard no_shell_integration error.
			expect(events.noShellIntegration).toEqual([])
		})

		it("keeps the original no-shell-integration failure on non-Windows platforms", async () => {
			mockWindowsPlatform("linux")
			BaseTerminal.setShellIntegrationTimeout(60)

			const terminal = makeTerminal(undefined)
			TerminalRegistry["terminals"].push(terminal)

			const { callbacks, events } = makeCallbacks()
			const result = terminal.runCommand("echo unix", callbacks)
			await result

			expect(events.noShellIntegration.length).toBeGreaterThan(0)
			expect(events.noShellIntegration[0]).toContain("633;A")
		})
	})

	describe("echo terminal visibility (pty mirror)", () => {
		it("swaps the empty shell terminal to a pty that mirrors command, output, and exit code", async () => {
			mockWindowsPlatform("win32")
			configValues["defaultProfile.windows"] = "Command Prompt"

			const vsceTerminal = {
				name: "Deeptask",
				processId: Promise.resolve(1),
				creationOptions: { name: "Deeptask" },
				exitStatus: undefined,
				state: { isInteractedWith: true },
				shellIntegration: undefined,
				dispose: vi.fn(),
				hide: vi.fn(),
				show: vi.fn(),
				sendText: vi.fn(),
			} as unknown as vscode.Terminal
			const terminal = new Terminal(1, vsceTerminal, "C:\\test")
			TerminalRegistry["terminals"].push(terminal)

			const writes: string[] = []
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const creations: any[] = []
			const createSpy = vi.spyOn(vscode.window, "createTerminal").mockImplementation(
				((options: unknown) => {
					creations.push(options)
					// Subscribe to the pty's write event so the test observes what the
					// integrated terminal panel would render.
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const pty = (options as any)?.pty
					pty?.onDidWrite?.((chunk: string) => writes.push(chunk))

					return {
						name: "Deeptask",
						processId: Promise.resolve(2),
						creationOptions: options,
						exitStatus: undefined,
						state: { isInteractedWith: true },
						dispose: vi.fn(),
						hide: vi.fn(),
						show: vi.fn(),
						sendText: vi.fn(),
					} as unknown as vscode.Terminal
				}) as never,
			)

			try {
				const { callbacks, events } = makeCallbacks()
				await terminal.runCommand("echo ok", callbacks)

				const transcript = writes.join("")
				// The pty transcript shows the executed command line.
				expect(transcript).toContain("echo ok")
				// ...the live child-process output...
				expect(transcript).toContain("fallback output")
				// ...and the final exit status.
				expect(transcript).toContain("[exit 0]")
				// A pty-backed terminal was created exactly once.
				expect(creations.filter((options) => options?.pty).length).toBe(1)
				// The old empty shell terminal was disposed.
				expect(vsceTerminal.dispose).toHaveBeenCalled()
				// Model-facing capture is unaffected by the mirror.
				expect(events.completed.join("")).toContain("fallback output")
			} finally {
				createSpy.mockRestore()
			}
		})

		it("reuses the existing pty for a second fallback command", async () => {
			mockWindowsPlatform("win32")
			configValues["defaultProfile.windows"] = "Command Prompt"

			const vsceTerminal = {
				name: "Deeptask",
				processId: Promise.resolve(1),
				creationOptions: { name: "Deeptask" },
				exitStatus: undefined,
				state: { isInteractedWith: true },
				shellIntegration: undefined,
				dispose: vi.fn(),
				hide: vi.fn(),
				show: vi.fn(),
				sendText: vi.fn(),
			} as unknown as vscode.Terminal
			const terminal = new Terminal(1, vsceTerminal, "C:\\test")
			TerminalRegistry["terminals"].push(terminal)

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const creations: any[] = []
			const createSpy = vi.spyOn(vscode.window, "createTerminal").mockImplementation(
				((options: unknown) => {
					creations.push(options)
					return {
						name: "Deeptask",
						processId: Promise.resolve(2),
						creationOptions: options,
						exitStatus: undefined,
						state: { isInteractedWith: true },
						dispose: vi.fn(),
						hide: vi.fn(),
						show: vi.fn(),
						sendText: vi.fn(),
					} as unknown as vscode.Terminal
				}) as never,
			)

			try {
				const first = makeCallbacks()
				await terminal.runCommand("echo one", first.callbacks)
				const second = makeCallbacks()
				await terminal.runCommand("echo two", second.callbacks)

				expect(first.events.completed.join("")).toContain("fallback output")
				expect(second.events.completed.join("")).toContain("fallback output")
				// Only one pty terminal exists; the second command reused it.
				expect(creations.filter((options) => options?.pty).length).toBe(1)
			} finally {
				createSpy.mockRestore()
			}
		})

		it("never swaps a terminal the extension does not own", async () => {
			mockWindowsPlatform("win32")
			configValues["defaultProfile.windows"] = "Command Prompt"

			// creationOptions without our name simulates a user-owned terminal.
			const terminal = makeTerminal(undefined)
			TerminalRegistry["terminals"].push(terminal)

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const creations: any[] = []
			const createSpy = vi.spyOn(vscode.window, "createTerminal").mockImplementation(
				((options: unknown) => {
					creations.push(options)
					return {
						name: "Deeptask",
						processId: Promise.resolve(2),
						creationOptions: options,
						exitStatus: undefined,
						state: { isInteractedWith: true },
						dispose: vi.fn(),
						hide: vi.fn(),
						show: vi.fn(),
						sendText: vi.fn(),
					} as unknown as vscode.Terminal
				}) as never,
			)

			try {
				const { callbacks, events } = makeCallbacks()
				await terminal.runCommand("echo ok", callbacks)

				// No pty terminal was created, but the command still executed.
				expect(creations.length).toBe(0)
				expect(events.completed.join("")).toContain("fallback output")
				expect(events.exits).toEqual([{ exitCode: 0 }])
			} finally {
				createSpy.mockRestore()
			}
		})
	})
})
