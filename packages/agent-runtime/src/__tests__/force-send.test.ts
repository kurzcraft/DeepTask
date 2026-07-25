import { describe, expect, it, vi } from "vitest"
import { forceSendWebviewMessage, hasPendingAsk } from "../force-send.js"
import type { ExtensionState, WebviewMessage } from "../types/index.js"

type ForceSendAgent = Parameters<typeof forceSendWebviewMessage>[0]

const stateWithMessages = (chatMessages: unknown[]): ExtensionState =>
	({
		version: "test",
		apiConfiguration: {},
		chatMessages,
		mode: "code",
	} as unknown as ExtensionState)

describe("forceSendWebviewMessage", () => {
	it("sends directly when the task is already paused on a pending ask", async () => {
		const payload: WebviewMessage = { type: "askResponse", askResponse: "messageResponse", text: "continue" }
		const sendWebviewMessage = vi.fn(async () => {})
		const agent: ForceSendAgent = {
			getState: () => stateWithMessages([{ type: "ask", ask: "resume_task", ts: 1, partial: false, isAnswered: false }]),
			sendWebviewMessage,
		}

		await forceSendWebviewMessage(agent, payload)

		expect(sendWebviewMessage).toHaveBeenCalledTimes(1)
		expect(sendWebviewMessage).toHaveBeenCalledWith(payload)
	})

	it("cancels busy tasks, waits for a pending ask, then sends the payload", async () => {
		const payload: WebviewMessage = { type: "askResponse", askResponse: "messageResponse", text: "interrupt" }
		const states = [
			stateWithMessages([{ type: "say", say: "api_req_started", ts: 1 }]),
			stateWithMessages([{ type: "ask", ask: "resume_task", ts: 2, partial: false, isAnswered: false }]),
		]
		const sendWebviewMessage = vi.fn(async () => {})
		const agent: ForceSendAgent = {
			getState: vi.fn(() => states.shift() ?? stateWithMessages([])),
			sendWebviewMessage,
		}

		await forceSendWebviewMessage(agent, payload)

		expect(sendWebviewMessage).toHaveBeenNthCalledWith(1, { type: "cancelTask" })
		expect(sendWebviewMessage).toHaveBeenNthCalledWith(2, payload)
	})
})

describe("hasPendingAsk", () => {
	it("ignores partial and answered asks", () => {
		expect(
			hasPendingAsk(stateWithMessages([{ type: "ask", ask: "followup", ts: 1, partial: true, isAnswered: false }])),
		).toBe(false)
		expect(
			hasPendingAsk(stateWithMessages([{ type: "ask", ask: "followup", ts: 2, partial: false, isAnswered: true }])),
		).toBe(false)
	})
})
