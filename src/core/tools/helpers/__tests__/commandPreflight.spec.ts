// kilocode_change - new file
import { execFile } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { promisify } from "node:util"
import { NativeToolCallParser } from "../../../assistant-message/NativeToolCallParser"
import path from "node:path"
import {
	getCommandInputError,
	getCommandSyntaxError,
	MAX_EXECUTE_COMMAND_BYTES,
	COMMAND_SYNTAX_TIMEOUT_MS,
} from "../commandPreflight"

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>()
	return { ...actual, execFile: vi.fn(actual.execFile) }
})

const slash = String.fromCharCode(92)
const newline = String.fromCharCode(10)

describe("command input bounds", () => {
	it("rejects oversized UTF8 input without truncation", () => {
		expect(getCommandInputError("a".repeat(MAX_EXECUTE_COMMAND_BYTES))).toBeUndefined()
		expect(getCommandInputError("a".repeat(MAX_EXECUTE_COMMAND_BYTES + 1))).toContain("inline limit")
		expect(getCommandInputError("中".repeat(MAX_EXECUTE_COMMAND_BYTES / 2))).toContain("inline limit")
	})
	it("rejects NUL but preserves literal escapes", () => {
		expect(getCommandInputError("echo " + String.fromCharCode(0))).toContain("NUL")
		expect(getCommandInputError("echo " + slash + "n")).toBeUndefined()
		expect(getCommandInputError(undefined)).toBeUndefined()
	})
})

describe("bounded syntax checker contract", () => {
	afterEach(() => vi.mocked(execFile).mockReset())
	it.each(["/bin/zsh", "/bin/fish", "/bin/sh", "cmd.exe", "pwsh.exe"])("never parses %s as Bash", async (shell) => {
		vi.mocked(execFile).mockClear()
		expect(await getCommandSyntaxError("echo 'dialect-specific", shell)).toBeUndefined()
		expect(execFile).not.toHaveBeenCalled()
	})
	it("fails promptly when checker times out and closes input", async () => {
		const end = vi.fn()
		const on = vi.fn()
		vi.mocked(execFile).mockImplementation((...args: any[]) => {
			queueMicrotask(() => args[3](Object.assign(new Error("timed out"), { killed: true }), "", ""))
			return { stdin: { end, on } } as any
		})
		expect(await getCommandSyntaxError("sleep 10000", "/bin/bash")).toContain("bounded time budget")
		expect(end).toHaveBeenCalledWith("sleep 10000" + newline)
		expect(execFile).toHaveBeenCalledWith(
			"/bin/bash",
			["--noprofile", "--norc", "-p", "-O", "extglob", "-n"],
			expect.objectContaining({
				timeout: COMMAND_SYNTAX_TIMEOUT_MS,
				maxBuffer: 8192,
				killSignal: "SIGKILL",
				env: { PATH: process.env.PATH, LC_ALL: "C", BASH_ENV: "", ENV: "" },
			}),
			expect.any(Function),
		)
	})
	it("surfaces checker startup errors without launching work", async () => {
		vi.mocked(execFile).mockImplementation((...args: any[]) => {
			queueMicrotask(() => args[3](new Error("ENOENT"), "", ""))
			return { stdin: undefined } as any
		})
		expect(await getCommandSyntaxError("echo safe", "/bin/bash")).toContain("ENOENT")
	})
})

describe.skipIf(process.platform === "win32" || !existsSync("/bin/bash"))("real Bash nonexecuting preflight", () => {
	beforeEach(async () => {
		const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process")
		vi.mocked(execFile).mockImplementation(actual.execFile)
	})
	it.each([
		"echo 'unfinished",
		'python -c "print(1)',
		"node -e 'console.log(1)",
		"echo hi " + slash,
		"echo hi " + slash + newline,
		"echo $(printf hi",
		"cat <<EOF",
		"if true; then echo yes",
		"echo ok |",
		"python",
		"python3 -u",
		"/usr/bin/python3.12",
		"node",
	])("rejects incomplete or interactive input: %s", async (command) => {
		expect(await getCommandSyntaxError(command, "/bin/bash")).toContain("execute_command rejected:")
	})
	it.each([
		"bash EXTRA/bash/build.sh",
		"python3 EXTRA/bash/job.py",
		"sleep 10000",
		"python3 -c 'print(1)'",
		"node -e 'console.log(1)'",
		"python3 -m http.server",
		"printf '%s' 'quote: " + '"' + "'",
		"printf '%s' '" + slash + "'",
		"echo hi # '" + slash,
		"echo a" + newline + "echo b",
		"printf '%s' $(echo nested)",
		"echo $(printf '%s' 'hello world')",
		"printf '%s' $'can" + slash + "'t'",
		"echo hi | python3 -",
		"python3 < input.py",
		"python3 --version",
		"ls +(a|b)",
		"echo " + slash + slash,
	])("accepts complete syntax without running it: %s", async (command) => {
		expect(await getCommandSyntaxError(command, "/bin/bash")).toBeUndefined()
	})
	// kilocode_change: real file bytes and execution, not just a mocked write argument.
	it("preserves native script bytes and literal escapes through execution", async () => {
		const parent = path.resolve("../EXTRA/output")
		mkdirSync(parent, { recursive: true })
		const directory = mkdtempSync(path.join(parent, "native-script-fidelity-"))
		const file = path.join(directory, "script with spaces.sh")
		const payload = "中文 😀 literal " + slash + "n " + slash + "t " + slash + "d+ &lt; &quot; $HOME `not-executed`"
		const script = [
			"#!/bin/bash",
			"set -eu",
			"printf '%s" + slash + "n' '" + payload + "'",
			"printf '%s" + slash + "n' 'stderr preserved' >&2",
			"",
		].join(newline)
		try {
			const parsed = NativeToolCallParser.parseToolCall({
				id: "real-script-fidelity",
				name: "write_to_file",
				arguments: JSON.stringify({ path: file, content: script }),
			})
			if (!parsed || parsed.type !== "tool_use" || !parsed.nativeArgs) {
				throw new Error("Native script arguments were not parsed")
			}
			writeFileSync(file, parsed.nativeArgs.content, "utf8")
			expect(readFileSync(file)).toEqual(Buffer.from(script, "utf8"))
			const command = 'bash "' + file + '"'
			expect(await getCommandSyntaxError(command, "/bin/bash")).toBeUndefined()
			const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process")
			const result = await promisify(actual.execFile)("/bin/bash", ["--noprofile", "--norc", file], {
				timeout: 2_000,
				env: { PATH: process.env.PATH, BASH_ENV: "", ENV: "" },
			})
			expect(result.stdout).toBe(payload + newline)
			expect(result.stderr).toBe("stderr preserved" + newline)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})

	it("executes neither command substitution nor inherited startup code", async () => {
		const parent = path.resolve("../EXTRA/output")
		mkdirSync(parent, { recursive: true })
		const directory = mkdtempSync(path.join(parent, "preflight-check-"))
		const marker = path.join(directory, "must-not-exist")
		const startup = path.join(directory, "startup.sh")
		const oldEnv = process.env.BASH_ENV
		try {
			writeFileSync(startup, 'printf unexpected > "' + marker + '"')
			process.env.BASH_ENV = startup
			expect(await getCommandSyntaxError('echo $(touch "' + marker + '")', "/bin/bash")).toBeUndefined()
			expect(existsSync(marker)).toBe(false)
		} finally {
			if (oldEnv === undefined) delete process.env.BASH_ENV
			else process.env.BASH_ENV = oldEnv
			rmSync(directory, { recursive: true, force: true })
		}
	})
})
