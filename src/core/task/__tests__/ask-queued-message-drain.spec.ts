import { Task } from "../Task"

// Queue replay is intentionally disabled for webview chat sends. Stale queued
// text can belong to an old resend/edit state and must not steal the active ask.

describe("Task.ask queued message handling", () => {
	it("clears queued messages while blocked on followup ask without consuming them", async () => {
		const task = Object.create(Task.prototype) as Task
		;(task as any).abort = false
		;(task as any).clineMessages = []
		;(task as any).askResponse = undefined
		;(task as any).askResponseText = undefined
		;(task as any).askResponseImages = undefined
		;(task as any).lastMessageTs = undefined

		const { MessageQueueService } = await import("../../message-queue/MessageQueueService")
		;(task as any).messageQueueService = new MessageQueueService()
		;(task as any).addToClineMessages = vi.fn(async (message) => {
			;(task as any).clineMessages.push(message)
		})
		;(task as any).saveClineMessages = vi.fn(async () => {})
		;(task as any).updateClineMessage = vi.fn(async () => {})
		;(task as any).cancelAutoApprovalTimeout = vi.fn(() => {})
		;(task as any).checkpointSave = vi.fn(async () => {})
		;(task as any).emit = vi.fn()
		;(task as any).providerRef = { deref: () => undefined }

		const askPromise = task.ask("followup", "Q?", false)
		;(task as any).messageQueueService.addMessage("stale queued answer")

		await vi.waitFor(() => expect((task as any).messageQueueService.isEmpty()).toBe(true))
		task.handleWebviewAskResponse("messageResponse", "real answer")

		const result = await askPromise
		expect(result.response).toBe("messageResponse")
		expect(result.text).toBe("real answer")
	})
})
