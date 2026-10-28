// kilocode_change - new file
/**
 * Count physical lines in an execute_command `command` argument.
 *
 * Only real newline bytes count. The two-character sequence "\\" + "n" is not
 * a line break. LF, CRLF, and CR are all treated as one break.
 *
 * A trailing newline is a terminator, not an extra empty line. Interior blank
 * lines still count.
 */
export const MAX_EXECUTE_COMMAND_PHYSICAL_LINES = 2

const LINE_BREAK = /\r\n|\n|\r/

export function countCommandPhysicalLines(command: string | undefined | null): number {
	if (command == null || command.length === 0) {
		return 0
	}

	const parts = command.split(LINE_BREAK)

	if (parts.length > 1 && parts[parts.length - 1] === "") {
		parts.pop()
	}

	return parts.length
}

export function isExecuteCommandOverPhysicalLineLimit(command: string | undefined | null): boolean {
	return countCommandPhysicalLines(command) > MAX_EXECUTE_COMMAND_PHYSICAL_LINES
}

export function getExecuteCommandPhysicalLineLimitError(lineCount: number): string {
	return (
		`execute_command rejected: command has ${lineCount} physical lines ` +
		`(limit ${MAX_EXECUTE_COMMAND_PHYSICAL_LINES}). Do not wait for approval or a terminal. ` +
		`Write the work to a script under EXTRA/bash/, then retry execute_command with a short ` +
		`one-line invocation of that script. Literal two-character \\n is not a line break; ` +
		`only real LF/CRLF/CR newlines count.`
	)
}
