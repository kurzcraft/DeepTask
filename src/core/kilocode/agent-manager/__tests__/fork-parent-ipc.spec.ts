// kilocode_change - new file
import { createForkParentIpcForwarder } from "../../../../../packages/agent-runtime/src/fork-parent-ipc"
import type { ExtensionMessage, ExtensionState } from "../../../../../packages/agent-runtime/src/types/index"

const makeState = () =>
	({ clineMessages: [{ ts: 1, type: "say", say: "text", text: "complete history" }] }) as unknown as ExtensionState

describe("fork parent state forwarding", () => {
	it("sends one complete payload for each paired service emission", () => {
		const send = vi.fn()
		const forwarder = createForkParentIpcForwarder(send)
		const state = makeState()
		for (let i = 0; i < 1000; i++) {
			forwarder.forwardMessage({ type: "state", state } as ExtensionMessage)
			forwarder.forwardStateChange(state)
		}
		expect(send).toHaveBeenCalledTimes(1000)
		expect(send).toHaveBeenLastCalledWith({ type: "message", payload: { type: "state", state } })
	})
	it("consumes the paired marker so later same-object events still arrive", () => {
		const send = vi.fn()
		const f = createForkParentIpcForwarder(send)
		const state = makeState()
		f.forwardMessage({ type: "state", state } as ExtensionMessage)
		f.forwardStateChange(state)
		f.forwardStateChange(state)
		expect(send).toHaveBeenCalledTimes(2)
		expect(send).toHaveBeenLastCalledWith({ type: "stateChange", state })
	})
	it("expires an unmatched marker before later independent events", async () => {
		const send = vi.fn()
		const f = createForkParentIpcForwarder(send)
		const state = makeState()
		f.forwardMessage({ type: "state", state } as ExtensionMessage)
		await Promise.resolve()
		f.forwardStateChange(state)
		expect(send).toHaveBeenCalledTimes(2)
	})
	it("forwards independent states and all incremental events unchanged", () => {
		const send = vi.fn()
		const f = createForkParentIpcForwarder(send)
		const a = makeState()
		const b = makeState()
		f.forwardMessage({ type: "state", state: a } as ExtensionMessage)
		f.forwardStateChange(b)
		const delta = { type: "messageUpdated", chatMessage: { ts: 2, text: "all text" } } as ExtensionMessage
		f.forwardMessage(delta)
		f.forwardStateChange(a)
		expect(send).toHaveBeenCalledTimes(4)
		expect(send).toHaveBeenNthCalledWith(3, { type: "message", payload: delta })
	})
})
