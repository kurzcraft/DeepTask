// kilocode_change - new file
import * as vscode from "vscode"

const executionStreams = new WeakMap<vscode.TerminalShellExecution, AsyncIterable<string>>()

/**
 * Returns one shared output stream for a shell execution.
 *
 * VS Code exposes the same execution through executeCommand() and the shell-start
 * event. Calling read() independently from both paths can create competing
 * consumers and lose output, so the first valid stream is reused.
 */
export function getTerminalShellExecutionStream(
	execution: vscode.TerminalShellExecution,
): AsyncIterable<string> | undefined {
	const existingStream = executionStreams.get(execution)

	if (existingStream) {
		return existingStream
	}

	const stream = execution.read()
	if (!stream || typeof stream[Symbol.asyncIterator] !== "function") {
		return undefined
	}

	executionStreams.set(execution, stream)
	return stream
}
