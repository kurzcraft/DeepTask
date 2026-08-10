import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import { ClineProvider } from "../ClineProvider"
import { Task } from "../../task/Task"
import { ContextProxy } from "../../config/ContextProxy"
import { ORGANIZATION_ALLOW_ALL, type ProviderSettings, type HistoryItem } from "@roo-code/types"

// Mock dependencies
vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	return {
		workspace: {
			getConfiguration: vi.fn(() => ({
				get: vi.fn().mockReturnValue([]),
				update: vi.fn().mockResolvedValue(undefined),
			})),
			workspaceFolders: [],
			onDidChangeConfiguration: vi.fn(() => mockDisposable),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: vi.fn().mockImplementation(() => ({
			event: vi.fn(),
			fire: vi.fn(),
		})),
		Disposable: {
			from: vi.fn(),
		},
		window: {
			showErrorMessage: vi.fn(),
			createTextEditorDecorationType: vi.fn().mockReturnValue({
				dispose: vi.fn(),
			}),
			onDidChangeActiveTextEditor: vi.fn(() => mockDisposable),
		},
		Uri: {
			file: vi.fn().mockReturnValue({ toString: () => "file://test" }),
		},
	}
})

vi.mock("../../task/Task")
vi.mock("../../config/ContextProxy", () => ({
	ContextProxy: vi.fn().mockImplementation(() => ({
		getValue: vi.fn().mockReturnValue(undefined),
		setValue: vi.fn().mockResolvedValue(undefined),
		getValues: vi.fn().mockReturnValue({}),
		setValues: vi.fn().mockResolvedValue(undefined),
	})),
}))
vi.mock("../../../services/mcp/McpServerManager", () => ({
	McpServerManager: {
		getInstance: vi.fn().mockResolvedValue({
			registerClient: vi.fn(),
		}),
		unregisterProvider: vi.fn(),
	},
}))
vi.mock("../../../services/marketplace")
vi.mock("../../../integrations/workspace/WorkspaceTracker")
vi.mock("../../config/ProviderSettingsManager")
vi.mock("../../config/CustomModesManager")
vi.mock("../../../utils/path", () => ({
	getWorkspacePath: vi.fn().mockReturnValue("/test/workspace"),
}))

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			setProvider: vi.fn(),
			captureTaskCreated: vi.fn(),
		},
	},
}))

// Mock CloudService
vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(false),
		instance: {
			isAuthenticated: vi.fn().mockReturnValue(false),
		},
	},
	BridgeOrchestrator: {
		isEnabled: vi.fn().mockReturnValue(false),
	},
	getRooCodeApiUrl: vi.fn().mockReturnValue("https://api.roo-code.com"),
}))

vi.mock("../../../shared/embeddingModels", () => ({
	EMBEDDING_MODEL_PROFILES: [],
}))

vi.mock("../../../shared/kilocode/cli-sessions/core/SessionManager", () => ({
	SessionManager: {
		init: vi.fn().mockReturnValue({
			startTimer: vi.fn(),
			setPath: vi.fn(),
			setWorkspaceDirectory: vi.fn(),
			destroy: vi.fn().mockResolvedValue(undefined),
		}),
	},
}))

describe("ClineProvider flicker-free cancel", () => {
	let provider: ClineProvider
	let mockContext: any
	let mockOutputChannel: any
	let mockTask1: any
	let mockTask2: any

	const mockApiConfig: ProviderSettings = {
		apiProvider: "anthropic",
		apiKey: "test-key",
	} as ProviderSettings

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup mock extension context
		mockContext = {
			globalState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			globalStorageUri: { fsPath: "/test/storage" },
			secrets: {
				get: vi.fn().mockResolvedValue(undefined),
				store: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockResolvedValue(undefined),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			extensionUri: { fsPath: "/test/extension" },
		}

		// Setup mock output channel
		mockOutputChannel = {
			appendLine: vi.fn(),
			dispose: vi.fn(),
		}

		// Setup mock context proxy
		const mockContextProxy = {
			getValues: vi.fn().mockReturnValue({}),
			getValue: vi.fn().mockReturnValue(undefined),
			setValue: vi.fn().mockResolvedValue(undefined),
			setValues: vi.fn().mockResolvedValue(undefined),
			getProviderSettings: vi.fn().mockReturnValue(mockApiConfig),
			extensionUri: mockContext.extensionUri,
			globalStorageUri: mockContext.globalStorageUri,
		}

		// Create provider instance
		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", mockContextProxy as any)

		// Mock provider methods
		provider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: mockApiConfig,
			organizationAllowList: ORGANIZATION_ALLOW_ALL,
			mode: "code",
		})

		provider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		// Mock private method using any cast
		;(provider as any).updateGlobalState = vi.fn().mockResolvedValue(undefined)
		provider.activateProviderProfile = vi.fn().mockResolvedValue(undefined)
		provider.performPreparationTasks = vi.fn().mockResolvedValue(undefined)
		provider.getTaskWithId = vi.fn().mockImplementation((id) =>
			Promise.resolve({
				historyItem: {
					id,
					number: 1,
					ts: Date.now(),
					task: "test task",
					tokensIn: 100,
					tokensOut: 200,
					totalCost: 0.001,
					workspace: "/test/workspace",
				},
			}),
		)

		// Setup mock tasks
		mockTask1 = {
			taskId: "task-1",
			instanceId: "instance-1",
			emit: vi.fn(),
			abortTask: vi.fn().mockResolvedValue(undefined),
			cancelCurrentRequest: vi.fn(),
			abandoned: false,
			dispose: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
		}

		mockTask2 = {
			taskId: "task-1", // Same ID for rehydration scenario
			instanceId: "instance-2", // Different instance
			emit: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
			resumeTaskFromHistory: vi.fn().mockResolvedValue(undefined),
			continueTaskFromUserMessage: vi.fn().mockResolvedValue(undefined),
		}

		// Mock Task constructor
		vi.mocked(Task).mockImplementation(() => mockTask2 as any)
	})

	it("serializes consecutive rehydration payloads without overwriting the first message", async () => {
		const observedPayloads: any[] = []
		let releaseFirstCancel!: () => void
		const firstCancelReleased = new Promise<void>((resolve) => {
			releaseFirstCancel = resolve
		})
		let cancelCalls = 0
		vi.spyOn(provider, "cancelTask").mockImplementation(async () => {
			cancelCalls += 1
			observedPayloads.push((provider as any).pendingCancelledTaskContinuation)
			if (cancelCalls === 1) {
				await firstCancelReleased
			}
			;(provider as any).pendingCancelledTaskContinuation = undefined
		})

		const first = provider.rehydrateTaskWithUserMessage("first completed-task message", ["first-image"], {
			kind: "continuation",
		})
		await Promise.resolve()
		const second = provider.rehydrateTaskWithUserMessage("second completed-task message", ["second-image"], {
			kind: "continuation",
		})
		releaseFirstCancel()
		await Promise.all([first, second])

		expect(observedPayloads).toEqual([
			expect.objectContaining({
				text: "first completed-task message",
				images: ["first-image"],
				options: { kind: "continuation" },
			}),
			expect.objectContaining({
				text: "second completed-task message",
				images: ["second-image"],
				options: { kind: "continuation" },
			}),
		])
	})

	it("should not remove current task from stack when rehydrating same taskId", async () => {
		// Setup: Add a task to the stack first
		;(provider as any).clineStack = [mockTask1]

		// Mock event listeners for cleanup
		;(provider as any).taskEventListeners = new WeakMap()
		const mockCleanupFunctions = [vi.fn(), vi.fn()]
		;(provider as any).taskEventListeners.set(mockTask1, mockCleanupFunctions)

		// Spy on removeClineFromStack to verify it's NOT called
		const removeClineFromStackSpy = vi.spyOn(provider, "removeClineFromStack")

		// Create history item with same taskId as current task
		const historyItem: HistoryItem = {
			id: "task-1", // Same as mockTask1.taskId
			number: 1,
			task: "test task",
			ts: Date.now(),
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.001,
			workspace: "/test/workspace",
		}

		// Act: Create task with history item (should rehydrate in-place)
		await provider.createTaskWithHistoryItem(historyItem)

		// Assert: removeClineFromStack should NOT be called
		expect(removeClineFromStackSpy).not.toHaveBeenCalled()

		// Verify the task was replaced in-place
		expect((provider as any).clineStack).toHaveLength(1)
		expect((provider as any).clineStack[0]).toBe(mockTask2)

		// Verify old event listeners were cleaned up
		expect(mockCleanupFunctions[0]).toHaveBeenCalled()
		expect(mockCleanupFunctions[1]).toHaveBeenCalled()

		// Verify new task received focus event
		expect(mockTask2.emit).toHaveBeenCalledWith("taskFocused")
	})

	it("marks cancellation before waiting for task history so immediate follow-up input cannot hit a stale ask", async () => {
		;(provider as any).clineStack = [mockTask1]
		let resolveHistory: ((value: any) => void) | undefined
		provider.getTaskWithId = vi.fn().mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveHistory = resolve
				}),
		)

		const cancelPromise = provider.cancelTask()
		await Promise.resolve()

		expect(mockTask1.abortReason).toBe("user_cancelled")
		expect(mockTask1.abandoned).toBe(true)
		expect(mockTask1.cancelCurrentRequest).toHaveBeenCalledTimes(1)

		resolveHistory!({
			historyItem: {
				id: "task-1",
				number: 1,
				task: "test task",
				ts: Date.now(),
				tokensIn: 100,
				tokensOut: 200,
				totalCost: 0.001,
				workspace: "/test/workspace",
			},
		})
		await cancelPromise
	})

	it("clears a half-created task without a red error when persistence is missing", async () => {
		;(provider as any).clineStack = [mockTask1]
		provider.getTaskWithId = vi.fn().mockRejectedValue(new Error("Task not found"))
		provider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const removeClineFromStack = vi.spyOn(provider, "removeClineFromStack").mockImplementation(async () => {
			;(provider as any).clineStack = []
		})

		await expect(provider.cancelTask()).resolves.toBeUndefined()

		expect(mockTask1.abortReason).toBe("user_cancelled")
		expect(mockTask1.cancelCurrentRequest).toHaveBeenCalledTimes(1)
		expect(removeClineFromStack).toHaveBeenCalledTimes(1)
		expect(provider.postStateToWebview).toHaveBeenCalledTimes(1)
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "action",
			action: "chatButtonClicked",
		})
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
	})

	it("delivers a parked human message when cancellation cannot read task history", async () => {
		;(provider as any).clineStack = [mockTask1]
		provider.getTaskWithId = vi.fn().mockRejectedValue(new Error("history unavailable"))
		provider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const createTask = vi.spyOn(provider, "createTask").mockResolvedValue(mockTask2 as any)
		vi.spyOn(provider, "removeClineFromStack").mockImplementation(async () => {
			;(provider as any).clineStack = []
		})
		provider.setPendingCancelledTaskContinuation("message must reach the model", ["image-data"])

		await expect(provider.cancelTask()).resolves.toBeUndefined()

		expect(createTask).toHaveBeenCalledWith("message must reach the model", ["image-data"])
		expect((provider as any).pendingCancelledTaskContinuation).toBeUndefined()
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
	})

	it("rolls back the exact half-created task when its owned startup promise rejects", async () => {
		let rejectStartup!: (error: Error) => void
		const startup = new Promise<void>((_resolve, reject) => {
			rejectStartup = reject
		})
		const startupTask = {
			...mockTask1,
			taskId: "startup-task",
			instanceId: "startup-instance",
			parentTask: undefined,
			abortReason: undefined,
			abandoned: false,
		}
		vi.mocked(Task.create).mockReturnValue([startupTask as any, startup])
		provider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)

		await expect(provider.createTask("reply 1")).resolves.toBe(startupTask)
		expect((provider as any).clineStack).toEqual([startupTask])

		rejectStartup(new Error("Windows startup persistence failed"))

		await vi.waitFor(() => {
			expect((provider as any).clineStack).toEqual([])
		})
		expect(startupTask.abortReason).toBe("streaming_failed")
		expect(startupTask.abandoned).toBe(true)
		expect(startupTask.cancelCurrentRequest).toHaveBeenCalledTimes(1)
		expect(provider.postStateToWebview).toHaveBeenCalled()
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "invoke",
			invoke: "newChat",
		})
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"Task failed to start: Windows startup persistence failed",
		)
	})

	it("does not remove a newer task when an older startup promise rejects late", async () => {
		let rejectStartup!: (error: Error) => void
		const startup = new Promise<void>((_resolve, reject) => {
			rejectStartup = reject
		})
		const oldTask = {
			...mockTask1,
			taskId: "old-task",
			instanceId: "old-instance",
			parentTask: undefined,
			abortReason: undefined,
			abandoned: false,
		}
		const newerTask = {
			...mockTask2,
			taskId: "new-task",
			instanceId: "new-instance",
		}
		vi.mocked(Task.create).mockReturnValue([oldTask as any, startup])
		provider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)

		await provider.createTask("reply 1")
		;(provider as any).clineStack = [newerTask]
		rejectStartup(new Error("late old failure"))
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect((provider as any).clineStack).toEqual([newerTask])
		expect(oldTask.cancelCurrentRequest).not.toHaveBeenCalled()
		expect(provider.postMessageToWebview).not.toHaveBeenCalledWith({
			type: "invoke",
			invoke: "newChat",
		})
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
	})

	it("injects a cancelled continuation into the single history restoration flow", async () => {
		;(provider as any).clineStack = [mockTask1]
		;(provider as any).taskEventListeners = new WeakMap()
		;(provider as any).taskEventListeners.set(mockTask1, [vi.fn()])
		provider.setPendingCancelledTaskContinuation("latest resend", ["image-data"], {
			kind: "edited_resend",
		})

		const historyItem: HistoryItem = {
			id: "task-1",
			number: 1,
			task: "test task",
			ts: Date.now(),
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.001,
			workspace: "/test/workspace",
		}

		await provider.createTaskWithHistoryItem(historyItem)

		expect(mockTask2.resumeTaskFromHistory).toHaveBeenCalledTimes(1)
		expect(mockTask2.resumeTaskFromHistory).toHaveBeenCalledWith({
			text: "latest resend",
			images: ["image-data"],
			options: { kind: "edited_resend" },
			createdAt: expect.any(Number),
		})
		expect(mockTask2.continueTaskFromUserMessage).not.toHaveBeenCalled()
		expect((provider as any).pendingCancelledTaskContinuation).toBeUndefined()
	})

	it("delivers an edited resend through a fresh task when restoration fails", async () => {
		;(provider as any).clineStack = [mockTask1]
		;(provider as any).taskEventListeners = new WeakMap()
		;(provider as any).taskEventListeners.set(mockTask1, [vi.fn()])
		mockTask2.resumeTaskFromHistory.mockRejectedValueOnce(new Error("edited history unavailable"))
		const createTask = vi.spyOn(provider, "createTask").mockResolvedValue(mockTask2 as any)
		provider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		provider.setPendingCancelledTaskContinuation("small prompt correction", undefined, {
			kind: "edited_resend",
		})

		const historyItem: HistoryItem = {
			id: "task-1",
			number: 1,
			task: "test task",
			ts: Date.now(),
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.001,
			workspace: "/test/workspace",
		}

		await provider.createTaskWithHistoryItem(historyItem)

		expect(mockTask2.resumeTaskFromHistory).toHaveBeenCalledWith({
			text: "small prompt correction",
			images: undefined,
			options: { kind: "edited_resend" },
			createdAt: expect.any(Number),
		})
		expect(createTask).toHaveBeenCalledWith("small prompt correction", undefined)
		expect((provider as any).clineStack).toEqual([])
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
	})

	it("delivers the latest human message through a fresh task when history restoration fails", async () => {
		;(provider as any).clineStack = [mockTask1]
		;(provider as any).taskEventListeners = new WeakMap()
		;(provider as any).taskEventListeners.set(mockTask1, [vi.fn()])
		mockTask2.resumeTaskFromHistory.mockRejectedValueOnce(new Error("corrupt history"))
		const createTask = vi.spyOn(provider, "createTask").mockResolvedValue(mockTask2 as any)
		provider.setPendingCancelledTaskContinuation("latest human instruction", ["latest-image"])

		const historyItem: HistoryItem = {
			id: "task-1",
			number: 1,
			task: "test task",
			ts: Date.now(),
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.001,
			workspace: "/test/workspace",
		}

		await provider.createTaskWithHistoryItem(historyItem)

		expect(createTask).toHaveBeenCalledWith("latest human instruction", ["latest-image"])
		expect(mockTask2.resumeTaskFromHistory).toHaveBeenCalledTimes(1)
		expect((provider as any).clineStack).toEqual([])
	})

	it("makes a checkpoint edit the only continuation consumed by the restored task", async () => {
		;(provider as any).clineStack = [mockTask1]
		;(provider as any).taskEventListeners = new WeakMap()
		;(provider as any).taskEventListeners.set(mockTask1, [vi.fn()])
		provider.setPendingCancelledTaskContinuation("stale cancelled continuation", undefined, {
			kind: "edited_resend",
		})
		provider.setPendingEditOperation("task-task-1", {
			messageTs: 200,
			editedContent: "replacement message",
			images: ["replacement-image"],
			messageIndex: 2,
			apiConversationHistoryIndex: 1,
		})

		const historyItem: HistoryItem = {
			id: "task-1",
			number: 1,
			task: "test task",
			ts: Date.now(),
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.001,
			workspace: "/test/workspace",
		}

		await provider.createTaskWithHistoryItem(historyItem)

		expect(mockTask2.resumeTaskFromHistory).toHaveBeenCalledWith({
			text: "replacement message",
			images: ["replacement-image"],
			options: { kind: "edited_resend" },
			createdAt: expect.any(Number),
		})
		expect(mockTask2.continueTaskFromUserMessage).not.toHaveBeenCalled()
		expect((provider as any).pendingCancelledTaskContinuation).toBeUndefined()
		expect((provider as any).pendingOperations.size).toBe(0)
	})

	it("should detach old abort listeners before aborting a streaming task during rehydration", async () => {
		;(provider as any).clineStack = [mockTask1]
		;(provider as any).taskEventListeners = new WeakMap()
		const mockCleanupFunctions = [vi.fn(), vi.fn()]
		;(provider as any).taskEventListeners.set(mockTask1, mockCleanupFunctions)

		mockTask1.abortTask = vi.fn().mockImplementation(async () => {
			expect(mockCleanupFunctions[0]).toHaveBeenCalled()
			expect(mockCleanupFunctions[1]).toHaveBeenCalled()
			expect((provider as any).taskEventListeners.get(mockTask1)).toBeUndefined()
		})

		const historyItem: HistoryItem = {
			id: "task-1",
			number: 1,
			task: "test task",
			ts: Date.now(),
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.001,
			workspace: "/test/workspace",
		}

		await provider.createTaskWithHistoryItem(historyItem)

		expect(mockTask1.abortReason).toBe("user_cancelled")
		expect(mockTask1.cancelCurrentRequest).toHaveBeenCalledTimes(1)
		expect(mockTask1.abortTask).toHaveBeenCalledWith(true)
		expect((provider as any).clineStack[0]).toBe(mockTask2)
	})

	it("should remove task from stack when creating different task", async () => {
		// Setup: Add a task to the stack first
		;(provider as any).clineStack = [mockTask1]

		// Spy on removeClineFromStack to verify it IS called
		const removeClineFromStackSpy = vi.spyOn(provider, "removeClineFromStack").mockResolvedValue(undefined)

		// Create history item with different taskId
		const historyItem: HistoryItem = {
			id: "task-2", // Different from mockTask1.taskId
			number: 2,
			task: "different task",
			ts: Date.now(),
			tokensIn: 150,
			tokensOut: 250,
			totalCost: 0.002,
			workspace: "/test/workspace",
		}

		// Act: Create task with different history item
		await provider.createTaskWithHistoryItem(historyItem)

		// Assert: removeClineFromStack should be called
		expect(removeClineFromStackSpy).toHaveBeenCalled()
	})

	it("should handle empty stack gracefully during rehydration attempt", async () => {
		// Setup: Empty stack
		;(provider as any).clineStack = []

		// Spy on removeClineFromStack
		const removeClineFromStackSpy = vi.spyOn(provider, "removeClineFromStack").mockResolvedValue(undefined)

		// Create history item
		const historyItem: HistoryItem = {
			id: "task-1",
			number: 1,
			task: "test task",
			ts: Date.now(),
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.001,
			workspace: "/test/workspace",
		}

		// Act: Should not error and should call removeClineFromStack
		await provider.createTaskWithHistoryItem(historyItem)

		// Assert: removeClineFromStack should be called (no current task to rehydrate)
		expect(removeClineFromStackSpy).toHaveBeenCalled()
	})

	it("should maintain task stack integrity during flicker-free replacement", async () => {
		// Setup: Stack with multiple tasks
		const mockParentTask = {
			taskId: "parent-task",
			instanceId: "parent-instance",
			emit: vi.fn(),
		}

		;(provider as any).clineStack = [mockParentTask, mockTask1]
		;(provider as any).taskEventListeners = new WeakMap()
		;(provider as any).taskEventListeners.set(mockTask1, [vi.fn()])

		// Act: Rehydrate the current (top) task
		const historyItem: HistoryItem = {
			id: "task-1",
			number: 1,
			task: "test task",
			ts: Date.now(),
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.001,
			workspace: "/test/workspace",
		}

		await provider.createTaskWithHistoryItem(historyItem)

		// Assert: Stack should maintain parent task and replace current task
		expect((provider as any).clineStack).toHaveLength(2)
		expect((provider as any).clineStack[0]).toBe(mockParentTask)
		expect((provider as any).clineStack[1]).toBe(mockTask2)
	})
})
