// kilocode_change - new file: delegated subagent sessions must never be blocked
// by the parent-owned EXTRA/task checklist gate (they share the workspace cwd).
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg: string) => `Error: ${msg}`),
		toolResult: vi.fn((msg: string) => msg),
	},
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureTaskCompleted: vi.fn(),
		},
	},
}))

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
		})),
	},
	window: {
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
	},
}))

vi.mock("../../../shared/package", () => ({
	Package: {
		name: "kilo-code",
	},
}))

import { attemptCompletionTool, AttemptCompletionCallbacks } from "../AttemptCompletionTool"
import { Task } from "../../task/Task"

function makeCallbacks(mocks: {
	pushToolResult: ReturnType<typeof vi.fn>
	askApproval: ReturnType<typeof vi.fn>
	handleError: ReturnType<typeof vi.fn>
	removeClosingTag: ReturnType<typeof vi.fn>
	askFinishSubTaskApproval: ReturnType<typeof vi.fn>
}): AttemptCompletionCallbacks {
	return {
		askApproval: mocks.askApproval,
		handleError: mocks.handleError,
		pushToolResult: mocks.pushToolResult,
		removeClosingTag: mocks.removeClosingTag,
		askFinishSubTaskApproval: mocks.askFinishSubTaskApproval,
		toolDescription: vi.fn(),
		toolProtocol: "xml",
	}
}

describe("attemptCompletionTool delegated subagent gate exemption", () => {
	let mockTask: Partial<Task>
	let mockPushToolResult: ReturnType<typeof vi.fn>
	let mockAskApproval: ReturnType<typeof vi.fn>
	let mockHandleError: ReturnType<typeof vi.fn>
	let mockRemoveClosingTag: ReturnType<typeof vi.fn>
	let mockAskFinishSubTaskApproval: ReturnType<typeof vi.fn>

	// Mirror Task.isChildAgent: any of the delegation flags (parentTaskId /
	// isDelegatedChildProcess / subagent) exempts the child from the
	// parent-owned workspace checklist gate.
	function setDelegationFlags(task: Partial<Task>, forceChildProcess = false) {
		Object.defineProperty(task, "isChildAgent", {
			get: () =>
				!!(task as any).parentTaskId || !!(task as any).subagent || forceChildProcess === true,
			configurable: true,
		})
	}

	beforeEach(() => {
		mockPushToolResult = vi.fn()
		mockAskApproval = vi.fn()
		mockHandleError = vi.fn()
		mockRemoveClosingTag = vi.fn()
		mockAskFinishSubTaskApproval = vi.fn()

		mockTask = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			recordPrematureCompletionRejection: vi.fn(),
			todoList: undefined,
			// The parent's active workspace checklist (always incomplete while the
			// parent task is running). The child must ignore it entirely.
			getIncompleteTaskProgressItems: vi.fn().mockResolvedValue(["PARENT_TASK.md: still running"]),
		}
		setDelegationFlags(mockTask)
	})

	it("a delegated child (parentTaskId set) completes without the parent's checklist gate", async () => {
		;(mockTask as any).parentTaskId = "parent-1"

		await attemptCompletionTool.execute(
			{ result: "child work finished" },
			mockTask as Task,
			makeCallbacks({
				pushToolResult: mockPushToolResult,
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
			}),
		)

		expect(mockPushToolResult).not.toHaveBeenCalledWith(
			expect.stringContaining("Cannot complete task while EXTRA/task contains incomplete checklist items"),
		)
		expect(mockTask.consecutiveMistakeCount).toBe(0)
		expect(mockTask.recordToolError).not.toHaveBeenCalled()
	})

	it("a delegated child never even queries the shared workspace checklist", async () => {
		;(mockTask as any).parentTaskId = "parent-1"
		setDelegationFlags(mockTask)

		await attemptCompletionTool.execute(
			{ result: "done" },
			mockTask as Task,
			makeCallbacks({
				pushToolResult: mockPushToolResult,
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
			}),
		)

		// The exemption must skip the expensive workspace scan, not just ignore it.
		expect(mockTask.getIncompleteTaskProgressItems).not.toHaveBeenCalled()
	})

	it("a root task (no parentTaskId) is still blocked by the workspace checklist gate", async () => {
		await attemptCompletionTool.execute(
			{ result: "root tries to finish" },
			mockTask as Task,
			makeCallbacks({
				pushToolResult: mockPushToolResult,
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
			}),
		)

		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Cannot complete task while EXTRA/task contains incomplete checklist items"),
		)
		expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
	})

	it("a forked agent-runtime child process (isDelegatedChildProcess) is exempt", async () => {
		// Forked child processes carry no parentTaskId and no subagent field;
		// only the unified getter (driven by AGENT_CONFIG in real Tasks) exempts.
		setDelegationFlags(mockTask, true)

		await attemptCompletionTool.execute(
			{ result: "child process work finished" },
			mockTask as Task,
			makeCallbacks({
				pushToolResult: mockPushToolResult,
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
			}),
		)

		expect(mockPushToolResult).not.toHaveBeenCalledWith(
			expect.stringContaining("Cannot complete task while EXTRA/task contains incomplete checklist items"),
		)
		expect(mockTask.getIncompleteTaskProgressItems).not.toHaveBeenCalled()
	})

	it("an in-process parallel subagent (dispatch_subagents, subagent field set) is exempt", async () => {
		// dispatch_subagents spawns in-process subagents via ParallelManager.spawn:
		// no parentTaskId, no AGENT_CONFIG env — only task.subagent marks the child.
		;(mockTask as any).subagent = { sessionId: "sa-1", depth: 1, manager: { recordMessageCreated() {} } }

		await attemptCompletionTool.execute(
			{ result: "parallel subagent finished" },
			mockTask as Task,
			makeCallbacks({
				pushToolResult: mockPushToolResult,
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
			}),
		)

		expect(mockPushToolResult).not.toHaveBeenCalledWith(
			expect.stringContaining("Cannot complete task while EXTRA/task contains incomplete checklist items"),
		)
		expect(mockTask.getIncompleteTaskProgressItems).not.toHaveBeenCalled()
	})

	it("a delegated child passes the streaming handlePartial gate", async () => {
		;(mockTask as any).parentTaskId = "parent-1"

		const say = vi.fn(async () => {})
		;(mockTask as any).say = say
		;(mockTask as any).clineMessages = []
		;(mockTask as any).shouldDowngradeCompletionToActiveResponse = vi.fn(async () => false)
		;(mockTask as any).shouldRejectPrematureActiveContinuationCompletion = vi.fn().mockReturnValue(false)

		await attemptCompletionTool.handlePartial(mockTask as Task, {
			type: "tool_use",
			name: "attempt_completion",
			params: { result: "child streaming completion" },
			partial: true,
		})

		// Rendering must proceed: say() was invoked for the completion row.
		expect(say).toHaveBeenCalled()
	})
})
