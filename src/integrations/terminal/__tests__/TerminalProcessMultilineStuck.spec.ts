// npx vitest run integrations/terminal/__tests__/TerminalProcessMultilineStuck.spec.ts
// Regression for 9.1.4: multi-line / quoted inline commands can complete while
// VS Code never emits the OSC 633;C start marker, never fires the shell end
// event, and never closes execution.read(). The process must still settle.

import * as vscode from "vscode"

import { TerminalProcess } from "../TerminalProcess"
import { Terminal } from "../Terminal"
import { TerminalRegistry } from "../TerminalRegistry"

vi.mock("vscode", () => {
	const eventHandlers: Record<string, unknown> = {}

	return {
		workspace: {
			getConfiguration: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) }),
		},
		window: {
			createTerminal: vi.fn(),
			onDidStartTerminalShellExecution: vi.fn().mockImplementation((handler) => {
				eventHandlers.startTerminalShellExecution = handler
				return { dispose: vi.fn() }
			}),
			onDidEndTerminalShellExecution: vi.fn().mockImplementation((handler) => {
				eventHandlers.endTerminalShellExecution = handler
				return { dispose: vi.fn() }
			}),
			onDidCloseTerminal: vi.fn().mockImplementation((handler) => {
				eventHandlers.closeTerminal = handler
				return { dispose: vi.fn() }
			}),
		},
		ThemeIcon: class ThemeIcon {
			id: string
			constructor(id: string) {
				this.id = id
			}
		},
		Uri: { file: (p: string) => ({ fsPath: p }) },
		__eventHandlers: eventHandlers,
	}
})

vi.mock("execa", () => ({ execa: vi.fn() }))

type Chunk = string

function createNeverClosingStream(chunks: Chunk[]): AsyncIterable<string> {
	return {
		[Symbol.asyncIterator]() {
			let i = 0
			return {
				async next() {
					if (i < chunks.length) {
						return { done: false as const, value: chunks[i++] }
					}
					// Never resolves: models a VS Code read() stream that stays
					// open forever after the command finished.
					return await new Promise<never>(() => {})
				},
				async return() {
					return { done: true as const, value: undefined }
				},
			}
		},
	}
}

function setupTerminal(stream: AsyncIterable<string>) {
	const shellExecution = {
		commandLine: { value: "python3 -c" },
		read: vi.fn().mockReturnValue(stream),
	}

	const mockTerminal = {
		shellIntegration: {
			executeCommand: vi.fn().mockReturnValue(shellExecution),
			cwd: vscode.Uri.file("/test/path"),
		},
		name: "Deeptask",
		processId: Promise.resolve(123),
		creationOptions: {},
		exitStatus: undefined,
		state: { isInteractedWith: true, shell: undefined },
		dispose: vi.fn(),
		hide: vi.fn(),
		show: vi.fn(),
		sendText: vi.fn(),
	}

	const terminal = new Terminal(1, mockTerminal, "/test/path")
	terminal.running = true
	TerminalRegistry["terminals"] = [terminal]

	const process = new TerminalProcess(terminal)
	terminal.process = process

	return { terminal, process, mockTerminal, shellExecution }
}

describe("TerminalProcess multi-line stuck-command regression (9.1.4)", () => {
	beforeAll(() => {
		TerminalRegistry.initialize()
	})

	beforeEach(() => {
		TerminalRegistry["terminals"] = []
		vi.clearAllMocks()
	})

	it("settles via fresh-prompt lookback when 633;C never arrives and no end event fires", async () => {
		// Simulated VSCodium behavior for `python3 -c "\n...\n"`: the prompt
		// before the command, the echoed command lines, the command output, and
		// then a FRESH prompt marker — but no 633;C and no 633;D, and the stream
		// stays open forever.
		const chunks: Chunk[] = [
			"\x1b]633;A\x07\x1b]633;B\x07",
			"python3 -c \"\n",
			"import json\n",
			"d = json.load(open('tools.json'))\n",
			"print(json.dumps(d)[:120])\n",
			"\"\n",
			'{"tools": {"readFile": {"linesRange"',
			": \" (lines {{start}}-{{end}})\"}}\n",
			"\x1b]633;A\x07\x1b]633;B\x07",
		]

		const { process } = setupTerminal(createNeverClosingStream(chunks))

		let completedOutput: string | undefined
		const completed = new Promise<string | undefined>((resolve) => {
			process.once("completed", (output) => {
				completedOutput = output
				resolve(output)
			})
		})

		process.run("python3 -c ...")

		const output = await Promise.race([
			completed,
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4_000)),
		])

		expect(output).toBeDefined()
		expect(output).toContain('{"tools"')
		expect(output).toContain("fresh shell prompt")
	}, 8_000)

	it("settles via D marker found in the pre-start buffer when 633;C never arrives", async () => {
		// Command ran and finished (D marker present) but VS Code swallowed the
		// C marker; the stream stays open and no end event fires.
		const chunks: Chunk[] = [
			"\x1b]633;A\x07\x1b]633;B\x07",
			"echo splitting-marker\n",
			"splitting-marker\n",
			"\x1b]633;D\x07",
		]

		const { process } = setupTerminal(createNeverClosingStream(chunks))

		const completed = new Promise<string | undefined>((resolve) => {
			process.once("completed", (output) => resolve(output))
		})

		process.run("echo splitting-marker")

		const output = await Promise.race([
			completed,
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4_000)),
		])

		expect(output).toBeDefined()
		expect(output).toContain("splitting-marker")
	}, 8_000)

	it("matches a C marker split across chunk boundaries (ST terminator)", async () => {
		// The C marker itself is split across two chunks and terminated with ST
		// (\x1b\\) instead of BEL. The accumulated-buffer match must still find
		// it and preserve the command output that follows.
		const chunks: Chunk[] = [
			"\x1b]633;A\x07\x1b]633;B\x07",
			"\x1b]63",
			"3;C\x1b\\",
			"hello-from-split-marker\n",
			"\x1b]633;D\x07",
		]

		const { process } = setupTerminal(createNeverClosingStream(chunks))

		const completed = new Promise<string | undefined>((resolve) => {
			process.once("completed", (output) => resolve(output))
		})

		process.run("echo hello-from-split-marker")

		const output = await Promise.race([
			completed,
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4_000)),
		])

		expect(output).toBeDefined()
		// The D marker cleanly terminates the output; the trailing annotation is
		// the intended "end event never fired" note, not part of the output.
		expect(output).toContain("hello-from-split-marker\n")
	}, 8_000)

	it("does not settle on a fresh prompt while the command is still running", async () => {
		// Only the pre-command prompt exists; no fresh prompt after any output.
		// The never-closing stream models a long-running silent command. The
		// process must NOT complete within the observation window.
		const chunks: Chunk[] = ["\x1b]633;A\x07\x1b]633;B\x07python3 long_task.py\n"]

		const { process } = setupTerminal(createNeverClosingStream(chunks))

		let completedFired = false
		process.once("completed", () => {
			completedFired = true
		})

		process.run("python3 long_task.py")

		await new Promise((resolve) => setTimeout(resolve, 1_200))

		expect(completedFired).toBe(false)
	}, 8_000)

	// kilocode_change start: 9.1.4 stage-4b swallowed-output recovery
	it("recovers output from the terminal screen when a marker-less stream carried only the bare command echo", async () => {
		// No OSC markers at all: the stream only carried the echoed command line
		// while the real output went straight to the terminal buffer. After the
		// shell completion deadline the process must recover via the screen
		// transcript instead of returning the bare echo as the "output".
		const chunks: Chunk[] = ["grep -rn 'match' src\n"]

		const { process } = setupTerminal(createNeverClosingStream(chunks))

		const screenSpy = vi
			.spyOn(Terminal, "getTerminalContents")
			.mockResolvedValue("user@host:~/proj$ grep -rn 'match' src\nsrc/foo.ts:42:const match = 7")

		const completed = new Promise<string | undefined>((resolve) => {
			process.once("completed", (output) => resolve(output))
		})

		void process.run("grep -rn 'match' src")
		process.emit("shell_execution_complete", { exitCode: 0 })

		const output = await Promise.race([
			completed,
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4_000)),
		])

		expect(output).toBeDefined()
		expect(output).toContain("src/foo.ts:42:const match = 7")
		expect(output).toContain("terminal screen content used to recover the command output")
		expect(output).not.toContain("raw terminal output preserved")
		screenSpy.mockRestore()
	}, 8_000)

	it("recovers output from the terminal screen when C/D markers framed an empty stream", async () => {
		// Markers framed normally but no data ever arrived between C and D
		// (competing consumer / stream race). The empty result must be replaced
		// with the visible terminal transcript.
		const chunks: Chunk[] = [
			"\x1b]633;A\x07\x1b]633;B\x07",
			"\x1b]633;C\x07",
			"\x1b]633;D\x07",
		]

		const { process } = setupTerminal(createNeverClosingStream(chunks))

		const screenSpy = vi
			.spyOn(Terminal, "getTerminalContents")
			.mockResolvedValue("user@host:~/proj$ echo hi\nhi")

		const completed = new Promise<string | undefined>((resolve) => {
			process.once("completed", (output) => resolve(output))
		})

		void process.run("echo hi")

		const output = await Promise.race([
			completed,
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4_000)),
		])

		expect(output).toBeDefined()
		expect(output).toContain("hi")
		expect(output).toContain("terminal screen content used to recover the command output")
		screenSpy.mockRestore()
	}, 8_000)
	// kilocode_change end
})
