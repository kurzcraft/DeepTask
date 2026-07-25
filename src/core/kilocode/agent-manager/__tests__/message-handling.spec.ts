import { describe, it, expect, vi } from "vitest"

/**
 * Test suite for Agent Manager message handling.
 * User input is preemptive and must not wait behind a local queue or sending lock.
 */

describe("AgentManagerProvider message handling", () => {
	describe("removed queue/status orchestration", () => {
		it("sends repeated user input immediately through the force-send path", async () => {
			const forceSend = vi.fn(async (_sessionId: string, _content: string) => {})

			await forceSend("session1", "first")
			await forceSend("session1", "second")

			expect(forceSend).toHaveBeenNthCalledWith(1, "session1", "first")
			expect(forceSend).toHaveBeenNthCalledWith(2, "session1", "second")
		})

		it("does not require messageStatus updates to unlock later sends", async () => {
			const sent: string[] = []
			const sendMessage = vi.fn(async (_sessionId: string, content: string) => {
				sent.push(content)
			})

			await sendMessage("session1", "paused follow-up")
			await sendMessage("session1", "another follow-up")

			expect(sent).toEqual(["paused follow-up", "another follow-up"])
		})
	})
})
