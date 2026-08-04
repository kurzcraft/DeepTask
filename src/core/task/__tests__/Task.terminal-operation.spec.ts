import { Task } from "../Task"

describe("Task.handleTerminalOperation", () => {
	function createTaskWithTerminalProcess() {
		const task = Object.create(Task.prototype) as Task
		;(task as any).askResponse = undefined
		;(task as any).askResponseText = undefined
		;(task as any).askResponseImages = undefined
		;(task as any).lastMessageTs = undefined
		;(task as any).clineMessages = []
		;(task as any).providerRef = {
			deref: () => undefined,
		}
		;(task as any).cloudSyncedMessageTimestamps = new Set<number>()
		;(task as any).pendingCommandOutputFeedback = undefined
		;(task as any).commandOutputFeedbackAlreadyShown = false
		;(task as any).cancelAutoApprovalTimeout = vi.fn()
		;(task as any).clearStaleWebviewAskResponse = Task.prototype.clearStaleWebviewAskResponse
		;(task as any).getPendingWebviewAskTs = Task.prototype.getPendingWebviewAskTs
		;(task as any).findMessageByTimestamp = (ts: number) =>
			(task as any).clineMessages.find((message: { ts?: number }) => message.ts === ts)
		;(task as any).handleWebviewAskResponse = vi.fn(Task.prototype.handleWebviewAskResponse.bind(task))
		;(task as any).say = vi.fn(async () => {})
		;(task as any).checkpointSave = vi.fn(async () => {})
		;(task as any).terminalProcess = {
			continue: vi.fn(),
			abort: vi.fn(),
		}

		return task
	}

	it("wakes a stale continue click without storing an orphaned ask response", async () => {
		const task = createTaskWithTerminalProcess()

		await task.handleTerminalOperation("continue")

		expect((task as any).handleWebviewAskResponse).not.toHaveBeenCalled()
		expect((task as any).askResponse).toBeUndefined()
		expect(task.terminalProcess?.continue).toHaveBeenCalledTimes(1)
	})

	it("feeds continue feedback only when the current ask is command_output", async () => {
		const task = createTaskWithTerminalProcess()
		;(task as any).lastMessageTs = 100
		;(task as any).pendingWebviewAskTs = 100
		;(task as any).clineMessages = [{ ts: 100, type: "ask", ask: "command_output", partial: false }]

		await task.handleTerminalOperation("continue", "keep going")

		expect((task as any).handleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "keep going", undefined)
		expect((task as any).pendingCommandOutputFeedback).toEqual({ text: "keep going", images: undefined })
		expect(task.terminalProcess?.continue).toHaveBeenCalledTimes(1)
	})

	it("still parks typed feedback for the tool result after command_output ask already settled", async () => {
		const task = createTaskWithTerminalProcess()
		// Auto-continue may settle the ask before the user types mid-command feedback.
		;(task as any).pendingWebviewAskTs = undefined
		;(task as any).clineMessages = [{ ts: 100, type: "ask", ask: "command_output", partial: false, isAnswered: true }]

		await task.handleTerminalOperation("continue", "real mid-command instruction")

		expect((task as any).handleWebviewAskResponse).not.toHaveBeenCalled()
		expect((task as any).pendingCommandOutputFeedback).toEqual({
			text: "real mid-command instruction",
			images: undefined,
		})
		expect((task as any).say).toHaveBeenCalledWith(
			"user_feedback",
			"real mid-command instruction",
			undefined,
		)
		expect(task.terminalProcess?.continue).toHaveBeenCalledTimes(1)
	})

	it("aborts a stale command output click without storing an orphaned ask response", async () => {
		const task = createTaskWithTerminalProcess()

		await task.handleTerminalOperation("abort")

		expect((task as any).handleWebviewAskResponse).not.toHaveBeenCalled()
		expect((task as any).askResponse).toBeUndefined()
		expect(task.terminalProcess?.abort).toHaveBeenCalledTimes(1)
		expect(task.terminalProcess?.continue).toHaveBeenCalledTimes(1)
	})
})
