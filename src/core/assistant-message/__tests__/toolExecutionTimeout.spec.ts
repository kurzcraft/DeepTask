import { getToolExecutionTimeoutMs } from "../presentAssistantMessage"

describe("getToolExecutionTimeoutMs", () => {
	const original = process.env.DEEPTASK_TOOL_EXECUTION_TIMEOUT_MS

	afterEach(() => {
		if (original === undefined) {
			delete process.env.DEEPTASK_TOOL_EXECUTION_TIMEOUT_MS
		} else {
			process.env.DEEPTASK_TOOL_EXECUTION_TIMEOUT_MS = original
		}
	})

	test("dispatch_subagents is not capped by the 30s presenter timeout", () => {
		expect(getToolExecutionTimeoutMs("dispatch_subagents")).toBeUndefined()
	})

	test("execute_command is owned by the terminal, not the presenter", () => {
		expect(getToolExecutionTimeoutMs("execute_command")).toBeUndefined()
	})

	test("ordinary tools keep the default 30s timeout", () => {
		delete process.env.DEEPTASK_TOOL_EXECUTION_TIMEOUT_MS
		expect(getToolExecutionTimeoutMs("read_file")).toBe(30_000)
	})
})
