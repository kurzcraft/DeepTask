import * as vscode from "vscode"

import { getTerminalShellExecutionStream } from "../TerminalShellExecutionStream"

describe("getTerminalShellExecutionStream", () => {
	it("reuses one stream when executeCommand and the start event expose the same execution", () => {
		const stream = (async function* () {
			yield "syntax and metric smoke tests passed\n"
		})()
		const execution = {
			read: vi.fn().mockReturnValue(stream),
		} as unknown as vscode.TerminalShellExecution

		expect(getTerminalShellExecutionStream(execution)).toBe(stream)
		expect(getTerminalShellExecutionStream(execution)).toBe(stream)
		expect(execution.read).toHaveBeenCalledTimes(1)
	})

	it("retries when read does not expose a stream yet", () => {
		const stream = (async function* () {
			yield "ready\n"
		})()
		const execution = {
			read: vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(stream),
		} as unknown as vscode.TerminalShellExecution

		expect(getTerminalShellExecutionStream(execution)).toBeUndefined()
		expect(getTerminalShellExecutionStream(execution)).toBe(stream)
		expect(execution.read).toHaveBeenCalledTimes(2)
	})
})
