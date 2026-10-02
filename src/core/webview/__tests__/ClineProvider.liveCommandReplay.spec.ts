import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	Uri: { joinPath: vi.fn(), file: vi.fn() },
	commands: { executeCommand: vi.fn().mockResolvedValue(undefined) },
	window: {
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue([]), update: vi.fn() }),
		onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
	},
	env: { uriScheme: "vscode", language: "en", appName: "VSCodium", uiKind: 1 },
	ExtensionMode: { Production: 1, Development: 2, Test: 3 },
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureModeSwitch: vi.fn() } },
}))

// Borrow the real prototype so focusTask, the live-command registry, and the
// sticky mode/profile restoration run as production code against mock fields.

const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
const parallelManager = {
	conversationForSession: vi.fn(),
	setActiveConversation: vi.fn().mockResolvedValue(undefined),
	broadcast: vi.fn().mockResolvedValue(undefined),
}

const provider: any = {
	postMessageToWebview,
	postStateToWebview: vi.fn().mockResolvedValue(undefined),
	parallelManager,
	pendingNewConversation: undefined,
	clineStack: [],
	getGlobalState: vi.fn().mockReturnValue(undefined),
	updateGlobalState: vi.fn().mockResolvedValue(undefined),
	emit: vi.fn(),
}

import { ClineProvider } from "../ClineProvider"

Object.setPrototypeOf(provider, ClineProvider.prototype)

describe("ClineProvider live-command registry (fix 6)", () => {
	beforeEach(() => {
		provider.activeCommandExecutionsByTask = new Map()
		postMessageToWebview.mockClear()
	})

	it("tracks started/output as live and removes them on exit", () => {
		provider.trackCommandExecutionStatus("task-a", "e1", "started")
		provider.trackCommandExecutionStatus("task-a", "e1", "output")
		provider.trackCommandExecutionStatus("task-a", "e2", "started")
		expect(provider.activeCommandExecutionsByTask.get("task-a")).toHaveLength(2)

		provider.trackCommandExecutionStatus("task-a", "e1", "exited")
		expect(provider.activeCommandExecutionsByTask.get("task-a")).toHaveLength(1)

		provider.trackCommandExecutionStatus("task-a", "e2", "timeout")
		expect(provider.activeCommandExecutionsByTask.has("task-a")).toBe(false)
	})

	it("ignores events without a taskId (legacy hosts)", () => {
		provider.trackCommandExecutionStatus(undefined, "e1", "started")
		expect(provider.activeCommandExecutionsByTask.size).toBe(0)
	})

	it("replays live commands to the webview for the focused task only", () => {
		const taskA = { taskId: "task-a", getTaskMode: vi.fn(), getTaskApiConfigName: vi.fn() }
		provider.clineStack = [taskA]
		provider.getFocusedChatTask = () => taskA

		provider.trackCommandExecutionStatus("task-a", "e1", "started")
		provider.trackCommandExecutionStatus("task-b", "e9", "started")

		provider.replayFocusedTaskLiveCommands()

		expect(postMessageToWebview).toHaveBeenCalledTimes(1)
		const payload = JSON.parse(postMessageToWebview.mock.calls[0][0].text)
		expect(payload.executionId).toBe("e1")
		expect(payload.status).toBe("started")
		expect(payload.taskId).toBe("task-a")
	})

	it("replays nothing when the focused task has no live commands", () => {
		const taskB = { taskId: "task-b" }
		provider.clineStack = [taskB]
		provider.getFocusedChatTask = () => taskB

		provider.replayFocusedTaskLiveCommands()
		expect(postMessageToWebview).not.toHaveBeenCalled()
	})
})

describe("handleModeSwitch targets the focused conversation (fix 7A)", () => {
	beforeEach(() => {
		provider.updateGlobalState.mockClear()
	})

	it("does not write the mode into a background stack-top task when a focused task exists", async () => {
		const focusedTask = { taskId: "task-focused" }
		const stackTopTask = { taskId: "task-stack-top" }
		provider.clineStack = [stackTopTask]
		provider.getCurrentTask = () => stackTopTask
		provider.getFocusedChatTask = () => focusedTask
		provider.resolveStickyTaskTarget = () => focusedTask
		provider.getGlobalState = vi.fn().mockReturnValue([])
		provider.updateTaskHistory = vi.fn().mockResolvedValue(undefined)
		provider.providerSettingsManager = {
			getModeConfigId: vi.fn().mockResolvedValue(undefined),
			listConfig: vi.fn().mockResolvedValue([]),
		}
		provider.telemetry = { captureModeSwitch: vi.fn() }

		;(focusedTask as any).emit = vi.fn()

		await provider.handleModeSwitch("code" as any)

		// No taskHistory entry for the stack-top task was rewritten.
		const historyWrite = provider.updateTaskHistory.mock.calls?.[0]?.[0]
		expect(historyWrite?.id).not.toBe("task-stack-top")
	})

	it("switching modes on a pending new conversation touches no task at all", async () => {
		provider.pendingNewConversation = { id: "cv-new" }
		provider.resolveStickyTaskTarget = ClineProvider.prototype["resolveStickyTaskTarget"]
		// Force the pending branch through the real resolver.
		provider.resolveStickyTaskTarget = () => undefined

		const stackTopTask = { taskId: "task-stack-top", emit: vi.fn() }
		provider.clineStack = [stackTopTask]
		provider.getCurrentTask = () => stackTopTask
		provider.getGlobalState = vi.fn().mockReturnValue([])
		provider.updateTaskHistory = vi.fn().mockResolvedValue(undefined)
		provider.providerSettingsManager = {
			getModeConfigId: vi.fn().mockResolvedValue(undefined),
			listConfig: vi.fn().mockResolvedValue([]),
		}

		await provider.handleModeSwitch("code" as any)

		expect(provider.updateTaskHistory).not.toHaveBeenCalled()
		// Only the global mode selector follows: exactly the state.mode write.
		const stateWrites = provider.updateGlobalState.mock.calls.filter(([key]: [string]) => key === "mode")
		expect(stateWrites).toHaveLength(1)
		provider.pendingNewConversation = undefined
	})
})
