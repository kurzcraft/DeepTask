import type { ClineMessage } from "@roo-code/types"
import { consolidateMessagesForTimeline } from "../consolidateMessagesForTimeline"

function createMessage(id: string): ClineMessage {
	return {
		ts: Date.now(),
		type: "say",
		say: "text",
		text: `Message ${id}`,
	}
}

describe("consolidateMessagesForTimeline", () => {
	it("processes messages correctly", () => {
		const messages = [createMessage("1"), createMessage("2"), createMessage("3")]
		const result = consolidateMessagesForTimeline(messages)

		expect(result.processedMessages).toHaveLength(2) // First message is skipped
		expect(result.messageToOriginalIndex).toBeInstanceOf(Map)
		expect(result.messageToOriginalIndex.size).toBe(2)
	})

	it("returns empty arrays for single message", () => {
		const messages = [createMessage("1")]
		const result = consolidateMessagesForTimeline(messages)

		expect(result.processedMessages).toHaveLength(0)
		expect(result.messageToOriginalIndex.size).toBe(0)
	})

	it("maps messages to correct original indices", () => {
		const messages = [createMessage("1"), createMessage("2"), createMessage("3")]
		const result = consolidateMessagesForTimeline(messages)

		// First message (index 0) is skipped, so we should have mappings for indices 1 and 2
		const indices = Array.from(result.messageToOriginalIndex.values())
		expect(indices).toContain(1)
		expect(indices).toContain(2)
		expect(indices).not.toContain(0)
	})

	it("handles grouped messages correctly", () => {
		const groupedMessages = [createMessage("1"), [createMessage("2a"), createMessage("2b")], createMessage("3")]
		const result = consolidateMessagesForTimeline(groupedMessages)

		expect(result.processedMessages.length).toBeGreaterThan(0)
		expect(result.messageToOriginalIndex.size).toBeGreaterThan(0)
	})

	it("skips secondary combining when command output is already folded", () => {
		const task = createMessage("task")
		const command: ClineMessage = {
			ts: 2,
			type: "ask",
			ask: "command",
			text: "ls\nOutput:\nfile.txt",
		}
		const text = createMessage("text")
		const result = consolidateMessagesForTimeline([task, command, text])

		expect(result.processedMessages).toHaveLength(2)
		expect(result.processedMessages[0]).toBe(command)
		expect(result.processedMessages[1]).toBe(text)
		expect(result.messageToOriginalIndex.get(command)).toBe(1)
		expect(result.messageToOriginalIndex.get(text)).toBe(2)
	})

	it("still combines independent command_output rows into the command", () => {
		const task = createMessage("task")
		const command: ClineMessage = {
			ts: 2,
			type: "ask",
			ask: "command",
			text: "ls",
		}
		const output: ClineMessage = {
			ts: 3,
			type: "say",
			say: "command_output",
			text: "file.txt",
		}
		const result = consolidateMessagesForTimeline([task, command, output])

		expect(result.processedMessages).toHaveLength(1)
		expect(result.processedMessages[0]).not.toBe(command)
		expect(result.processedMessages[0].ask).toBe("command")
		expect(result.processedMessages[0].text).toContain("ls")
		expect(result.processedMessages[0].text).toContain("file.txt")
		expect(result.messageToOriginalIndex.get(result.processedMessages[0])).toBe(1)
	})

	it("still combines independent api_req_finished rows before filtering", () => {
		const task = createMessage("task")
		const started: ClineMessage = {
			ts: 2,
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ request: "hello", tokensIn: 0, tokensOut: 0 }),
		}
		const finished: ClineMessage = {
			ts: 3,
			type: "say",
			say: "api_req_finished",
			text: JSON.stringify({ tokensIn: 11, tokensOut: 7, cost: 0.02 }),
		}
		const text = createMessage("text")
		const result = consolidateMessagesForTimeline([task, started, finished, text])

		expect(result.processedMessages).toHaveLength(1)
		expect(result.processedMessages[0]).toBe(text)
		expect(result.messageToOriginalIndex.get(text)).toBe(3)
	})
})
