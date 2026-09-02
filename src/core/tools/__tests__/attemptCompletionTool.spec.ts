import { TodoItem } from "@roo-code/types"

import { AttemptCompletionToolUse } from "../../../shared/tools"

// Mock the formatResponse module before importing the tool
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

// Mock vscode module
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
		})),
	},
	// kilocode_change start
	window: {
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
	},
	// kilocode_change end
}))

// Mock Package module
vi.mock("../../../shared/package", () => ({
	Package: {
		name: "kilo-code",
	},
}))

import { attemptCompletionTool, AttemptCompletionCallbacks } from "../AttemptCompletionTool"
import { Task } from "../../task/Task"
import * as vscode from "vscode"

describe("attemptCompletionTool", () => {
	let mockTask: Partial<Task>
	let mockPushToolResult: ReturnType<typeof vi.fn>
	let mockAskApproval: ReturnType<typeof vi.fn>
	let mockHandleError: ReturnType<typeof vi.fn>
	let mockRemoveClosingTag: ReturnType<typeof vi.fn>
	let mockToolDescription: ReturnType<typeof vi.fn>
	let mockAskFinishSubTaskApproval: ReturnType<typeof vi.fn>
	let mockGetConfiguration: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockPushToolResult = vi.fn()
		mockAskApproval = vi.fn()
		mockHandleError = vi.fn()
		mockRemoveClosingTag = vi.fn()
		mockToolDescription = vi.fn()
		mockAskFinishSubTaskApproval = vi.fn()
		mockGetConfiguration = vi.fn(() => ({
			get: vi.fn((key: string, defaultValue: any) => {
				if (key === "preventCompletionWithOpenTodos") {
					return defaultValue // Default to false unless overridden in test
				}
				return defaultValue
			}),
		}))

		// Setup vscode mock
		vi.mocked(vscode.workspace.getConfiguration).mockImplementation(mockGetConfiguration)

		mockTask = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			recordPrematureCompletionRejection: vi.fn(), // kilocode_change: circuit breaker hook
			todoList: undefined,
			getIncompleteTaskProgressItems: vi.fn().mockResolvedValue([]),
		}
	})

	describe("todo list validation", () => {
		it("should allow completion when there is no todo list", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				partial: false,
			}

			mockTask.todoList = undefined

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should not call pushToolResult with an error for empty todo list
			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
		})

		it("should allow completion when todo list is empty", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				partial: false,
			}

			mockTask.todoList = []

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
		})

		it("should allow completion when all todos are completed", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				partial: false,
			}

			const completedTodos: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "completed" },
			]

			mockTask.todoList = completedTodos

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
		})

		it("allows completion only after the complete unfiltered task-progress scan passes", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				partial: false,
			}
			const mockSay = vi.fn().mockResolvedValue(undefined)
			mockTask.say = mockSay
			mockTask.emit = vi.fn() as any
			;(mockTask as any).shouldRejectPrematureActiveContinuationCompletion = vi.fn().mockReturnValue(false)
			;(mockTask as any).shouldDowngradeCompletionToActiveResponse = vi.fn().mockResolvedValue(true)
			;(mockTask as any).markActiveResponseCompletionHandled = vi.fn()

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect((mockTask as any).getIncompleteTaskProgressItems).toHaveBeenCalledWith()
		})

		it("should prevent completion when task progress files contain incomplete items", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				partial: false,
			}
			;(mockTask as any).getIncompleteTaskProgressItems.mockResolvedValue(["release.md: publish the release"])

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect((mockTask as any).getIncompleteTaskProgressItems).toHaveBeenCalledWith()
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("EXTRA/task contains incomplete checklist items"),
			)
		})

		it("should prevent completion when there are pending todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithPending: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
			]

			mockTask.todoList = todosWithPending

			// Enable the setting to prevent completion with open todos
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should prevent completion when there are in-progress todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithInProgress: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "in_progress" },
			]

			mockTask.todoList = todosWithInProgress

			// Enable the setting to prevent completion with open todos
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should prevent completion when there are mixed incomplete todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				partial: false,
			}

			const mixedTodos: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
				{ id: "3", content: "Third task", status: "in_progress" },
			]

			mockTask.todoList = mixedTodos

			// Enable the setting to prevent completion with open todos
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should allow completion when setting is disabled even with incomplete todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithPending: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
			]

			mockTask.todoList = todosWithPending

			// Ensure the setting is disabled (default behavior)
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return false // Setting is disabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should not prevent completion when setting is disabled
			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should prevent completion when setting is enabled with incomplete todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithPending: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
			]

			mockTask.todoList = todosWithPending

			// Enable the setting
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should prevent completion when setting is enabled and there are incomplete todos
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should allow completion when setting is enabled but all todos are completed", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				partial: false,
			}

			const completedTodos: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "completed" },
			]

			mockTask.todoList = completedTodos

			// Enable the setting
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should allow completion when setting is enabled but all todos are completed
			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		describe("tool failure guardrail", () => {
			it("should prevent completion when a previous tool failed in the current turn", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Task completed successfully" },
					partial: false,
				}

				mockTask.todoList = undefined
				mockTask.didToolFailInCurrentTurn = true

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					removeClosingTag: mockRemoveClosingTag,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
					toolProtocol: "xml",
				}

				const mockSay = vi.fn()
				mockTask.say = mockSay

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockSay).toHaveBeenCalledWith(
					"error",
					expect.stringContaining("errors.attempt_completion_tool_failed"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("errors.attempt_completion_tool_failed"),
				)
			})

			it("should allow completion when no tools failed", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Task completed successfully" },
					partial: false,
				}

				mockTask.todoList = undefined
				mockTask.didToolFailInCurrentTurn = false

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					removeClosingTag: mockRemoveClosingTag,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
					toolProtocol: "xml",
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.consecutiveMistakeCount).toBe(0)
				expect(mockTask.recordToolError).not.toHaveBeenCalled()
			})
		})
	})

	describe("terminal completion", () => {
		it("returns after recording completion without waiting for completion feedback", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				partial: false,
			}
			const mockSay = vi.fn().mockResolvedValue(undefined)
			const mockEmit = vi.fn()
			const mockAsk = vi.fn(() => new Promise(() => {}))
			let taskCompleted = false
			const mockMarkTaskCompleted = vi.fn(() => {
				taskCompleted = true
			})
			mockTask.say = mockSay
			;(mockTask as any).ask = mockAsk
			mockTask.emit = mockEmit as any
			;(mockTask as any).hasTaskCompletedInCurrentLoop = vi.fn(() => taskCompleted)
			;(mockTask as any).markTaskCompletedInCurrentLoop = mockMarkTaskCompleted
			;(mockTask as any).emitFinalTokenUsageUpdate = vi.fn()
			;(mockTask as any).getTokenUsage = vi.fn().mockReturnValue(undefined)
			;(mockTask as any).toolUsage = undefined
			;(mockTask as any).shouldRejectPrematureActiveContinuationCompletion = vi.fn().mockReturnValue(false)
			;(mockTask as any).shouldDowngradeCompletionToActiveResponse = vi.fn().mockResolvedValue(false)

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}

			await Promise.race([
				attemptCompletionTool.handle(mockTask as Task, block, callbacks),
				new Promise((_, reject) => setTimeout(() => reject(new Error("completion tool did not return")), 50)),
			])
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockSay).toHaveBeenCalledWith(
				"completion_result",
				"Task completed successfully",
				undefined,
				false,
				undefined,
				undefined,
				{},
			)
			expect((mockTask as any).emitFinalTokenUsageUpdate).toHaveBeenCalledTimes(1)
			expect(mockEmit).toHaveBeenCalledTimes(1)
			expect(mockEmit).toHaveBeenCalledWith("taskCompleted", undefined, undefined, undefined)
			expect(mockMarkTaskCompleted).toHaveBeenCalledTimes(1)
			expect(mockAsk).not.toHaveBeenCalled()
		})
	})

	describe("active continuation completion downgrade", () => {
		it("renders continuation completion as green completion_result without completing the task", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: {
					result: "汇总安装位置、skill 内容和测试结论",
				},
				partial: false,
			}

			const mockSay = vi.fn().mockResolvedValue(undefined)
			const mockEmit = vi.fn()
			const mockMarkHandled = vi.fn()
			mockTask.say = mockSay
			mockTask.emit = mockEmit as any
			;(mockTask as any).shouldRejectPrematureActiveContinuationCompletion = vi.fn().mockReturnValue(false)
			;(mockTask as any).shouldDowngradeCompletionToActiveResponse = vi.fn().mockResolvedValue(true)
			;(mockTask as any).markActiveResponseCompletionHandled = mockMarkHandled

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}

			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockSay).toHaveBeenCalledWith(
				"completion_result",
				"汇总安装位置、skill 内容和测试结论",
				undefined,
				false,
				undefined,
				undefined,
				{},
			)
			expect(mockMarkHandled).toHaveBeenCalledTimes(1)
			expect(mockEmit).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalled()
		})

		it("rejects immediate continuation completion before any concrete work tool runs", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: {
					result: "我会继续处理这个新任务。已完成。",
				},
				partial: false,
			}

			const mockSay = vi.fn().mockResolvedValue(undefined)
			const mockMarkHandled = vi.fn()
			mockTask.say = mockSay
			;(mockTask as any).shouldRejectPrematureActiveContinuationCompletion = vi.fn().mockReturnValue(true)
			;(mockTask as any).shouldDowngradeCompletionToActiveResponse = vi.fn().mockResolvedValue(false)
			;(mockTask as any).markActiveResponseCompletionHandled = mockMarkHandled

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}

			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockSay).not.toHaveBeenCalledWith("text", expect.any(String))
			expect(mockMarkHandled).not.toHaveBeenCalled()
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			// kilocode_change: every real rejection feeds the circuit breaker
			expect(mockTask.recordPrematureCompletionRejection).toHaveBeenCalledTimes(1)
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Do not claim the continued task is complete yet"),
			)
		})

		// kilocode_change start
		it("stands the rejection gate down after the circuit breaker trips so the turn always finishes", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: {
					result: "重复收尾，断路器应放行。",
				},
				partial: false,
			}

			const mockSay = vi.fn().mockResolvedValue(undefined)
			const mockMarkHandled = vi.fn()
			mockTask.say = mockSay
			;(mockTask as any).ask = vi.fn().mockResolvedValue({ response: "messageResponse", text: "" })
			mockTask.emit = vi.fn() as any
			;(mockTask as any).hasTaskCompletedInCurrentLoop = vi.fn(() => false)
			;(mockTask as any).markTaskCompletedInCurrentLoop = vi.fn()
			;(mockTask as any).emitFinalTokenUsageUpdate = vi.fn()
			;(mockTask as any).getTokenUsage = vi.fn().mockReturnValue(undefined)
			;(mockTask as any).toolUsage = undefined
			;(mockTask as any).markActiveResponseCompletionHandled = mockMarkHandled
			// Gate already tripped: 3 rejections consumed the retry budget.
			;(mockTask as any).shouldRejectPrematureActiveContinuationCompletion = vi.fn().mockReturnValue(false)
			;(mockTask as any).shouldDowngradeCompletionToActiveResponse = vi.fn().mockResolvedValue(false)

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}

			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// The completion goes through instead of dead-looping the turn.
			expect(mockPushToolResult).not.toHaveBeenCalledWith(
				expect.stringContaining("Do not claim the continued task is complete yet"),
			)
			expect(mockTask.recordToolError).not.toHaveBeenCalledWith("attempt_completion")
		})
		// kilocode_change end

		it("renders DeepTask attempt_completion as green soft completion even outside continuation", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: {
					result: "不能再把任意发送后的回复变成任务完成。",
				},
				partial: false,
			}

			const mockSay = vi.fn().mockResolvedValue(undefined)
			const mockEmit = vi.fn()
			const mockMarkHandled = vi.fn()
			mockTask.say = mockSay
			mockTask.emit = mockEmit as any
			;(mockTask as any).shouldRejectPrematureActiveContinuationCompletion = vi.fn().mockReturnValue(false)
			;(mockTask as any).shouldDowngradeCompletionToActiveResponse = vi.fn().mockResolvedValue(true)
			;(mockTask as any).markActiveResponseCompletionHandled = mockMarkHandled

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
				toolProtocol: "xml",
			}

			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockSay).toHaveBeenCalledWith(
				"completion_result",
				"不能再把任意发送后的回复变成任务完成。",
				undefined,
				false,
				undefined,
				undefined,
				{},
			)
			expect(mockMarkHandled).toHaveBeenCalledTimes(1)
			expect(mockEmit).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalled()
		})

		it("renders streamed continuation completion as green soft completion without TaskCompleted", async () => {
			const mockSay = vi.fn().mockResolvedValue(undefined)
			const mockEmit = vi.fn()
			const mockMarkHandled = vi.fn()
			mockTask.say = mockSay
			mockTask.emit = mockEmit as any
			;(mockTask as any).shouldRejectPrematureActiveContinuationCompletion = vi.fn().mockReturnValue(false)
			;(mockTask as any).shouldDowngradeCompletionToActiveResponse = vi.fn().mockResolvedValue(true)
			;(mockTask as any).markActiveResponseCompletionHandled = mockMarkHandled

			await attemptCompletionTool.handlePartial(mockTask as Task, {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "主要结果：已安装 drawio-cli</result>" },
				partial: false,
			})

			expect(mockSay).toHaveBeenCalledWith(
				"completion_result",
				"主要结果：已安装 drawio-cli</result>",
				undefined,
				false,
				undefined,
				undefined,
				{},
			)
			expect(mockMarkHandled).toHaveBeenCalledTimes(1)
			expect(mockEmit).not.toHaveBeenCalled()
		})

		it("does not stream a completion row while any task progress item is incomplete", async () => {
			const mockSay = vi.fn().mockResolvedValue(undefined)
			mockTask.say = mockSay
			;(mockTask as any).getIncompleteTaskProgressItems.mockResolvedValue(["task-task-1.md: active work"])
			;(mockTask as any).shouldRejectPrematureActiveContinuationCompletion = vi.fn().mockReturnValue(false)

			await attemptCompletionTool.handlePartial(mockTask as Task, {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Done" },
				partial: false,
			})

			expect((mockTask as any).getIncompleteTaskProgressItems).toHaveBeenCalledWith()
			expect(mockSay).not.toHaveBeenCalled()
		})

		it("does not stream a completion row before continuation work has run", async () => {
			const mockSay = vi.fn().mockResolvedValue(undefined)
			const mockMarkHandled = vi.fn()
			const mockShouldDowngrade = vi.fn().mockResolvedValue(true)
			mockTask.say = mockSay
			;(mockTask as any).shouldRejectPrematureActiveContinuationCompletion = vi.fn().mockReturnValue(true)
			;(mockTask as any).shouldDowngradeCompletionToActiveResponse = mockShouldDowngrade
			;(mockTask as any).markActiveResponseCompletionHandled = mockMarkHandled

			await attemptCompletionTool.handlePartial(mockTask as Task, {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "" },
				partial: false,
			})

			expect(mockSay).not.toHaveBeenCalled()
			expect(mockShouldDowngrade).not.toHaveBeenCalled()
			expect(mockMarkHandled).not.toHaveBeenCalled()
		})
	})
})
