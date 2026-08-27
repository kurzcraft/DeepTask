// kilocode_change - new file
import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Per-session provider profile stickiness:
 * switching a conversation re-activates that conversation's saved profile.
 */

type MockTask = {
	taskId: string
	getTaskApiConfigName: ReturnType<typeof vi.fn>
}

function makeProvider(tasks: MockTask[], currentApiConfigName: string) {
	const provider: any = {
		clineStack: tasks,
		getCurrentTask: vi.fn(() => tasks[tasks.length - 1]),
		getState: vi.fn().mockResolvedValue({ currentApiConfigName }),
		getProviderProfileEntry: vi.fn().mockImplementation((name: string) => ({ name })),
		activateProviderProfile: vi.fn(),
		postStateToWebview: vi.fn(),
		postMessageToWebview: vi.fn(),
		parallelManager: {
			conversationForSession: vi.fn(),
			setActiveConversation: vi.fn(),
			broadcast: vi.fn(),
		},
		log: vi.fn(),
	}
	// Borrow the real prototype so focusTask and the sticky restoration run
	// as production code against the mock fields above.
	Object.setPrototypeOf(provider, ClineProvider.prototype)
	return provider
}

import { ClineProvider } from "../ClineProvider"

describe("per-session provider profile stickiness", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("re-activates the focused conversation's saved profile on focusTask", async () => {
		const taskA = { taskId: "task-a", getTaskApiConfigName: vi.fn().mockResolvedValue("profile-a") }
		const taskB = { taskId: "task-b", getTaskApiConfigName: vi.fn().mockResolvedValue("profile-b") }
		const provider = makeProvider([taskA, taskB], "profile-b")

		await provider.focusTask("task-a")

		// taskA is now the current (stack top) task and its profile is restored.
		expect(provider.getCurrentTask()).toBe(taskA)
		expect(provider.activateProviderProfile).toHaveBeenCalledWith(
			{ name: "profile-a" },
			{ persistModeConfig: false, persistTaskHistory: false },
		)
	})

	it("keeps the current profile when the focused task has none saved", async () => {
		const taskC = { taskId: "task-c", getTaskApiConfigName: vi.fn().mockResolvedValue(undefined) }
		const provider = makeProvider([taskC], "default")

		await provider.focusTask("task-c")

		expect(provider.activateProviderProfile).not.toHaveBeenCalled()
	})

	it("does not re-activate when the saved profile already is the active one", async () => {
		const taskA = { taskId: "task-a", getTaskApiConfigName: vi.fn().mockResolvedValue("same-profile") }
		const provider = makeProvider([taskA], "same-profile")

		await provider.focusTask("task-a")

		expect(provider.activateProviderProfile).not.toHaveBeenCalled()
	})
})
