// kilocode_change - new file
import { execFile } from "node:child_process"

export const MAX_EXECUTE_COMMAND_BYTES = 16_384
export const COMMAND_SYNTAX_TIMEOUT_MS = 2_000

const recovery =
	" Write the work to a script under EXTRA/bash/ and retry with a short script invocation. No command was executed."

/** Cheap, shell-independent checks; partial commands must only use these monotonic checks. */
export function getCommandInputError(command: string | undefined): string | undefined {
	if (!command) return undefined
	if (command.includes(String.fromCharCode(0))) {
		return "execute_command rejected: command contains a NUL character." + recovery
	}
	if (Buffer.byteLength(command, "utf8") > MAX_EXECUTE_COMMAND_BYTES) {
		return (
			`execute_command rejected: command exceeds the ${MAX_EXECUTE_COMMAND_BYTES}-byte inline limit.` + recovery
		)
	}
	return undefined
}

/** Only detect a trailing escape outside quotes/comments; Bash itself validates nested syntax. */
function hasTrailingEscape(command: string): boolean {
	let quote = ""
	let comment = false
	let ansiQuote = false
	const slash = String.fromCharCode(92)
	const newline = String.fromCharCode(10)
	for (let i = 0; i < command.length; i++) {
		const char = command[i]
		if (comment) {
			if (char === newline) comment = false
			continue
		}
		if (quote === "'") {
			if (ansiQuote && char === slash) i++
			else if (char === quote) quote = ""
			continue
		}
		if (char === slash) {
			if (i === command.length - 1 || (i === command.length - 2 && command[i + 1] === newline)) return true
			i++
			continue
		}
		if (quote) {
			if (char === quote) quote = ""
			continue
		}
		if (char === "#" && (i === 0 || /[\s;|&()]/.test(command[i - 1]))) {
			comment = true
		} else if (char === "'" || char === '"' || char === "`") {
			quote = char
			ansiQuote = char === "'" && command[i - 1] === "$"
		}
	}
	return false
}

/**
 * Bash-only syntax validation: no command evaluation, startup files, inherited functions, or terminal.
 * Unknown shell dialects keep their existing execution path rather than being parsed as Bash.
 * The timeout kills only this short-lived syntax checker, never the user's actual command.
 */
export async function getCommandSyntaxError(command: string, shell: string): Promise<string | undefined> {
	const shellName = shell.replaceAll(String.fromCharCode(92), "/").split("/").pop()?.toLowerCase()
	if (shellName !== "bash" && shellName !== "bash.exe") return undefined
	if (hasTrailingEscape(command)) {
		return "execute_command rejected: trailing escape would wait for another input line." + recovery
	}
	// Exact bare interpreters are interactive, unlike scripts, -m, -c/-e, pipes, or redirections.
	if (
		/^(?:[^\s'";|&<>]+[\/])?(?:python(?:[23](?:\.\d+)?)?|node|python3?\.exe|node\.exe)(?:\s+-[ui]+)?\s*$/.test(
			command.trim(),
		)
	) {
		return "execute_command rejected: a bare interpreter waits for interactive input." + recovery
	}
	return new Promise((resolve) => {
		const checker = execFile(
			shell,
			["--noprofile", "--norc", "-p", "-O", "extglob", "-n"],
			{
				timeout: COMMAND_SYNTAX_TIMEOUT_MS,
				maxBuffer: 8192,
				killSignal: "SIGKILL",
				windowsHide: true,
				env: { PATH: process.env.PATH, LC_ALL: "C", BASH_ENV: "", ENV: "" },
			},
			(error, _stdout, stderr) => {
				if (error) {
					const reason = error.killed
						? "syntax check exceeded its bounded time budget"
						: stderr.trim() || error.message
					resolve("execute_command rejected: " + reason + recovery)
				} else if (stderr.includes("here-document") && stderr.includes("delimited by end-of-file")) {
					resolve("execute_command rejected: incomplete here-document waits for more input." + recovery)
				} else {
					resolve(undefined)
				}
			},
		)
		checker.stdin?.on("error", (error: NodeJS.ErrnoException) => {
			// An early syntax failure can close stdin before the small bounded input is written.
			if (error.code !== "EPIPE") console.warn("[CommandPreflight] syntax input failed:", error.message)
		})
		checker.stdin?.end(command + String.fromCharCode(10))
	})
}
