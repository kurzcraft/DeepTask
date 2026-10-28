// kilocode_change - new file
import { RuntimeProcessHandler } from "../RuntimeProcessHandler"
import type { RuntimeProcessHandlerCallbacks } from "../RuntimeProcessHandler"
import type { AgentRegistry } from "../AgentRegistry"

describe("RuntimeProcessHandler full-state compatibility", () => {
	function fixture() {
		const callbacks = { onLog: vi.fn(), onChatMessages: vi.fn(), onModeChanged: vi.fn() }
		const handler = new RuntimeProcessHandler(
			{} as AgentRegistry,
			callbacks as unknown as RuntimeProcessHandlerCallbacks,
		)
		const internal = handler as any
		const proc = {}
		internal.activeSessions.set("s", { process: proc, sessionId: "s" })
		const event = vi.fn()
		const send = vi.spyOn(handler, "sendMessage").mockResolvedValue(undefined)
		return { internal, proc, callbacks, event, send }
	}
	it.each(["chatMessages", "clineMessages"])("delivers empty %s states without a synthetic start", (key) => {
		const { internal, proc, callbacks, event } = fixture()
		internal.handleExtensionMessage(proc, { type: "state", state: { [key]: [] } }, event)
		expect(callbacks.onChatMessages).toHaveBeenCalledExactlyOnceWith("s", [])
		expect(event).not.toHaveBeenCalled()
	})
	it.each(["chatMessages", "clineMessages"])("preserves mode changes, first output and resume with %s", (key) => {
		const { internal, proc, callbacks, event, send } = fixture()
		internal.sessionModes.set("s", "code")
		internal.pendingResumeContinuation.set("s", { prompt: "keep all input", images: ["image"] })
		const text = { ts: 1, type: "say", say: "text", text: "complete text" }
		const control = { ts: 2, type: "ask", ask: "completion_result" }
		const resume = { ts: 3, type: "ask", ask: "resume_task" }
		const state = { mode: "architect", [key]: [text, control, resume] }
		internal.handleExtensionMessage(proc, { type: "state", state }, event)
		expect(callbacks.onChatMessages).toHaveBeenCalledExactlyOnceWith("s", [text, resume])
		expect(callbacks.onModeChanged).toHaveBeenCalledExactlyOnceWith("s", "architect", "code")
		expect(event).toHaveBeenCalledTimes(1)
		expect(event.mock.calls[0][1].payload.say).toBe("api_req_started")
		expect(send).toHaveBeenCalledExactlyOnceWith("s", {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "keep all input",
			images: ["image"],
		})
		internal.handleExtensionMessage(proc, { type: "state", state }, event)
		expect(send).toHaveBeenCalledTimes(1)
		expect(event).toHaveBeenCalledTimes(1)
	})
	it("still accepts independent legacy stateChange and incremental messages", () => {
		const { internal, proc, callbacks, event } = fixture()
		const text = { ts: 1, type: "say", say: "text", text: "whole text" }
		internal.handleStateChange(proc, { clineMessages: [text] }, event)
		internal.handleExtensionMessage(proc, { type: "messageUpdated", chatMessage: text }, event)
		expect(callbacks.onChatMessages).toHaveBeenCalledTimes(2)
		expect(callbacks.onChatMessages).toHaveBeenLastCalledWith("s", [text])
	})
})
