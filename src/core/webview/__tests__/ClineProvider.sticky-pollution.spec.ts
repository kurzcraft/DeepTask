// kilocode_change - new file
import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Sticky profile pollution guard (9.1.5):
 * a provider switched inside a brand-new (pending) conversation must not
 * overwrite the sticky profile/model memory of an older background
 * conversation, so switching back to that old conversation restores its
 * own provider instead of the one picked in the new chat.
 */

import { ClineProvider } from "../ClineProvider"

function makeTask(taskId: string, profileName: string | undefined, modelId: string | undefined) {
	return {
		taskId,
		apiConfiguration: modelId ? { apiProvider: "anthropic", anthropicModelId: modelId } : undefined,
		getTaskApiConfigName: vi.fn().mockResolvedValue(profileName),
		setTaskApiConfigName: vi.fn(),
		setTaskApiModelId: vi.fn(),
		taskApiModelId: modelId,
		updateApiConfiguration: vi.fn(),
	}
}

function makeProvider(options: {
	tasks: any[]
	pendingNewConversation?: unknown
	focusedConversationId?: string
	sessionForFocused?: string
	currentApiConfigName?: string
	currentModelId?: string
}) {
	const { tasks, pendingNewConversation, focusedConversationId, sessionForFocused } = options
	const provider: any = {
		clineStack: tasks,
		pendingNewConversation,
		getCurrentTask: vi.fn(() => tasks[tasks.length - 1]),
		getFocusedChatTask: vi.fn(() => {
			if (pendingNewConversation) return undefined
			if (!focusedConversationId) return tasks[tasks.length - 1]
			if (!sessionForFocused) return undefined
			return tasks.find((t) => t.taskId === sessionForFocused)
		}),
		parallelManager: focusedConversationId
			? { focusedConversationId, getConversationById: vi.fn(() => ({ sessionId: sessionForFocused })) }
			: undefined,
		getState: vi.fn().mockResolvedValue({
			currentApiConfigName: options.currentApiConfigName,
			apiConfiguration: options.currentModelId
				? { apiProvider: "anthropic", anthropicModelId: options.currentModelId }
				: undefined,
		}),
		getGlobalState: vi.fn().mockReturnValue([]),
		updateTaskHistory: vi.fn(),
		getProviderProfileEntry: vi.fn().mockImplementation((name: string) => ({ name })),
		providerSettingsManager: {
			getProfile: vi.fn().mockResolvedValue({ name: "p", apiProvider: "anthropic" }),
		},
		activateProviderProfile: vi.fn(),
		postStateToWebview: vi.fn(),
		postMessageToWebview: vi.fn(),
		log: vi.fn(),
	}
	Object.setPrototypeOf(provider, ClineProvider.prototype)
	return provider
}

describe("sticky profile pollution guard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does not persist a provider switch to the stack-top background task while a new conversation is pending", async () => {
		// Conversation A (background, stack top) remembers profile X / model-x.
		const taskA = makeTask("task-a", "profile-x", "model-x")
		// User opened a brand-new conversation (B) and picked provider Y there.
		const provider = makeProvider({
			tasks: [taskA],
			pendingNewConversation: { id: "cv-b", folderPath: "/repo", workspacePath: "/repo" },
			currentApiConfigName: "profile-y",
			currentModelId: "model-y",
		})

		await provider.persistStickyProviderProfileToCurrentTask("profile-y")

		// A's sticky memory must be untouched: no in-memory write, no history write.
		expect(taskA.setTaskApiConfigName).not.toHaveBeenCalled()
		expect(provider.updateTaskHistory).not.toHaveBeenCalled()
	})

	it("does not update the stack-top task's api handler during pending-conversation profile activation", async () => {
		const taskA = makeTask("task-a", "profile-x", "model-x")
		const provider = makeProvider({
			tasks: [taskA],
			pendingNewConversation: { id: "cv-b", folderPath: "/repo", workspacePath: "/repo" },
		})

		provider.updateTaskApiHandlerIfNeeded({ apiProvider: "anthropic", anthropicModelId: "model-y" })

		expect(taskA.updateApiConfiguration).not.toHaveBeenCalled()
	})

	it("skips activation-time sticky persistence when the switch was initiated for a pending conversation", async () => {
		const taskA = makeTask("task-a", "profile-x", "model-x")
		const provider = makeProvider({
			tasks: [taskA],
			pendingNewConversation: { id: "cv-b", folderPath: "/repo", workspacePath: "/repo" },
		})
		// Simulate the internal capture both before and after awaits resolving
		// to the same "no sticky target" conclusion.
		const entry = (provider as any).resolveStickyTaskTarget()
		expect(entry).toBeUndefined()
	})

	it("still persists to the focused task when no new conversation is pending", async () => {
		const taskA = makeTask("task-a", "profile-x", "model-x")
		const taskB = makeTask("task-b", "profile-y", "model-y")
		// Focus is on B; user switches B to profile Z.
		const provider = makeProvider({
			tasks: [taskA, taskB],
			focusedConversationId: "cv-b",
			sessionForFocused: "task-b",
			currentApiConfigName: "profile-z",
			currentModelId: "model-z",
		})
		provider.getGlobalState = vi.fn().mockReturnValue([{ id: "task-b", ts: 1 }])

		await provider.persistStickyProviderProfileToCurrentTask("profile-z")

		// B receives the new sticky memory; A untouched.
		expect(taskB.setTaskApiConfigName).toHaveBeenCalledWith("profile-z")
		expect(taskA.setTaskApiConfigName).not.toHaveBeenCalled()
	})
})
