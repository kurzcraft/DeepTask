import { parse } from "shell-quote"
// kilocode_change start
import {
	protectNewlinesInQuotes,
	restoreNewlinesFromPlaceholders,
	NEWLINE_PLACEHOLDER,
	CARRIAGE_RETURN_PLACEHOLDER,
} from "./quote-protection"
// kilocode_change end

export type ShellToken = string | { op: string } | { command: string }

/**
 * Split a command string into individual sub-commands by
 * chaining operators (&&, ||, ;, |, or &) and newlines.
 *
 * Uses shell-quote to properly handle:
 * - Quoted strings (preserves quotes and newlines within quotes)
 * - Heredoc bodies (keeps them attached to their introducing command)
 * - Subshell commands ($(cmd), `cmd`, <(cmd), >(cmd))
 * - PowerShell redirections (2>&1)
 * - Chain operators (&&, ||, ;, |, &)
 * - Newlines as command separators (but not within quotes or heredoc bodies)
 */
export function parseCommand(command: string): string[] {
	if (!command?.trim()) {
		return []
	}

	// kilocode_change start
	// First, protect newlines inside quoted strings by replacing them with placeholders
	// This prevents splitting multi-line quoted strings (e.g., git commit -m "multi\nline")
	const protectedCommand = protectNewlinesInQuotes(command, NEWLINE_PLACEHOLDER, CARRIAGE_RETURN_PLACEHOLDER)
	const commandChunks = splitCommandPreservingHeredocs(protectedCommand)
	// kilocode_change end
	const allCommands: string[] = []

	for (const commandChunk of commandChunks) {
		// Skip empty chunks
		if (!commandChunk.trim()) {
			continue
		}

		// kilocode_change start
		// Heredoc bodies are data for the introducing command. Do not parse their
		// interior lines as additional commands for auto-approval matching.
		if (containsHeredocOperator(commandChunk)) {
			allCommands.push(commandChunk.trim())
			continue
		}
		// kilocode_change end

		// Process each chunk through the existing parsing logic
		const lineCommands = parseCommandLine(commandChunk)
		allCommands.push(...lineCommands)
	}

	// kilocode_change start
	// Restore newlines and carriage returns in quoted strings
	return allCommands.map((cmd) =>
		restoreNewlinesFromPlaceholders(cmd, NEWLINE_PLACEHOLDER, CARRIAGE_RETURN_PLACEHOLDER),
	)
	// kilocode_change end
}

// kilocode_change start
function splitCommandPreservingHeredocs(command: string): string[] {
	const lines = command.split(/\r\n|\r|\n/)
	const chunks: string[] = []
	let currentChunk: string[] = []
	let pendingDelimiters: Array<{ marker: string; stripTabs: boolean }> = []

	for (const line of lines) {
		currentChunk.push(line)

		if (pendingDelimiters.length > 0) {
			const pending = pendingDelimiters[0]
			const candidate = pending.stripTabs ? line.replace(/^\t+/, "") : line

			if (candidate === pending.marker) {
				pendingDelimiters.shift()

				if (pendingDelimiters.length === 0) {
					chunks.push(currentChunk.join("\n"))
					currentChunk = []
				}
			}

			continue
		}

		pendingDelimiters = extractHeredocDelimiters(line)

		if (pendingDelimiters.length === 0) {
			chunks.push(currentChunk.join("\n"))
			currentChunk = []
		}
	}

	if (currentChunk.length > 0) {
		chunks.push(currentChunk.join("\n"))
	}

	return chunks
}

function containsHeredocOperator(command: string): boolean {
	return extractHeredocDelimiters(command.split(/\r\n|\r|\n/, 1)[0] ?? "").length > 0
}

function extractHeredocDelimiters(line: string): Array<{ marker: string; stripTabs: boolean }> {
	const delimiters: Array<{ marker: string; stripTabs: boolean }> = []
	const heredocPattern = /<<(-)?\s*(?:'([^']+)'|"([^"]+)"|\\?([^\s;&|()<>]+))/g
	let match: RegExpExecArray | null

	while ((match = heredocPattern.exec(line)) !== null) {
		const marker = match[2] ?? match[3] ?? match[4]

		if (marker) {
			delimiters.push({ marker, stripTabs: match[1] === "-" })
		}
	}

	return delimiters
}
// kilocode_change end

/**
 * Parse a single line of commands.
 */
function parseCommandLine(command: string): string[] {
	if (!command?.trim()) return []

	// Storage for replaced content
	const redirections: string[] = []
	const subshells: string[] = []
	const quotes: string[] = []
	const arrayIndexing: string[] = []
	const arithmeticExpressions: string[] = []
	const variables: string[] = []
	const parameterExpansions: string[] = []

	// First protect multi-line single-quoted strings. Bash does not execute
	// substitutions inside them, so their contents must not be parsed as
	// top-level commands. Keep single-line single quotes on shell-quote's path
	// so existing normalized output is preserved.
	// kilocode_change start
	let processedCommand = command.replace(/'[^']*(?:\r\n|\r|\n)[^']*'/g, (match) => {
		quotes.push(match)
		return `__QUOTE_${quotes.length - 1}__`
	})
	// kilocode_change end

	// Then handle redirections by temporarily replacing them.
	// kilocode_change start
	// Preserve compact fd redirections like 2>/dev/null so command matching sees
	// the same text the model/user submitted instead of shell-quote's spaced form.
	processedCommand = processedCommand.replace(/\d+>>?&?[^\s;&|()]*/g, (match) => {
		redirections.push(match)
		return `__REDIR_${redirections.length - 1}__`
	})
	// kilocode_change end

	// Handle arithmetic expressions: $((...)) pattern
	// Match the entire arithmetic expression including nested parentheses
	processedCommand = processedCommand.replace(/\$\(\([^)]*(?:\)[^)]*)*\)\)/g, (match) => {
		arithmeticExpressions.push(match)
		return `__ARITH_${arithmeticExpressions.length - 1}__`
	})

	// Handle $[...] arithmetic expressions (alternative syntax)
	processedCommand = processedCommand.replace(/\$\[[^\]]*\]/g, (match) => {
		arithmeticExpressions.push(match)
		return `__ARITH_${arithmeticExpressions.length - 1}__`
	})

	// Handle parameter expansions: ${...} patterns (including array indexing)
	// This covers ${var}, ${var:-default}, ${var:+alt}, ${#var}, ${var%pattern}, etc.
	processedCommand = processedCommand.replace(/\$\{[^}]+\}/g, (match) => {
		parameterExpansions.push(match)
		return `__PARAM_${parameterExpansions.length - 1}__`
	})

	// Handle process substitutions: <(...) and >(...)
	processedCommand = processedCommand.replace(/[<>]\(([^)]+)\)/g, (_, inner) => {
		subshells.push(inner.trim())
		return `__SUBSH_${subshells.length - 1}__`
	})

	// Handle simple variable references: $varname pattern
	// This prevents shell-quote from splitting $count into separate tokens
	processedCommand = processedCommand.replace(/\$[a-zA-Z_][a-zA-Z0-9_]*/g, (match) => {
		variables.push(match)
		return `__VAR_${variables.length - 1}__`
	})

	// Handle special bash variables: $?, $!, $#, $$, $@, $*, $-, $0-$9
	processedCommand = processedCommand.replace(/\$[?!#$@*\-0-9]/g, (match) => {
		variables.push(match)
		return `__VAR_${variables.length - 1}__`
	})

	// Then handle subshell commands $() and back-ticks.
	// kilocode_change start
	// Use balanced scanning for $() so pipes/semicolons inside command substitutions
	// stay attached to the parent shell command instead of being parsed as top-level commands.
	processedCommand = protectCommandSubstitutions(processedCommand, subshells).replace(/`(.*?)`/g, (_, inner) => {
		subshells.push(inner.trim())
		return `__SUBSH_${subshells.length - 1}__`
	})
	// kilocode_change end

	// Then handle double-quoted strings. Single-quoted strings were protected
	// before substitution scanning so their contents stay inert for parsing.
	processedCommand = processedCommand.replace(/"[^"]*"/g, (match) => {
		quotes.push(match)
		return `__QUOTE_${quotes.length - 1}__`
	})

	let tokens: ShellToken[]
	try {
		tokens = parse(processedCommand) as ShellToken[]
	} catch (error: any) {
		// If shell-quote fails to parse, fall back to simple splitting
		console.warn("shell-quote parse error:", error.message, "for command:", processedCommand)

		// Simple fallback: split by common operators
		const fallbackCommands = processedCommand
			.split(/(?:&&|\|\||;|\||&)/)
			.map((cmd) => cmd.trim())
			.filter((cmd) => cmd.length > 0)

		// Restore all placeholders for each command
		return fallbackCommands.map((cmd) =>
			restorePlaceholders(
				cmd,
				quotes,
				redirections,
				arrayIndexing,
				arithmeticExpressions,
				parameterExpansions,
				variables,
				subshells,
			),
		)
	}

	const commands: string[] = []
	let currentCommand: string[] = []

	for (const token of tokens) {
		if (typeof token === "object" && "op" in token) {
			// Chain operator - split command
			if (["&&", "||", ";", "|", "&"].includes(token.op)) {
				if (currentCommand.length > 0) {
					commands.push(currentCommand.join(" "))
					currentCommand = []
				}
			} else {
				// Other operators (>) are part of the command
				currentCommand.push(token.op)
			}
		} else if (typeof token === "string") {
			// Check if it's a subshell placeholder
			const subshellMatch = token.match(/^__SUBSH_(\d+)__$/)
			if (subshellMatch) {
				if (currentCommand.length > 0) {
					commands.push(currentCommand.join(" "))
					currentCommand = []
				}
				commands.push(subshells[parseInt(subshellMatch[1])])
			} else {
				currentCommand.push(token)
			}
		}
	}

	// Add any remaining command
	if (currentCommand.length > 0) {
		commands.push(currentCommand.join(" "))
	}

	// Restore quotes and redirections
	return commands.map((cmd) =>
		restorePlaceholders(
			cmd,
			quotes,
			redirections,
			arrayIndexing,
			arithmeticExpressions,
			parameterExpansions,
			variables,
			subshells,
		),
	)
}

// kilocode_change start
function protectCommandSubstitutions(command: string, subshells: string[]): string {
	let result = ""
	let index = 0

	while (index < command.length) {
		if (command[index] !== "$" || command[index + 1] !== "(") {
			result += command[index]
			index++
			continue
		}

		const end = findCommandSubstitutionEnd(command, index + 2)

		if (end === -1) {
			result += command[index]
			index++
			continue
		}

		subshells.push(command.slice(index + 2, end).trim())
		result += `__SUBSH_${subshells.length - 1}__`
		index = end + 1
	}

	return result
}

function findCommandSubstitutionEnd(command: string, startIndex: number): number {
	let depth = 1
	let quote: '"' | "'" | "`" | undefined
	let escaped = false

	for (let index = startIndex; index < command.length; index++) {
		const char = command[index]
		const next = command[index + 1]

		if (escaped) {
			escaped = false
			continue
		}

		if (char === "\\") {
			escaped = true
			continue
		}

		if (quote) {
			if (char === quote) {
				quote = undefined
			}
			continue
		}

		if (char === '"' || char === "'" || char === "`") {
			quote = char
			continue
		}

		if (char === "$" && next === "(") {
			depth++
			index++
			continue
		}

		if (char === ")") {
			depth--

			if (depth === 0) {
				return index
			}
		}
	}

	return -1
}
// kilocode_change end

/**
 * Helper function to restore placeholders in a command string.
 */
function restorePlaceholders(
	command: string,
	quotes: string[],
	redirections: string[],
	arrayIndexing: string[],
	arithmeticExpressions: string[],
	parameterExpansions: string[],
	variables: string[],
	subshells: string[],
): string {
	let result = command
	// Restore quotes
	result = result.replace(/__QUOTE_(\d+)__/g, (_, i) => quotes[parseInt(i)])
	const restoreRedirections = (value: string) =>
		value.replace(/__REDIR_(\d+)__/g, (_, i) => redirections[parseInt(i)])
	// Restore redirections
	result = restoreRedirections(result)
	// Restore array indexing expressions
	result = result.replace(/__ARRAY_(\d+)__/g, (_, i) => arrayIndexing[parseInt(i)])
	// Restore arithmetic expressions
	result = result.replace(/__ARITH_(\d+)__/g, (_, i) => arithmeticExpressions[parseInt(i)])
	// Restore parameter expansions
	result = result.replace(/__PARAM_(\d+)__/g, (_, i) => parameterExpansions[parseInt(i)])
	// Restore variable references
	result = result.replace(/__VAR_(\d+)__/g, (_, i) => variables[parseInt(i)])
	result = result.replace(/__SUBSH_(\d+)__/g, (_, i) => `$(${subshells[parseInt(i)]})`)
	result = restoreRedirections(result)
	return result
}
