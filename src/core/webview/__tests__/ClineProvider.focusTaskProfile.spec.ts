// Regression: focusing another conversation restores that conversation's own
// sticky provider profile instead of leaking the previous chat's model.

import { describe, expect, it, vi } from "vitest"

vi.mock("vscode", () => ({
	env: { sessionId: "window-1", uriScheme: "vscode", language: "en", appName: "Test", uiKind: 1 },
	commands: { executeCommand: vi.fn().mockResolvedValue(undefined) },
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue([]), update: vi.fn() }),
		onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
	},
	ExtensionMode: { Production: 1, Development: 2, Test: 3 },
	version: "1.85.0",
}))

import { ClineProvider } from "../ClineProvider"
import type { Task } from "../../task/Task"

const activateProviderProfile = vi.fn().mockResolvedValue(undefined)

function makeProvider(tasks: Array<Partial<Task> & { taskId: string }>): ClineProvider {
	const stack = tasks as Task[]
	const mock = {
		clineStack: stack,
		parallelManager: {
			conversationForSession: vi.fn(),
			setActiveConversation: vi.fn().mockResolvedValue(undefined),
			broadcast: vi.fn().mockResolvedValue(undefined),
		},
		getCurrentTask: vi.fn().mockReturnValue(stack[stack.length - 1]),
		getState: vi.fn().mockResolvedValue({ currentApiConfigName: "profile-a" }),
		getProviderProfileEntry: vi.fn().mockReturnValue({ name: "profile-b" }),
		activateProviderProfile,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		getTaskWithId: vi.fn(),
		createTaskWithHistoryItem: vi.fn(),
		log: vi.fn(),
	}
	// Borrow the real prototype so focusTask/restoreFocusedTaskProviderProfile
	// run as production code against the mock fields above.
	Object.setPrototypeOf(mock, ClineProvider.prototype)
	return mock as unknown as ClineProvider
}

describe("focusTask per-session provider profile isolation", () => {
	it("restores the focused conversation's sticky provider profile", async () => {
		const taskA = { taskId: "task-a", getTaskApiConfigName: vi.fn().mockResolvedValue("profile-a") }
		const taskB = { taskId: "task-b", getTaskApiConfigName: vi.fn().mockResolvedValue("profile-b") }
		const provider = makeProvider([taskA, taskB])

		await ClineProvider.prototype.focusTask.call(provider, "task-b")

		expect(activateProviderProfile).toHaveBeenCalledWith(
			{ name: "profile-b" },
			{ persistModeConfig: false, persistTaskHistory: false },
		)
	})

	it("keeps the current profile when the focused task saved the same one", async () => {
		activateProviderProfile.mockClear()
		const taskA = { taskId: "task-a", getTaskApiConfigName: vi.fn().mockResolvedValue("profile-a") }
		const provider = makeProvider([taskA])

		await ClineProvider.prototype.focusTask.call(provider, "task-a")

		expect(activateProviderProfile).not.toHaveBeenCalled()
	})

	it("does not activate anything when the focused task has no saved profile", async () => {
		activateProviderProfile.mockClear()
		const taskC = { taskId: "task-c", getTaskApiConfigName: vi.fn().mockResolvedValue(undefined) }
		const provider = makeProvider([taskC])

		await ClineProvider.prototype.focusTask.call(provider, "task-c")

		expect(activateProviderProfile).not.toHaveBeenCalled()
	})
})
