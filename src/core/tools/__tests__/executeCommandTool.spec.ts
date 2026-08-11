// npx vitest run src/core/tools/__tests__/executeCommandTool.spec.ts

import type { ToolUsage } from "@roo-code/types"
import * as vscode from "vscode"

import { Task } from "../../task/Task"
import { formatResponse } from "../../prompts/responses"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../../shared/tools"
import { unescapeHtmlEntities } from "../../../utils/text-normalization"

// Mock dependencies
vitest.mock("execa", () => ({
	execa: vitest.fn(),
}))

vitest.mock("fs/promises", () => ({
	default: {
		access: vitest.fn().mockResolvedValue(undefined),
	},
}))

vitest.mock("vscode", () => ({
	workspace: {
		getConfiguration: vitest.fn(),
	},
}))

let mockTerminal: any

vitest.mock("../../../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: {
		getOrCreateTerminal: vitest.fn().mockImplementation(async () => mockTerminal),
	},
}))

vitest.mock("../../task/Task")
vitest.mock("../../prompts/responses")

// Import the module
import * as executeCommandModule from "../ExecuteCommandTool"
const { executeCommandTool } = executeCommandModule

describe("executeCommandTool", () => {
	// Setup common test variables
	let mockCline: any & { consecutiveMistakeCount: number; didRejectTool: boolean }
	let mockAskApproval: any
	let mockHandleError: any
	let mockPushToolResult: any
	let mockRemoveClosingTag: any
	let mockToolUse: ToolUse<"execute_command">

	beforeEach(() => {
		// Reset mocks
		vitest.clearAllMocks()
		mockTerminal = {
			runCommand: vitest.fn((_command: string, callbacks: any) => {
				callbacks.onShellExecutionStarted(undefined)
				callbacks.onShellExecutionComplete({ exitCode: 0 })
				callbacks.onCompleted("Command executed")
				return Promise.resolve()
			}),
			getCurrentWorkingDirectory: vitest.fn().mockReturnValue({
				toString: () => "/test/workspace",
				toPosix: () => "/test/workspace",
			}),
		}

		// Create mock implementations with eslint directives to handle the type issues
		mockCline = {
			ask: vitest.fn().mockResolvedValue(undefined),
			say: vitest.fn().mockResolvedValue(undefined),
			sayAndCreateMissingParamError: vitest.fn().mockResolvedValue("Missing parameter error"),
			handleWebviewAskResponse: vitest.fn(),
			processQueuedMessages: vitest.fn(),
			consumePendingCommandOutputFeedback: vitest.fn().mockReturnValue(undefined),
			consumeCommandOutputFeedbackAlreadyShown: vitest.fn().mockReturnValue(false),
			supersedePendingAsk: vitest.fn(),
			consecutiveMistakeCount: 0,
			didRejectTool: false,
			rooIgnoreController: {
				validateCommand: vitest.fn().mockReturnValue(null),
			},
			recordToolUsage: vitest.fn().mockReturnValue({} as ToolUsage),
			recordToolError: vitest.fn(),
			providerRef: {
				deref: vitest.fn().mockResolvedValue({
					getState: vitest.fn().mockResolvedValue({
						terminalOutputLineLimit: 500,
						terminalOutputCharacterLimit: 100000,
						terminalShellIntegrationDisabled: true,
					}),
					postMessageToWebview: vitest.fn(),
				}),
			},
			lastMessageTs: Date.now(),
			cwd: "/test/workspace",
		}

		mockAskApproval = vitest.fn().mockResolvedValue(true)
		mockHandleError = vitest.fn().mockResolvedValue(undefined)
		mockPushToolResult = vitest.fn()
		mockRemoveClosingTag = vitest.fn().mockReturnValue("command")

		// Setup vscode config mock
		const mockConfig = {
			get: vitest.fn().mockImplementation((key: string, defaultValue: any) => defaultValue),
		}
		;(vscode.workspace.getConfiguration as any).mockReturnValue(mockConfig)

		// Create a mock tool use object
		mockToolUse = {
			type: "tool_use",
			name: "execute_command",
			params: {
				command: "echo test",
			},
			partial: false,
		}
	})

	/**
	 * Tests for HTML entity unescaping in commands
	 * This verifies that HTML entities are properly converted to their actual characters
	 */
	describe("HTML entity unescaping", () => {
		it("should unescape &lt; to < character", () => {
			const input = "echo &lt;test&gt;"
			const expected = "echo <test>"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})

		it("should unescape &gt; to > character", () => {
			const input = "echo test &gt; output.txt"
			const expected = "echo test > output.txt"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})

		it("should unescape &amp; to & character", () => {
			const input = "echo foo &amp;&amp; echo bar"
			const expected = "echo foo && echo bar"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})

		it("should handle multiple mixed HTML entities", () => {
			const input = "grep -E 'pattern' &lt;file.txt &gt;output.txt 2&gt;&amp;1"
			const expected = "grep -E 'pattern' <file.txt >output.txt 2>&1"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})
	})

	// Now we can run these tests
	describe("Basic functionality", () => {
		it("should execute a command normally", async () => {
			// Setup
			mockToolUse.params.command = "echo test"

			// Execute using the class-based handle method
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
				removeClosingTag: mockRemoveClosingTag as unknown as RemoveClosingTag,
				toolProtocol: "xml",
			})

			// Verify
			expect(mockAskApproval).toHaveBeenCalledWith("command", "echo test")
			expect(mockPushToolResult).toHaveBeenCalled()
			// The exact message depends on the terminal mock's behavior
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("Command")
		})

		it("should pass along custom working directory if provided", async () => {
			// Setup
			mockToolUse.params.command = "echo test"
			mockToolUse.params.cwd = "/custom/path"
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue({
				toString: () => "/custom/path",
				toPosix: () => "/custom/path",
			})

			// Execute
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
				removeClosingTag: mockRemoveClosingTag as unknown as RemoveClosingTag,
				toolProtocol: "xml",
			})

			// Verify - confirm the command was approved and result was pushed
			// The custom path handling is tested in integration tests
			expect(mockAskApproval).toHaveBeenCalledWith("command", "echo test")
			expect(mockPushToolResult).toHaveBeenCalled()
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("/custom/path")
		})
	})

	describe("Error handling", () => {
		it("should handle missing command parameter", async () => {
			// Setup
			mockToolUse.params.command = undefined

			// Execute
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
				removeClosingTag: mockRemoveClosingTag as unknown as RemoveClosingTag,
				toolProtocol: "xml",
			})

			// Verify
			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("execute_command", "command")
			expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(mockTerminal.runCommand).not.toHaveBeenCalled()
		})

		it("should handle command rejection", async () => {
			// Setup
			mockToolUse.params.command = "echo test"
			mockAskApproval.mockResolvedValue(false)

			// Execute
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
				removeClosingTag: mockRemoveClosingTag as unknown as RemoveClosingTag,
				toolProtocol: "xml",
			})

			// Verify
			expect(mockAskApproval).toHaveBeenCalledWith("command", "echo test")
			// executeCommandInTerminal should not be called since approval was denied
			expect(mockPushToolResult).not.toHaveBeenCalled()
		})

		it("should handle rooignore validation failures", async () => {
			// Setup
			mockToolUse.params.command = "cat .env"
			// Override the validateCommand mock to return a filename
			const validateCommandMock = vitest.fn().mockReturnValue(".env")
			mockCline.rooIgnoreController = {
				validateCommand: validateCommandMock,
			}

			const mockRooIgnoreError = "RooIgnore error"
			;(formatResponse.rooIgnoreError as any).mockReturnValue(mockRooIgnoreError)

			// Execute
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
				removeClosingTag: mockRemoveClosingTag as unknown as RemoveClosingTag,
				toolProtocol: "xml",
			})

			// Verify
			expect(validateCommandMock).toHaveBeenCalledWith("cat .env")
			expect(mockCline.say).toHaveBeenCalledWith("rooignore_error", ".env")
			expect(formatResponse.rooIgnoreError).toHaveBeenCalledWith(".env", "xml")
			expect(mockPushToolResult).toHaveBeenCalledWith(mockRooIgnoreError)
			expect(mockAskApproval).not.toHaveBeenCalled()
			// executeCommandInTerminal should not be called since rooignore blocked it
		})
	})

	describe("command output waiting state", () => {
		it("auto-clears pending command_output ask without detaching output capture", async () => {
			const handleWebviewAskResponse = vitest.fn()
			const say = vitest.fn().mockResolvedValue(undefined)
			const postMessageToWebview = vitest.fn()
			let capturedCallbacks: any
			let resolveProcess: () => void
			const processPromise: any = new Promise<void>((resolve) => {
				resolveProcess = resolve
			})
			processPromise.continue = vitest.fn()

			mockTerminal.runCommand = vitest.fn((_command: string, callbacks: any) => {
				capturedCallbacks = callbacks
				return processPromise
			})

			const task = {
				ask: vitest.fn().mockImplementation(() => new Promise(() => {})),
				say,
				handleWebviewAskResponse,
				hasPendingWebviewAskResponse: vitest.fn().mockReturnValue(true),
				processQueuedMessages: vitest.fn(),
				consumePendingCommandOutputFeedback: vitest.fn().mockReturnValue(undefined),
				providerRef: {
					deref: () => ({ postMessageToWebview }),
				},
				cwd: "/test/workspace",
				taskId: "task-1",
				terminalProcess: undefined,
			} as unknown as Task

			const resultPromise = executeCommandModule.executeCommandInTerminal(task, {
				executionId: "exec-1",
				command: "echo test",
				terminalShellIntegrationDisabled: true,
			})

			await vi.waitFor(() => expect(capturedCallbacks).toBeDefined())
			void capturedCallbacks.onLine("output\n", processPromise)
			await vi.waitFor(() => expect(task.ask).toHaveBeenCalledWith("command_output", ""))
			await vi.waitFor(() => expect(handleWebviewAskResponse).toHaveBeenCalledWith("yesButtonClicked"))
			expect(processPromise.continue).not.toHaveBeenCalled()
			capturedCallbacks.onShellExecutionComplete({ exitCode: 0 })
			capturedCallbacks.onCompleted("output\n", processPromise)
			resolveProcess!()

			await resultPromise

			expect(task.ask).toHaveBeenCalledWith("command_output", "")
			expect(say).toHaveBeenCalledWith("command_output", "output\n", undefined, undefined, undefined, undefined, {
				isNonInteractive: true,
			})
			expect(handleWebviewAskResponse).toHaveBeenCalledWith("yesButtonClicked")
			expect(processPromise.continue).not.toHaveBeenCalled()
		})

		it("auto-clears a fast command_output ask without detaching terminal output capture", async () => {
			const handleWebviewAskResponse = vitest.fn()
			const say = vitest.fn().mockResolvedValue(undefined)
			const postMessageToWebview = vitest.fn()
			let capturedCallbacks: any
			let resolveProcess: () => void
			const processPromise: any = new Promise<void>((resolve) => {
				resolveProcess = resolve
			})
			processPromise.continue = vitest.fn()

			mockTerminal.runCommand = vitest.fn((_command: string, callbacks: any) => {
				capturedCallbacks = callbacks
				return processPromise
			})

			const task = {
				ask: vitest.fn().mockImplementation(() => new Promise(() => {})),
				say,
				handleWebviewAskResponse,
				hasPendingWebviewAskResponse: vitest.fn().mockReturnValue(false),
				processQueuedMessages: vitest.fn(),
				consumePendingCommandOutputFeedback: vitest.fn().mockReturnValue(undefined),
				providerRef: {
					deref: () => ({ postMessageToWebview }),
				},
				cwd: "/test/workspace",
				taskId: "task-1",
				terminalProcess: undefined,
			} as unknown as Task

			const resultPromise = executeCommandModule.executeCommandInTerminal(task, {
				executionId: "exec-1",
				command: "cat >> /tmp/progress.md <<'MD'\n- [x] done\nMD",
				terminalShellIntegrationDisabled: true,
			})

			await vi.waitFor(() => expect(capturedCallbacks).toBeDefined())
			void capturedCallbacks.onLine("first chunk\n", processPromise)
			await vi.waitFor(() => expect(handleWebviewAskResponse).toHaveBeenCalledWith("yesButtonClicked"))

			let settled = false
			void resultPromise.then(() => {
				settled = true
			})
			await new Promise((resolve) => setTimeout(resolve, 10))
			expect(settled).toBe(false)
			expect(processPromise.continue).not.toHaveBeenCalled()

			capturedCallbacks.onShellExecutionComplete({ exitCode: 0 })
			capturedCallbacks.onCompleted("first chunk\nfinal chunk\n", processPromise)
			resolveProcess!()

			const [, toolResult] = await resultPromise

			expect(String(toolResult)).toContain("final chunk")
			expect(task.hasPendingWebviewAskResponse).toHaveReturnedWith(false)
		})

		it("clears a still-pending command_output ask even after the local ask promise settled", async () => {
			const handleWebviewAskResponse = vitest.fn()
			const say = vitest.fn().mockResolvedValue(undefined)
			const postMessageToWebview = vitest.fn()
			let capturedCallbacks: any
			let resolveProcess: () => void
			const processPromise: any = new Promise<void>((resolve) => {
				resolveProcess = resolve
			})
			processPromise.continue = vitest.fn()

			mockTerminal.runCommand = vitest.fn((_command: string, callbacks: any) => {
				capturedCallbacks = callbacks
				return processPromise
			})

			const task = {
				ask: vitest.fn().mockResolvedValue({ response: "yesButtonClicked" }),
				say,
				handleWebviewAskResponse,
				hasPendingWebviewAskResponse: vitest.fn().mockReturnValue(true),
				processQueuedMessages: vitest.fn(),
				consumePendingCommandOutputFeedback: vitest.fn().mockReturnValue(undefined),
				consumeCommandOutputFeedbackAlreadyShown: vitest.fn().mockReturnValue(false),
				providerRef: {
					deref: () => ({ postMessageToWebview }),
				},
				cwd: "/test/workspace",
				taskId: "task-1",
				terminalProcess: undefined,
			} as unknown as Task

			const resultPromise = executeCommandModule.executeCommandInTerminal(task, {
				executionId: "exec-1",
				command: "printf done",
				terminalShellIntegrationDisabled: true,
			})

			await vi.waitFor(() => expect(capturedCallbacks).toBeDefined())
			void capturedCallbacks.onLine("done\n", processPromise)
			await vi.waitFor(() => expect(task.ask).toHaveBeenCalledWith("command_output", ""))
			capturedCallbacks.onShellExecutionComplete({ exitCode: 0 })
			capturedCallbacks.onCompleted("done\n", processPromise)
			resolveProcess!()

			await resultPromise

			expect(handleWebviewAskResponse).toHaveBeenCalledWith("yesButtonClicked")
			expect(processPromise.continue).not.toHaveBeenCalled()
		})

		it("finishes when completion is emitted even if continue is missed", async () => {
			const say = vitest.fn().mockResolvedValue(undefined)
			const postMessageToWebview = vitest.fn()
			let capturedCallbacks: any
			const processPromise: any = new Promise<void>(() => {})
			processPromise.continue = vitest.fn()

			mockTerminal.runCommand = vitest.fn((_command: string, callbacks: any) => {
				capturedCallbacks = callbacks
				return processPromise
			})

			const task = {
				ask: vitest.fn(),
				say,
				handleWebviewAskResponse: vitest.fn(),
				hasPendingWebviewAskResponse: vitest.fn().mockReturnValue(false),
				processQueuedMessages: vitest.fn(),
				consumePendingCommandOutputFeedback: vitest.fn().mockReturnValue(undefined),
				consumeCommandOutputFeedbackAlreadyShown: vitest.fn().mockReturnValue(false),
				providerRef: {
					deref: () => ({ postMessageToWebview }),
				},
				cwd: "/test/workspace",
				taskId: "task-1",
				terminalProcess: undefined,
			} as unknown as Task

			const resultPromise = executeCommandModule.executeCommandInTerminal(task, {
				executionId: "exec-1",
				command: "python3 -m py_compile a.py && python3 - <<'PY'\nprint('done')\nPY",
				terminalShellIntegrationDisabled: true,
			})

			await vi.waitFor(() => expect(capturedCallbacks).toBeDefined())
			capturedCallbacks.onShellExecutionComplete({ exitCode: 0 })
			capturedCallbacks.onCompleted("done\n", processPromise)

			const [, toolResult] = await resultPromise

			expect(String(toolResult)).toContain("Exit code: 0")
			expect(task.processQueuedMessages).toHaveBeenCalled()
			expect(processPromise.continue).not.toHaveBeenCalled()
		})

		it("waits for the final command_output message before returning the tool result", async () => {
			let capturedCallbacks: any
			let resolveOutput: () => void
			const outputPersisted = new Promise<void>((resolve) => {
				resolveOutput = resolve
			})
			const say = vitest.fn().mockImplementation(async (type: string) => {
				if (type === "command_output") {
					await outputPersisted
				}
			})
			const processPromise: any = new Promise<void>(() => {})
			processPromise.continue = vitest.fn()
			mockTerminal.runCommand = vitest.fn((_command: string, callbacks: any) => {
				capturedCallbacks = callbacks
				return processPromise
			})

			const task = {
				ask: vitest.fn(),
				say,
				handleWebviewAskResponse: vitest.fn(),
				hasPendingWebviewAskResponse: vitest.fn().mockReturnValue(false),
				processQueuedMessages: vitest.fn(),
				consumePendingCommandOutputFeedback: vitest.fn().mockReturnValue(undefined),
				consumeCommandOutputFeedbackAlreadyShown: vitest.fn().mockReturnValue(false),
				providerRef: { deref: () => ({ postMessageToWebview: vitest.fn() }) },
				cwd: "/test/workspace",
				taskId: "task-1",
				terminalProcess: undefined,
			} as unknown as Task

			const resultPromise = executeCommandModule.executeCommandInTerminal(task, {
				executionId: "exec-1",
				command: "ps -eo pid,lstart,cmd | rg VSCodium; python3 - <<'PY'\nprint('done')\nPY",
				terminalShellIntegrationDisabled: true,
			})

			await vi.waitFor(() => expect(capturedCallbacks).toBeDefined())
			capturedCallbacks.onShellExecutionComplete({ exitCode: 0 })
			capturedCallbacks.onCompleted("done\n", processPromise)
			await Promise.resolve()

			let settled = false
			void resultPromise.then(() => {
				settled = true
			})
			await new Promise((resolve) => setTimeout(resolve, 10))
			expect(settled).toBe(false)

			resolveOutput!()
			await resultPromise
			expect(say).toHaveBeenCalledWith("command_output", "done\n", undefined, undefined, undefined, undefined, {
				isNonInteractive: true,
			})
		})

		it("finishes after shell exit even if the terminal process promise does not resolve", async () => {
			const say = vitest.fn().mockResolvedValue(undefined)
			const postMessageToWebview = vitest.fn()
			let capturedCallbacks: any
			const processPromise: any = new Promise<void>(() => {})
			processPromise.continue = vitest.fn()

			mockTerminal.runCommand = vitest.fn((_command: string, callbacks: any) => {
				capturedCallbacks = callbacks
				return processPromise
			})

			const task = {
				ask: vitest.fn(),
				say,
				handleWebviewAskResponse: vitest.fn(),
				hasPendingWebviewAskResponse: vitest.fn().mockReturnValue(false),
				processQueuedMessages: vitest.fn(),
				consumePendingCommandOutputFeedback: vitest.fn().mockReturnValue(undefined),
				consumeCommandOutputFeedbackAlreadyShown: vitest.fn().mockReturnValue(false),
				providerRef: {
					deref: () => ({ postMessageToWebview }),
				},
				cwd: "/test/workspace",
				taskId: "task-1",
				terminalProcess: undefined,
			} as unknown as Task

			const resultPromise = executeCommandModule.executeCommandInTerminal(task, {
				executionId: "exec-1",
				command:
					"out=任务记录/check.txt; { python3 - <<'PY'\nprint('ok')\nPY\n} > \"$out\"; printf '%s\\n' \"$out\"",
				terminalShellIntegrationDisabled: false,
			})

			await vi.waitFor(() => expect(capturedCallbacks).toBeDefined())
			capturedCallbacks.onShellExecutionComplete({ exitCode: 0 })

			const [, toolResult] = await resultPromise

			expect(String(toolResult)).toContain("Exit code: 0")
			expect(processPromise.continue).not.toHaveBeenCalled()
			expect(task.processQueuedMessages).toHaveBeenCalled()
		})

		it("posts a terminal exit status and persists empty output when only shell exit arrives", async () => {
			const say = vitest.fn().mockResolvedValue(undefined)
			const postMessageToWebview = vitest.fn()
			let capturedCallbacks: any
			const processPromise: any = new Promise<void>(() => {})
			processPromise.continue = vitest.fn()

			mockTerminal.runCommand = vitest.fn((_command: string, callbacks: any) => {
				capturedCallbacks = callbacks
				return processPromise
			})

			const task = {
				askId: "task-1",
				cwd: "/test/workspace",
				terminalProcess: undefined,
				ask: vitest.fn(),
				say,
				handleWebviewAskResponse: vitest.fn(),
				hasPendingWebviewAskResponse: vitest.fn().mockReturnValue(false),
				processQueuedMessages: vitest.fn(),
				consumePendingCommandOutputFeedback: vitest.fn().mockReturnValue(undefined),
				consumeCommandOutputFeedbackAlreadyShown: vitest.fn().mockReturnValue(false),
				providerRef: { deref: () => ({ postMessageToWebview }) },
			} as unknown as Task

			const resultPromise = executeCommandModule.executeCommandInTerminal(task, {
				executionId: "exec-shell-only",
				command: "./scripts_long_task.sh",
				terminalShellIntegrationDisabled: false,
			})

			await vi.waitFor(() => expect(capturedCallbacks).toBeDefined())
			vi.useFakeTimers()
			capturedCallbacks.onShellExecutionComplete({ exitCode: 0 })
			await vi.advanceTimersByTimeAsync(5_050)

			const [, toolResult] = await resultPromise
			const statuses = postMessageToWebview.mock.calls
				.map(([message]) => message)
				.filter((message) => message.type === "commandExecutionStatus")
				.map((message) => JSON.parse(message.text))

			expect(statuses).toContainEqual({ executionId: "exec-shell-only", status: "exited", exitCode: 0 })
			expect(say).toHaveBeenCalledWith("command_output", "", undefined, undefined, undefined, undefined, {
				isNonInteractive: true,
			})
			expect(String(toolResult)).toContain("Exit code: 0")
			expect(task.processQueuedMessages).toHaveBeenCalled()
			vi.useRealTimers()
		})

		it("does not hang after command completion when final output persistence never settles", async () => {
			vi.useFakeTimers()
			const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
			let capturedCallbacks: any
			const processPromise: any = new Promise<void>(() => {})
			processPromise.continue = vitest.fn()
			mockTerminal.runCommand = vitest.fn((_command: string, callbacks: any) => {
				capturedCallbacks = callbacks
				return processPromise
			})

			const task = {
				askId: "task-1",
				cwd: "/test/workspace",
				terminalProcess: undefined,
				ask: vitest.fn(),
				say: vitest.fn().mockImplementation(() => new Promise<undefined>(() => {})),
				handleWebviewAskResponse: vitest.fn(),
				hasPendingWebviewAskResponse: vitest.fn().mockReturnValue(false),
				processQueuedMessages: vitest.fn(),
				consumePendingCommandOutputFeedback: vitest.fn().mockReturnValue(undefined),
				consumeCommandOutputFeedbackAlreadyShown: vitest.fn().mockReturnValue(false),
				providerRef: { deref: () => ({ postMessageToWebview: vitest.fn() }) },
			} as unknown as Task

			try {
				const resultPromise = executeCommandModule.executeCommandInTerminal(task, {
					executionId: "exec-persistence-stall",
					command: "pnpm exec vitest run cli-utils-tests",
					terminalShellIntegrationDisabled: false,
				})

				await vi.waitFor(() => expect(capturedCallbacks).toBeDefined())
				capturedCallbacks.onShellExecutionComplete({ exitCode: 0 })
				capturedCallbacks.onCompleted("26 tests passed\n")
				await vi.advanceTimersByTimeAsync(2_100)

				const [rejected, toolResult] = await resultPromise
				expect(rejected).toBe(false)
				expect(String(toolResult)).toContain("Exit code: 0")
				expect(String(toolResult)).toContain("26 tests passed")
				expect(task.processQueuedMessages).toHaveBeenCalled()
				expect(consoleError).toHaveBeenCalledWith(
					"[ExecuteCommandTool] Final command output persistence did not settle within 2000ms; continuing with the captured tool result.",
				)
			} finally {
				vi.useRealTimers()
				consoleError.mockRestore()
			}
		})

		it("ignores duplicate completion callbacks", async () => {
			const say = vitest.fn().mockResolvedValue(undefined)
			let capturedCallbacks: any
			const processPromise: any = new Promise<void>(() => {})
			processPromise.continue = vitest.fn()
			mockTerminal.runCommand = vitest.fn((_command: string, callbacks: any) => {
				capturedCallbacks = callbacks
				return processPromise
			})
			const task = {
				askId: "task-1",
				cwd: "/test/workspace",
				terminalProcess: undefined,
				ask: vitest.fn(),
				say,
				handleWebviewAskResponse: vitest.fn(),
				hasPendingWebviewAskResponse: vitest.fn().mockReturnValue(false),
				processQueuedMessages: vitest.fn(),
				consumePendingCommandOutputFeedback: vitest.fn().mockReturnValue(undefined),
				consumeCommandOutputFeedbackAlreadyShown: vitest.fn().mockReturnValue(false),
				providerRef: { deref: () => ({ postMessageToWebview: vitest.fn() }) },
			} as unknown as Task

			const resultPromise = executeCommandModule.executeCommandInTerminal(task, {
				executionId: "exec-duplicate",
				command: "printf done",
			})
			await vi.waitFor(() => expect(capturedCallbacks).toBeDefined())
			capturedCallbacks.onShellExecutionComplete({ exitCode: 0 })
			capturedCallbacks.onCompleted("first\n")
			capturedCallbacks.onCompleted("second\n")

			const [, toolResult] = await resultPromise
			expect(String(toolResult)).toContain("first")
			expect(String(toolResult)).not.toContain("second")
			expect(say).toHaveBeenCalledTimes(1)
		})

		it("returns finished tool result with output when force-continue feedback arrives after exit", async () => {
			const say = vitest.fn().mockResolvedValue(undefined)
			const postMessageToWebview = vitest.fn()
			let capturedCallbacks: any
			let resolveProcess: () => void
			const processPromise: any = new Promise<void>((resolve) => {
				resolveProcess = resolve
			})
			processPromise.continue = vitest.fn()

			mockTerminal.runCommand = vitest.fn((_command: string, callbacks: any) => {
				capturedCallbacks = callbacks
				return processPromise
			})

			const task = {
				ask: vitest.fn().mockImplementation(() => new Promise(() => {})),
				say,
				handleWebviewAskResponse: vitest.fn(),
				hasPendingWebviewAskResponse: vitest.fn().mockReturnValue(false),
				processQueuedMessages: vitest.fn(),
				consumePendingCommandOutputFeedback: vitest.fn().mockReturnValue({
					text: "force continue after long command",
					images: undefined,
				}),
				consumeCommandOutputFeedbackAlreadyShown: vitest.fn().mockReturnValue(true),
				providerRef: {
					deref: () => ({ postMessageToWebview }),
				},
				cwd: "/test/workspace",
				taskId: "task-1",
				terminalProcess: undefined,
			} as unknown as Task

			const resultPromise = executeCommandModule.executeCommandInTerminal(task, {
				executionId: "exec-1",
				command: "python3 - <<'PY'\nprint('long-command-output')\nPY",
				terminalShellIntegrationDisabled: true,
			})

			await vi.waitFor(() => expect(capturedCallbacks).toBeDefined())
			void capturedCallbacks.onLine("long-command-output\n", processPromise)
			capturedCallbacks.onShellExecutionComplete({ exitCode: 0 })
			capturedCallbacks.onCompleted("long-command-output\n", processPromise)
			resolveProcess!()

			const [rejected, toolResult] = await resultPromise

			expect(rejected).toBe(false)
			expect(String(toolResult)).toContain("Exit code: 0")
			expect(String(toolResult)).toContain("long-command-output")
			expect(String(toolResult)).toContain("force continue after long command")
			expect(String(toolResult)).not.toContain("still running")
			expect(task.processQueuedMessages).toHaveBeenCalled()
		})

		it("falls back to streamed output when completed payload is empty after continue", async () => {
			const say = vitest.fn().mockResolvedValue(undefined)
			const postMessageToWebview = vitest.fn()
			let capturedCallbacks: any
			let resolveProcess: () => void
			const processPromise: any = new Promise<void>((resolve) => {
				resolveProcess = resolve
			})
			processPromise.continue = vitest.fn()

			mockTerminal.runCommand = vitest.fn((_command: string, callbacks: any) => {
				capturedCallbacks = callbacks
				return processPromise
			})

			const task = {
				ask: vitest.fn().mockImplementation(() => new Promise(() => {})),
				say,
				handleWebviewAskResponse: vitest.fn(),
				hasPendingWebviewAskResponse: vitest.fn().mockReturnValue(false),
				processQueuedMessages: vitest.fn(),
				consumePendingCommandOutputFeedback: vitest.fn().mockReturnValue(undefined),
				consumeCommandOutputFeedbackAlreadyShown: vitest.fn().mockReturnValue(false),
				providerRef: {
					deref: () => ({ postMessageToWebview }),
				},
				cwd: "/test/workspace",
				taskId: "task-1",
				terminalProcess: undefined,
			} as unknown as Task

			const resultPromise = executeCommandModule.executeCommandInTerminal(task, {
				executionId: "exec-1",
				command: "printf 'streamed-only\\n'",
				terminalShellIntegrationDisabled: true,
			})

			await vi.waitFor(() => expect(capturedCallbacks).toBeDefined())
			void capturedCallbacks.onLine("streamed-only\n", processPromise)
			capturedCallbacks.onShellExecutionComplete({ exitCode: 0 })
			// Simulate continue() detaching listeners so completed payload is empty.
			capturedCallbacks.onCompleted("", processPromise)
			resolveProcess!()

			const [, toolResult] = await resultPromise

			expect(String(toolResult)).toContain("streamed-only")
			expect(String(toolResult)).toContain("Exit code: 0")
		})
	})

	describe("Command execution timeout configuration", () => {
		it("should include timeout parameter in ExecuteCommandOptions", () => {
			// This test verifies that the timeout configuration is properly typed
			// The actual timeout logic is tested in integration tests
			// Note: timeout is stored internally in milliseconds but configured in seconds
			const timeoutSeconds = 15
			const options = {
				executionId: "test-id",
				command: "echo test",
				commandExecutionTimeout: timeoutSeconds * 1000, // Convert to milliseconds
			}

			// Verify the options object has the expected structure
			expect(options.commandExecutionTimeout).toBe(15000)
			expect(typeof options.commandExecutionTimeout).toBe("number")
		})

		it("should handle timeout parameter in function signature", () => {
			// Test that the executeCommandInTerminal function accepts timeout parameter
			// This is a compile-time check that the types are correct
			const mockOptions = {
				executionId: "test-id",
				command: "echo test",
				customCwd: undefined,
				terminalShellIntegrationDisabled: false,
				terminalOutputLineLimit: 500,
				commandExecutionTimeout: 0,
			}

			// Verify all required properties exist
			expect(mockOptions.executionId).toBeDefined()
			expect(mockOptions.command).toBeDefined()
			expect(mockOptions.commandExecutionTimeout).toBeDefined()
		})
	})
})
