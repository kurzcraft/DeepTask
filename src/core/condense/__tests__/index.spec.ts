// npx vitest core/condense/__tests__/index.spec.ts

import type { Mock } from "vitest"

import { Anthropic } from "@anthropic-ai/sdk"
import { TelemetryService } from "@roo-code/telemetry"

import { ApiHandler } from "../../../api"
import { ApiMessage } from "../../task-persistence/apiMessages"
import { maybeRemoveImageBlocks } from "../../../api/transform/image-cleaning"
import {
	summarizeConversation,
	buildLocalFallbackSummary,
	getMessagesSinceLastSummary,
	getKeepMessagesWithToolBlocks,
	getEffectiveApiHistory,
	cleanupAfterTruncation,
	sanitizeNativeToolHistory,
	N_MESSAGES_TO_KEEP,
} from "../index"

vi.mock("../../../api/transform/image-cleaning", () => ({
	maybeRemoveImageBlocks: vi.fn((messages: ApiMessage[], _apiHandler: ApiHandler) => [...messages]),
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureContextCondensed: vi.fn(),
		},
	},
}))

const taskId = "test-task-id"
const DEFAULT_PREV_CONTEXT_TOKENS = 1000

describe("buildLocalFallbackSummary", () => {
	it("preserves the initial task and newest user extension within a strict budget", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Initial task: repair context compression", ts: 1 },
			...Array.from({ length: 120 }, (_, index) => ({
				role: (index % 2 === 0 ? "assistant" : "user") as "assistant" | "user",
				content: `${index % 2 === 0 ? "Work evidence" : "Intermediate request"} ${index} ${"x".repeat(1000)}`,
				ts: index + 2,
			})),
			{ role: "user", content: "Newest acceptance target: never truncate when provider fails", ts: 999 },
		]

		const startedAt = performance.now()
		const summary = buildLocalFallbackSummary(messages, "relay timed out")

		expect(performance.now() - startedAt).toBeLessThan(100)
		expect(summary.length).toBeLessThanOrEqual(12_000)
		expect(summary).toContain("Initial task: repair context compression")
		expect(summary).toContain("Newest acceptance target: never truncate when provider fails")
		expect(summary).toContain("relay timed out")
	})

	it("removes environment details and omits reasoning blocks", () => {
		const summary = buildLocalFallbackSummary(
			[
				{ role: "user", content: "Task", ts: 1 },
				{
					role: "assistant",
					content: [
						{ type: "reasoning", text: "private chain of thought" } as any,
						{
							type: "text",
							text: "Visible result\n<environment_details>huge private state</environment_details>",
						},
					],
					ts: 2,
				},
			],
			"empty response",
		)

		expect(summary).toContain("Visible result")
		expect(summary).not.toContain("private chain of thought")
		expect(summary).not.toContain("huge private state")
	})
})

describe("sanitizeNativeToolHistory", () => {
	it("should remove assistant tool_use messages that have no matching following tool_result", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Start", ts: 1 },
			{
				role: "assistant",
				content: [
					{ type: "text" as const, text: "I'll inspect that." },
					{ type: "tool_use" as const, id: "toolu_orphan", name: "read_file", input: { path: "a.ts" } },
				],
				ts: 2,
			},
			{ role: "user", content: "Continue without the result", ts: 3 },
		]

		const result = sanitizeNativeToolHistory(messages)

		expect(result).toEqual([
			{ role: "user", content: "Start", ts: 1 },
			{ role: "user", content: "Continue without the result", ts: 3 },
		])
	})

	it("should remove orphan tool_result messages without a preceding matching tool_use", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Start", ts: 1 },
			{ role: "assistant", content: "No tools here", ts: 2 },
			{
				role: "user",
				content: [{ type: "tool_result" as const, tool_use_id: "missing", content: "result" }],
				ts: 3,
			},
		]

		const result = sanitizeNativeToolHistory(messages)

		expect(result).toEqual([
			{ role: "user", content: "Start", ts: 1 },
			{ role: "assistant", content: "No tools here", ts: 2 },
		])
	})

	it("should remove orphan results while preserving valid results and user text in a mixed turn", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Start", ts: 1 },
			{
				role: "assistant",
				content: [{ type: "tool_use" as const, id: "valid", name: "read_file", input: {} }],
				ts: 2,
			},
			{
				role: "user",
				content: [
					{ type: "tool_result" as const, tool_use_id: "valid", content: "ok" },
					{ type: "tool_result" as const, tool_use_id: "orphan", content: "must not leak" },
					{ type: "text" as const, text: "Continue" },
				],
				ts: 3,
			},
		]

		expect(sanitizeNativeToolHistory(messages)).toEqual([
			{ role: "user", content: "Start", ts: 1 },
			{ role: "assistant", content: [{ type: "tool_use", id: "valid", name: "read_file", input: {} }], ts: 2 },
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "valid", content: "ok" },
					{ type: "text", text: "Continue" },
				],
				ts: 3,
			},
		])
	})
})

describe("getKeepMessagesWithToolBlocks", () => {
	it("should return keepMessages without tool blocks when no tool_result blocks in first kept message", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toHaveLength(3)
		expect(result.toolUseBlocksToPreserve).toHaveLength(0)
	})

	it("should return all messages when messages.length <= keepCount", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toEqual(messages)
		expect(result.toolUseBlocksToPreserve).toHaveLength(0)
	})

	it("should preserve tool_use blocks when first kept message has tool_result blocks", () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_123",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_123",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me read that file", ts: 2 },
			{ role: "user", content: "Please continue", ts: 3 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Reading file..." }, toolUseBlock],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Continue" }],
				ts: 5,
			},
			{ role: "assistant", content: "Got it, the file says...", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		// keepMessages should be the last 3 messages
		expect(result.keepMessages).toHaveLength(3)
		expect(result.keepMessages[0].ts).toBe(5)
		expect(result.keepMessages[1].ts).toBe(6)
		expect(result.keepMessages[2].ts).toBe(7)

		// Should preserve the tool_use block from the preceding assistant message
		expect(result.toolUseBlocksToPreserve).toHaveLength(1)
		expect(result.toolUseBlocksToPreserve[0]).toEqual(toolUseBlock)
	})

	it("should not preserve tool_use blocks when first kept message is assistant role", () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_123",
			name: "read_file",
			input: { path: "test.txt" },
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "Please read", ts: 3 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Reading..." }, toolUseBlock],
				ts: 4,
			},
			{ role: "user", content: "Continue", ts: 5 },
			{ role: "assistant", content: "Done", ts: 6 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		// First kept message is assistant, not user with tool_result
		expect(result.keepMessages).toHaveLength(3)
		expect(result.keepMessages[0].role).toBe("assistant")
		expect(result.toolUseBlocksToPreserve).toHaveLength(0)
	})

	it("should not preserve tool_use blocks when first kept user message has string content", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "Good", ts: 4 },
			{ role: "user", content: "Simple text message", ts: 5 }, // String content, not array
			{ role: "assistant", content: "Response", ts: 6 },
			{ role: "user", content: "More text", ts: 7 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toHaveLength(3)
		expect(result.toolUseBlocksToPreserve).toHaveLength(0)
	})

	it("should handle multiple tool_use blocks that need to be preserved", () => {
		const toolUseBlock1 = {
			type: "tool_use" as const,
			id: "toolu_123",
			name: "read_file",
			input: { path: "file1.txt" },
		}
		const toolUseBlock2 = {
			type: "tool_use" as const,
			id: "toolu_456",
			name: "read_file",
			input: { path: "file2.txt" },
		}
		const toolResultBlock1 = {
			type: "tool_result" as const,
			tool_use_id: "toolu_123",
			content: "contents 1",
		}
		const toolResultBlock2 = {
			type: "tool_result" as const,
			tool_use_id: "toolu_456",
			content: "contents 2",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Reading files..." }, toolUseBlock1, toolUseBlock2],
				ts: 2,
			},
			{
				role: "user",
				content: [toolResultBlock1, toolResultBlock2],
				ts: 3,
			},
			{ role: "assistant", content: "Got both files", ts: 4 },
			{ role: "user", content: "Thanks", ts: 5 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		// Should preserve both tool_use blocks
		expect(result.toolUseBlocksToPreserve).toHaveLength(2)
		expect(result.toolUseBlocksToPreserve).toContainEqual(toolUseBlock1)
		expect(result.toolUseBlocksToPreserve).toContainEqual(toolUseBlock2)
	})

	it("should not preserve tool_use blocks when preceding message has no tool_use blocks", () => {
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_123",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Plain text response", ts: 2 }, // No tool_use blocks
			{
				role: "user",
				content: [toolResultBlock], // Has tool_result but preceding message has no tool_use
				ts: 3,
			},
			{ role: "assistant", content: "Response", ts: 4 },
			{ role: "user", content: "Thanks", ts: 5 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toHaveLength(3)
		expect(result.toolUseBlocksToPreserve).toHaveLength(0)
	})

	it("should handle edge case when startIndex - 1 is negative", () => {
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_123",
			content: "file contents",
		}

		// Only 3 messages total, so startIndex = 0 and precedingIndex would be -1
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [toolResultBlock],
				ts: 1,
			},
			{ role: "assistant", content: "Response", ts: 2 },
			{ role: "user", content: "Thanks", ts: 3 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.keepMessages).toEqual(messages)
		expect(result.toolUseBlocksToPreserve).toHaveLength(0)
	})

	it("should preserve reasoning blocks alongside tool_use blocks for DeepSeek/Z.ai interleaved thinking", () => {
		const reasoningBlock = {
			type: "reasoning" as const,
			text: "Let me think about this step by step...",
		}
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_deepseek_123",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_deepseek_123",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{ role: "user", content: "Please read the file", ts: 3 },
			{
				role: "assistant",
				// DeepSeek stores reasoning as content blocks alongside tool_use
				content: [reasoningBlock as any, { type: "text" as const, text: "Reading file..." }, toolUseBlock],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Continue" }],
				ts: 5,
			},
			{ role: "assistant", content: "Got it, the file says...", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		// keepMessages should be the last 3 messages
		expect(result.keepMessages).toHaveLength(3)
		expect(result.keepMessages[0].ts).toBe(5)

		// Should preserve the tool_use block
		expect(result.toolUseBlocksToPreserve).toHaveLength(1)
		expect(result.toolUseBlocksToPreserve[0]).toEqual(toolUseBlock)

		// Should preserve the reasoning block for DeepSeek/Z.ai interleaved thinking
		expect(result.reasoningBlocksToPreserve).toHaveLength(1)
		expect((result.reasoningBlocksToPreserve[0] as any).type).toBe("reasoning")
		expect((result.reasoningBlocksToPreserve[0] as any).text).toBe("Let me think about this step by step...")
	})

	it("should return empty reasoningBlocksToPreserve when no reasoning blocks present", () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_123",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_123",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{
				role: "assistant",
				// No reasoning block, just text and tool_use
				content: [{ type: "text" as const, text: "Reading file..." }, toolUseBlock],
				ts: 2,
			},
			{
				role: "user",
				content: [toolResultBlock],
				ts: 3,
			},
			{ role: "assistant", content: "Done", ts: 4 },
			{ role: "user", content: "Thanks", ts: 5 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		expect(result.toolUseBlocksToPreserve).toHaveLength(1)
		expect(result.reasoningBlocksToPreserve).toHaveLength(0)
	})

	it("should preserve tool_use when tool_result is in 2nd kept message and tool_use is 2 messages before boundary", () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_second_kept",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_second_kept",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Reading file..." }, toolUseBlock],
				ts: 3,
			},
			{ role: "user", content: "Some other message", ts: 4 },
			{ role: "assistant", content: "First kept message", ts: 5 },
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Continue" }],
				ts: 6,
			},
			{ role: "assistant", content: "Third kept message", ts: 7 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		// keepMessages should be the last 3 messages (ts: 5, 6, 7)
		expect(result.keepMessages).toHaveLength(3)
		expect(result.keepMessages[0].ts).toBe(5)
		expect(result.keepMessages[1].ts).toBe(6)
		expect(result.keepMessages[2].ts).toBe(7)

		// Should preserve the tool_use block from message at ts:3 (2 messages before boundary)
		expect(result.toolUseBlocksToPreserve).toHaveLength(1)
		expect(result.toolUseBlocksToPreserve[0]).toEqual(toolUseBlock)
	})

	it("should preserve tool_use when tool_result is in 3rd kept message and tool_use is at boundary edge", () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_third_kept",
			name: "search",
			input: { query: "test" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_third_kept",
			content: "search results",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Start", ts: 1 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Searching..." }, toolUseBlock],
				ts: 2,
			},
			{ role: "user", content: "First kept message", ts: 3 },
			{ role: "assistant", content: "Second kept message", ts: 4 },
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Done" }],
				ts: 5,
			},
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		// keepMessages should be the last 3 messages (ts: 3, 4, 5)
		expect(result.keepMessages).toHaveLength(3)
		expect(result.keepMessages[0].ts).toBe(3)
		expect(result.keepMessages[1].ts).toBe(4)
		expect(result.keepMessages[2].ts).toBe(5)

		// Should preserve the tool_use block from message at ts:2 (at the search boundary edge)
		expect(result.toolUseBlocksToPreserve).toHaveLength(1)
		expect(result.toolUseBlocksToPreserve[0]).toEqual(toolUseBlock)
	})

	it("should preserve multiple tool_uses when tool_results are in different kept messages", () => {
		const toolUseBlock1 = {
			type: "tool_use" as const,
			id: "toolu_multi_1",
			name: "read_file",
			input: { path: "file1.txt" },
		}
		const toolUseBlock2 = {
			type: "tool_use" as const,
			id: "toolu_multi_2",
			name: "read_file",
			input: { path: "file2.txt" },
		}
		const toolResultBlock1 = {
			type: "tool_result" as const,
			tool_use_id: "toolu_multi_1",
			content: "contents 1",
		}
		const toolResultBlock2 = {
			type: "tool_result" as const,
			tool_use_id: "toolu_multi_2",
			content: "contents 2",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Start", ts: 1 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Reading file 1..." }, toolUseBlock1],
				ts: 2,
			},
			{ role: "user", content: "Some message", ts: 3 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Reading file 2..." }, toolUseBlock2],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock1, { type: "text" as const, text: "First result" }],
				ts: 5,
			},
			{
				role: "user",
				content: [toolResultBlock2, { type: "text" as const, text: "Second result" }],
				ts: 6,
			},
			{ role: "assistant", content: "Got both files", ts: 7 },
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		// keepMessages should be the last 3 messages (ts: 5, 6, 7)
		expect(result.keepMessages).toHaveLength(3)

		// Should preserve both tool_use blocks
		expect(result.toolUseBlocksToPreserve).toHaveLength(2)
		expect(result.toolUseBlocksToPreserve).toContainEqual(toolUseBlock1)
		expect(result.toolUseBlocksToPreserve).toContainEqual(toolUseBlock2)
	})

	it("should not crash when tool_result references tool_use beyond search boundary", () => {
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_beyond_boundary",
			content: "result",
		}

		// Tool_use is at ts:1, but with N_MESSAGES_TO_KEEP=3, we only search back 3 messages
		// from startIndex-1. StartIndex is 7 (messages.length=10, keepCount=3, startIndex=7).
		// So we search from index 6 down to index 4 (7-1 down to 7-3).
		// The tool_use at index 0 (ts:1) is beyond the search boundary.
		const messages: ApiMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "text" as const, text: "Way back..." },
					{
						type: "tool_use" as const,
						id: "toolu_beyond_boundary",
						name: "old_tool",
						input: {},
					},
				],
				ts: 1,
			},
			{ role: "user", content: "Message 2", ts: 2 },
			{ role: "assistant", content: "Message 3", ts: 3 },
			{ role: "user", content: "Message 4", ts: 4 },
			{ role: "assistant", content: "Message 5", ts: 5 },
			{ role: "user", content: "Message 6", ts: 6 },
			{ role: "assistant", content: "Message 7", ts: 7 },
			{
				role: "user",
				content: [toolResultBlock],
				ts: 8,
			},
			{ role: "assistant", content: "Message 9", ts: 9 },
			{ role: "user", content: "Message 10", ts: 10 },
		]

		// Should not crash
		const result = getKeepMessagesWithToolBlocks(messages, 3)

		// keepMessages should be the last 3 messages
		expect(result.keepMessages).toHaveLength(3)
		expect(result.keepMessages[0].ts).toBe(8)
		expect(result.keepMessages[1].ts).toBe(9)
		expect(result.keepMessages[2].ts).toBe(10)

		// Should not preserve the tool_use since it's beyond the search boundary
		expect(result.toolUseBlocksToPreserve).toHaveLength(0)
	})

	it("should not duplicate tool_use blocks when same tool_result ID appears multiple times", () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_duplicate",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock1 = {
			type: "tool_result" as const,
			tool_use_id: "toolu_duplicate",
			content: "result 1",
		}
		const toolResultBlock2 = {
			type: "tool_result" as const,
			tool_use_id: "toolu_duplicate",
			content: "result 2",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Start", ts: 1 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Using tool..." }, toolUseBlock],
				ts: 2,
			},
			{
				role: "user",
				content: [toolResultBlock1],
				ts: 3,
			},
			{ role: "assistant", content: "Processing", ts: 4 },
			{
				role: "user",
				content: [toolResultBlock2], // Same tool_use_id as first result
				ts: 5,
			},
		]

		const result = getKeepMessagesWithToolBlocks(messages, 3)

		// keepMessages should be the last 3 messages (ts: 3, 4, 5)
		expect(result.keepMessages).toHaveLength(3)

		// Should only preserve the tool_use block once, not twice
		expect(result.toolUseBlocksToPreserve).toHaveLength(1)
		expect(result.toolUseBlocksToPreserve[0]).toEqual(toolUseBlock)
	})
})

describe("getMessagesSinceLastSummary", () => {
	it("should return all messages when there is no summary", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
		]

		const result = getMessagesSinceLastSummary(messages)
		expect(result).toEqual(messages)
	})

	it("should return messages since the last summary with original first user message", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "assistant", content: "Summary of conversation", ts: 3, isSummary: true },
			{ role: "user", content: "How are you?", ts: 4 },
			{ role: "assistant", content: "I'm good", ts: 5 },
		]

		const result = getMessagesSinceLastSummary(messages)
		expect(result).toEqual([
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Summary of conversation", ts: 3, isSummary: true },
			{ role: "user", content: "How are you?", ts: 4 },
			{ role: "assistant", content: "I'm good", ts: 5 },
		])
	})

	it("should handle multiple summary messages and return since the last one with original first user message", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "First summary", ts: 2, isSummary: true },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "Second summary", ts: 4, isSummary: true },
			{ role: "user", content: "What's new?", ts: 5 },
		]

		const result = getMessagesSinceLastSummary(messages)
		expect(result).toEqual([
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Second summary", ts: 4, isSummary: true },
			{ role: "user", content: "What's new?", ts: 5 },
		])
	})

	it("should handle empty messages array", () => {
		const result = getMessagesSinceLastSummary([])
		expect(result).toEqual([])
	})
})

describe("summarizeConversation", () => {
	// Mock ApiHandler
	let mockApiHandler: ApiHandler
	let mockStream: AsyncGenerator<any, void, unknown>

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks()

		// Setup mock stream with usage information
		mockStream = (async function* () {
			yield { type: "text" as const, text: "This is " }
			yield { type: "text" as const, text: "a summary" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 150 }
		})()

		// Setup mock API handler
		mockApiHandler = {
			createMessage: vi.fn().mockReturnValue(mockStream),
			countTokens: vi.fn().mockImplementation(() => Promise.resolve(100)),
			getModel: vi.fn().mockReturnValue({
				id: "test-model",
				info: {
					contextWindow: 8000,
					supportsImages: true,
					supportsVision: true,
					maxTokens: 4000,
					supportsPromptCache: true,
					maxCachePoints: 10,
					minTokensPerCachePoint: 100,
					cachableFields: ["system", "messages"],
				},
			}),
		} as unknown as ApiHandler
	})

	// Default system prompt for tests
	const defaultSystemPrompt = "You are a helpful assistant."

	it("does not send hidden reasoning or provider metadata to the condensing provider", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Start", ts: 1 },
			{
				role: "assistant",
				content: [
					{ type: "reasoning", text: "private chain of thought" } as any,
					{ type: "text", text: "Visible answer" },
				],
				reasoning_details: [{ type: "reasoning.summary", summary: "private provider summary" }],
				reasoning_content: "private interleaved reasoning",
				encrypted_content: "private encrypted reasoning",
				thoughtSignature: "private thought signature",
				ts: 2,
			},
			{ role: "user", content: "Next", ts: 3 },
			{ role: "assistant", content: "Visible follow-up", ts: 4 },
			{ role: "user", content: "More", ts: 5 },
			{ role: "assistant", content: "Visible last", ts: 6 },
			{ role: "user", content: "Finish", ts: 7 },
		] as (ApiMessage & Record<string, unknown>)[]

		await summarizeConversation(messages, mockApiHandler, defaultSystemPrompt, taskId, DEFAULT_PREV_CONTEXT_TOKENS)

		const request = vi.mocked(mockApiHandler.createMessage).mock.calls[0]?.[1] as any[]
		const serializedRequest = JSON.stringify(request)
		expect(serializedRequest).not.toContain("private chain of thought")
		expect(serializedRequest).not.toContain("private provider summary")
		expect(serializedRequest).toContain("Visible answer")
	})

	it("preserves hidden storage messages while using only effective history for a later condense request", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Original task", ts: 1 },
			{
				role: "assistant",
				content: [
					{ type: "reasoning", text: "stored private reasoning" } as any,
					{ type: "text", text: "Recoverable original answer" },
				],
				condenseParent: "summary-1",
				ts: 2,
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "First summary" }],
				isSummary: true,
				condenseId: "summary-1",
				ts: 3,
			},
			{ role: "user", content: "Recent 1", ts: 4 },
			{ role: "assistant", content: "Recent 2", ts: 5 },
			{ role: "user", content: "Recent 3", ts: 6 },
			{ role: "assistant", content: "Recent 4", ts: 7 },
			{ role: "user", content: "Recent 5", ts: 8 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)

		const request = vi.mocked(mockApiHandler.createMessage).mock.calls[0]?.[1] as any[]
		expect(JSON.stringify(request)).not.toContain("stored private reasoning")
		expect(JSON.stringify(request)).not.toContain("Recoverable original answer")

		const storedOriginal = result.messages.find((message) => message.ts === 2)
		expect(storedOriginal).toBeDefined()
		expect(JSON.stringify(storedOriginal)).toContain("Recoverable original answer")
		expect(storedOriginal?.condenseParent).toBe("summary-1")

		const secondSummary = result.messages.find((message) => message.isSummary && message.condenseId !== "summary-1")
		expect(secondSummary?.condenseId).toBeDefined()

		const withoutSecondSummary = cleanupAfterTruncation(
			result.messages.filter((message) => message !== secondSummary),
		)
		const afterSecondRewind = getEffectiveApiHistory(withoutSecondSummary)
		expect(JSON.stringify(afterSecondRewind)).toContain("First summary")
		expect(JSON.stringify(afterSecondRewind)).not.toContain("Recoverable original answer")

		const withoutAnySummary = cleanupAfterTruncation(
			withoutSecondSummary.filter((message) => message.condenseId !== "summary-1"),
		)
		const afterFirstRewind = getEffectiveApiHistory(withoutAnySummary)
		expect(JSON.stringify(afterFirstRewind)).toContain("Recoverable original answer")
		expect(JSON.stringify(afterFirstRewind)).toContain("stored private reasoning")
	})

	it("does not resend condensed hidden messages when an existing summary is present", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Original task", ts: 1 },
			{
				role: "assistant",
				content: [
					{ type: "reasoning", text: "stale hidden reasoning" } as any,
					{ type: "text", text: "Old answer" },
				],
				condenseParent: "summary-1",
				ts: 2,
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Existing summary" }],
				isSummary: true,
				condenseId: "summary-1",
				ts: 3,
			},
			{ role: "user", content: "Recent user message", ts: 4 },
			{ role: "assistant", content: "Recent answer", ts: 5 },
			{ role: "user", content: "Latest user message", ts: 6 },
			{ role: "assistant", content: "Latest answer", ts: 7 },
		]

		await summarizeConversation(messages, mockApiHandler, defaultSystemPrompt, taskId, DEFAULT_PREV_CONTEXT_TOKENS)

		const request = vi.mocked(mockApiHandler.createMessage).mock.calls[0]?.[1] as any[]
		const serializedRequest = JSON.stringify(request)
		expect(serializedRequest).not.toContain("stale hidden reasoning")
		expect(serializedRequest).not.toContain("Old answer")
		expect(serializedRequest).toContain("Existing summary")
	})

	it("should not summarize when there are not enough messages", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0)
		expect(result.summary).toBe("")
		expect(result.newContextTokens).toBeUndefined()
		expect(result.error).toBeTruthy() // Error should be set for not enough messages
		expect(mockApiHandler.createMessage).not.toHaveBeenCalled()
	})

	it("uses non-streaming completion when the condensing handler supports it", async () => {
		const completePrompt = vi.fn().mockResolvedValue("This is a non-streaming summary")
		;(mockApiHandler as ApiHandler & { completePrompt: typeof completePrompt }).completePrompt = completePrompt
		mockApiHandler.createMessage = vi.fn().mockImplementation(() => {
			throw new Error("stream should not be used for condense")
		})

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)

		expect(completePrompt).toHaveBeenCalledWith(expect.stringContaining("Conversation to summarize"))
		const completionPrompt = completePrompt.mock.calls[0]?.[0] as string
		expect(completionPrompt.match(/Summarize the conversation so far/g)).toHaveLength(1)
		expect(mockApiHandler.createMessage).not.toHaveBeenCalled()
		expect(result.summary).toBe("This is a non-streaming summary")
		expect(result.error).toBeUndefined()
	})

	it("uses a local structured summary when automatic non-streaming condense fails", async () => {
		const completePrompt = vi.fn().mockRejectedValue(new Error("relay unavailable"))
		;(mockApiHandler as ApiHandler & { completePrompt: typeof completePrompt }).completePrompt = completePrompt
		const messages: ApiMessage[] = [
			{ role: "user", content: "Initial task", ts: 1 },
			{ role: "assistant", content: "Work one", ts: 2 },
			{ role: "user", content: "Extension one", ts: 3 },
			{ role: "assistant", content: "Work two", ts: 4 },
			{ role: "user", content: "Newest focus", ts: 5 },
			{ role: "assistant", content: "Latest result", ts: 6 },
			{ role: "user", content: "Continue", ts: 7 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			true,
		)

		expect(result.error).toBeUndefined()
		expect(result.condenseId).toBeDefined()
		expect(result.summary).toContain("Initial task")
		expect(result.summary).toContain("relay unavailable")
		expect(result.messages.some((message) => message.isSummary)).toBe(true)
	})

	it("returns an error instead of throwing when manual non-streaming condense fails", async () => {
		const completeError = new Error(
			"API stream timed out after 60000ms while waiting for the next chunk; no model output was received.",
		)
		const completePrompt = vi.fn().mockRejectedValue(completeError)
		;(mockApiHandler as ApiHandler & { completePrompt: typeof completePrompt }).completePrompt = completePrompt

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)

		expect(result.messages).toEqual(messages)
		expect(result.summary).toBe("")
		expect(result.error).toContain("API stream timed out")
	})

	it("returns an error instead of throwing when the condensing stream fails", async () => {
		const streamError = new Error(
			"API stream timed out after 60000ms while waiting for the next chunk; no model output was received.",
		)
		mockApiHandler.createMessage = vi.fn().mockImplementation(() => {
			return new ReadableStream({
				start(controller) {
					controller.error(streamError)
				},
			})
		})

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)

		expect(result.messages).toEqual(messages)
		expect(result.summary).toBe("")
		expect(result.cost).toBe(0)
		expect(result.error).toContain("API stream timed out")
	})

	it("should not summarize when there was a recent summary", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6, isSummary: true }, // Recent summary
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0)
		expect(result.summary).toBe("")
		expect(result.newContextTokens).toBeUndefined()
		expect(result.error).toBeTruthy() // Error should be set for recent summary
		expect(mockApiHandler.createMessage).not.toHaveBeenCalled()
	})

	it("should summarize conversation and insert summary message", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)

		// Check that the API was called correctly
		expect(mockApiHandler.createMessage).toHaveBeenCalled()
		expect(maybeRemoveImageBlocks).toHaveBeenCalled()

		// With non-destructive condensing, the result contains ALL original messages
		// plus the summary message. Condensed messages are tagged but not deleted.
		// Use getEffectiveApiHistory to verify the effective API view matches the old behavior.
		expect(result.messages.length).toBe(messages.length + 1) // All original messages + summary

		// Check that the first message is preserved
		expect(result.messages[0]).toEqual(messages[0])

		// Find the summary message (it has isSummary: true)
		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		expect(summaryMessage!.role).toBe("assistant")
		// Summary content should not synthesize reasoning blocks that leak into later provider calls.
		expect(Array.isArray(summaryMessage!.content)).toBe(true)
		const content = summaryMessage!.content as any[]
		expect(content).toEqual([{ type: "text", text: "This is a summary" }])
		expect(content.some((block) => block.type === "reasoning")).toBe(false)
		expect(summaryMessage!.isSummary).toBe(true)

		// Verify that the effective API history matches expected: first + summary + last N messages
		const effectiveHistory = getEffectiveApiHistory(result.messages)
		expect(effectiveHistory.length).toBe(1 + 1 + N_MESSAGES_TO_KEEP) // First + summary + last N

		// Check that condensed messages are properly tagged
		const condensedMessages = result.messages.filter((m) => m.condenseParent !== undefined)
		expect(condensedMessages.length).toBeGreaterThan(0)

		// Check the cost and token counts
		expect(result.cost).toBe(0.05)
		expect(result.summary).toBe("This is a summary")
		expect(result.newContextTokens).toBe(250) // 150 output tokens + 100 from countTokens
		expect(result.error).toBeUndefined()
	})

	it("should handle empty summary response and return error", async () => {
		// We need enough messages to trigger summarization
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		// Setup empty summary response with usage information
		const emptyStream = (async function* () {
			yield { type: "text" as const, text: "" }
			yield { type: "usage" as const, totalCost: 0.02, outputTokens: 0 }
		})()

		// Create a new mock for createMessage that returns empty stream
		const createMessageMock = vi.fn().mockReturnValue(emptyStream)
		mockApiHandler.createMessage = createMessageMock as any

		// We need to mock maybeRemoveImageBlocks to return the expected messages
		;(maybeRemoveImageBlocks as Mock).mockImplementationOnce((messages: any) => {
			return messages.map(({ role, content }: { role: string; content: any }) => ({ role, content }))
		})

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)

		// Should return original messages when summary is empty
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0.02)
		expect(result.summary).toBe("")
		expect(result.error).toBeTruthy() // Error should be set
		expect(result.newContextTokens).toBeUndefined()
	})

	it("should correctly format the request to the API", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		await summarizeConversation(messages, mockApiHandler, defaultSystemPrompt, taskId, DEFAULT_PREV_CONTEXT_TOKENS)

		// Verify the final request message
		const expectedFinalMessage = {
			role: "user",
			content: "Summarize the conversation so far, as described in the prompt instructions.",
		}

		// Verify that the default prompt preserves the live task authority contract.
		expect(mockApiHandler.createMessage).toHaveBeenCalledWith(
			expect.stringContaining("The newest user instruction is the active acceptance target"),
			expect.any(Array),
		)
		expect(vi.mocked(mockApiHandler.createMessage).mock.calls[0][0]).toContain(
			"A checklist records progress facts; it does not define task scope",
		)

		// Check that maybeRemoveImageBlocks was called with the correct messages
		const mockCallArgs = (maybeRemoveImageBlocks as Mock).mock.calls[0][0] as any[]
		expect(mockCallArgs[mockCallArgs.length - 1]).toEqual(expectedFinalMessage)
	})
	it("should include the original first user message in summarization input", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Initial ask", ts: 1 },
			{ role: "assistant", content: "Ack", ts: 2 },
			{ role: "user", content: "Follow-up", ts: 3 },
			{ role: "assistant", content: "Response", ts: 4 },
			{ role: "user", content: "More", ts: 5 },
			{ role: "assistant", content: "Later", ts: 6 },
			{ role: "user", content: "Newest", ts: 7 },
		]

		await summarizeConversation(messages, mockApiHandler, defaultSystemPrompt, taskId, DEFAULT_PREV_CONTEXT_TOKENS)

		const mockCallArgs = (maybeRemoveImageBlocks as Mock).mock.calls[0][0] as any[]

		// Expect the original first user message to be present in the messages sent to the summarizer
		const hasInitialAsk = mockCallArgs.some(
			(m) =>
				m.role === "user" &&
				(typeof m.content === "string"
					? m.content === "Initial ask"
					: Array.isArray(m.content) &&
						m.content.some((b: any) => b.type === "text" && b.text === "Initial ask")),
		)
		expect(hasInitialAsk).toBe(true)
	})

	it("should calculate newContextTokens correctly with systemPrompt", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const systemPrompt = "You are a helpful assistant."

		// Create a stream with usage information
		const streamWithUsage = (async function* () {
			yield { type: "text" as const, text: "This is a summary with system prompt" }
			yield { type: "usage" as const, totalCost: 0.06, outputTokens: 200 }
		})()

		// Override the mock for this test
		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithUsage) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			systemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)

		// Verify that countTokens was called with the correct messages including system prompt
		expect(mockApiHandler.countTokens).toHaveBeenCalled()

		// Check the newContextTokens calculation includes system prompt
		expect(result.newContextTokens).toBe(300) // 200 output tokens + 100 from countTokens
		expect(result.cost).toBe(0.06)
		expect(result.summary).toBe("This is a summary with system prompt")
		expect(result.error).toBeUndefined()
	})

	it("should return error when new context tokens >= previous context tokens", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		// Create a stream that produces a summary
		const streamWithLargeTokens = (async function* () {
			yield { type: "text" as const, text: "This is a very long summary that uses many tokens" }
			yield { type: "usage" as const, totalCost: 0.08, outputTokens: 500 }
		})()

		// Override the mock for this test
		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithLargeTokens) as any

		// Mock countTokens to return a high value that when added to outputTokens (500)
		// will be >= prevContextTokens (600)
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(200)) as any

		const prevContextTokens = 600
		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			prevContextTokens,
		)

		// Should return original messages when context would grow
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0.08)
		expect(result.summary).toBe("")
		expect(result.error).toBeTruthy() // Error should be set
		expect(result.newContextTokens).toBeUndefined()
	})

	it("should successfully summarize when new context tokens < previous context tokens", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		// Create a stream that produces a summary with reasonable token count
		const streamWithSmallTokens = (async function* () {
			yield { type: "text" as const, text: "Concise summary" }
			yield { type: "usage" as const, totalCost: 0.03, outputTokens: 50 }
		})()

		// Override the mock for this test
		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithSmallTokens) as any

		// Mock countTokens to return a small value so total is < prevContextTokens
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(30)) as any

		const prevContextTokens = 200
		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			prevContextTokens,
		)

		// With non-destructive condensing, result contains all messages plus summary
		// Use getEffectiveApiHistory to verify the effective API view
		expect(result.messages.length).toBe(messages.length + 1) // All messages + summary
		const effectiveHistory = getEffectiveApiHistory(result.messages)
		expect(effectiveHistory.length).toBe(1 + 1 + N_MESSAGES_TO_KEEP) // First + summary + last N
		expect(result.cost).toBe(0.03)
		expect(result.summary).toBe("Concise summary")
		expect(result.error).toBeUndefined()
		expect(result.newContextTokens).toBe(80) // 50 output tokens + 30 from countTokens
		expect(result.newContextTokens).toBeLessThan(prevContextTokens)
	})

	it("should return error when not enough messages to summarize", async () => {
		const messages: ApiMessage[] = [{ role: "user", content: "Hello", ts: 1 }]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)

		// Should return original messages when not enough to summarize
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0)
		expect(result.summary).toBe("")
		expect(result.error).toBeTruthy() // Error should be set
		expect(result.newContextTokens).toBeUndefined()
		expect(mockApiHandler.createMessage).not.toHaveBeenCalled()
	})

	it("should return error when recent summary exists in kept messages", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Recent summary", ts: 6, isSummary: true }, // Summary in last 3 messages
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
		)

		// Should return original messages when recent summary exists
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0)
		expect(result.summary).toBe("")
		expect(result.error).toBeTruthy() // Error should be set
		expect(result.newContextTokens).toBeUndefined()
		expect(mockApiHandler.createMessage).not.toHaveBeenCalled()
	})

	it("should return error when both condensing and main API handlers are invalid", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		// Create invalid handlers (missing createMessage)
		const invalidMainHandler = {
			countTokens: vi.fn(),
			getModel: vi.fn(),
			// createMessage is missing
		} as unknown as ApiHandler

		const invalidCondensingHandler = {
			countTokens: vi.fn(),
			getModel: vi.fn(),
			// createMessage is missing
		} as unknown as ApiHandler

		// Mock console.error to verify error message
		const originalError = console.error
		const mockError = vi.fn()
		console.error = mockError

		const result = await summarizeConversation(
			messages,
			invalidMainHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			invalidCondensingHandler,
		)

		// Should return original messages when both handlers are invalid
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0)
		expect(result.summary).toBe("")
		expect(result.error).toBeTruthy() // Error should be set
		expect(result.newContextTokens).toBeUndefined()

		// Verify error was logged
		expect(mockError).toHaveBeenCalledWith(
			expect.stringContaining("Main API handler is also invalid for condensing"),
		)

		// Restore console.error
		console.error = originalError
	})

	it("should append tool_use blocks to summary message when first kept message has tool_result blocks", async () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_123",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_123",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me read that file", ts: 2 },
			{ role: "user", content: "Please continue", ts: 3 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Reading file..." }, toolUseBlock],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Continue" }],
				ts: 5,
			},
			{ role: "assistant", content: "Got it, the file says...", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		// Create a stream with usage information
		const streamWithUsage = (async function* () {
			yield { type: "text" as const, text: "Summary of conversation" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
		})()

		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithUsage) as any
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(50)) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false, // isAutomaticTrigger
			undefined, // customCondensingPrompt
			undefined, // condensingApiHandler
			true, // useNativeTools - required for tool_use block preservation
		)

		// Find the summary message
		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		expect(summaryMessage!.role).toBe("assistant")
		expect(summaryMessage!.isSummary).toBe(true)
		expect(Array.isArray(summaryMessage!.content)).toBe(true)

		// Content should be [text block, tool_use block]; no synthetic reasoning is added.
		const content = summaryMessage!.content as Anthropic.Messages.ContentBlockParam[]
		expect(content).toHaveLength(2)
		expect(content.some((block) => (block as any).type === "reasoning")).toBe(false)
		expect(content[0].type).toBe("text")
		expect((content[0] as Anthropic.Messages.TextBlockParam).text).toBe("Summary of conversation")
		expect(content[1].type).toBe("tool_use")
		expect((content[1] as Anthropic.Messages.ToolUseBlockParam).id).toBe("toolu_123")
		expect((content[1] as Anthropic.Messages.ToolUseBlockParam).name).toBe("read_file")

		// With non-destructive condensing, all messages are retained plus the summary
		expect(result.messages.length).toBe(messages.length + 1) // all original + summary
		// Verify effective history matches expected
		const effectiveHistory = getEffectiveApiHistory(result.messages)
		expect(effectiveHistory.length).toBe(1 + 1 + N_MESSAGES_TO_KEEP) // first + summary + last 3
		expect(result.error).toBeUndefined()
	})

	it("should include user tool_result message in summarize request when preserving tool_use blocks", async () => {
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_history_fix",
			name: "read_file",
			input: { path: "sample.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_history_fix",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Running tool..." }, toolUseBlock],
				ts: 3,
			},
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Thanks" }],
				ts: 4,
			},
			{ role: "assistant", content: "Anything else?", ts: 5 },
			{ role: "user", content: "Nope", ts: 6 },
		]

		let capturedRequestMessages: any[] | undefined
		const customStream = (async function* () {
			yield { type: "text" as const, text: "Summary of conversation" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
		})()

		mockApiHandler.createMessage = vi.fn().mockImplementation((_prompt, requestMessagesParam) => {
			capturedRequestMessages = requestMessagesParam
			return customStream
		}) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			undefined,
			true,
		)

		expect(result.error).toBeUndefined()
		expect(capturedRequestMessages).toBeDefined()

		const requestMessages = capturedRequestMessages!
		expect(requestMessages[requestMessages.length - 1]).toEqual({
			role: "user",
			content: "Summarize the conversation so far, as described in the prompt instructions.",
		})

		const historyMessages = requestMessages.slice(0, -1)
		expect(historyMessages.length).toBeGreaterThanOrEqual(2)

		const assistantMessage = historyMessages[historyMessages.length - 2]
		const userMessage = historyMessages[historyMessages.length - 1]

		expect(assistantMessage.role).toBe("assistant")
		expect(Array.isArray(assistantMessage.content)).toBe(true)
		expect(
			(assistantMessage.content as any[]).some(
				(block) => block.type === "tool_use" && block.id === toolUseBlock.id,
			),
		).toBe(true)

		expect(userMessage.role).toBe("user")
		expect(Array.isArray(userMessage.content)).toBe(true)
		expect(
			(userMessage.content as any[]).some(
				(block) => block.type === "tool_result" && block.tool_use_id === toolUseBlock.id,
			),
		).toBe(true)
	})

	it("should append multiple tool_use blocks for parallel tool calls", async () => {
		const toolUseBlockA = {
			type: "tool_use" as const,
			id: "toolu_parallel_1",
			name: "search",
			input: { query: "foo" },
		}
		const toolUseBlockB = {
			type: "tool_use" as const,
			id: "toolu_parallel_2",
			name: "search",
			input: { query: "bar" },
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Start", ts: 1 },
			{ role: "assistant", content: "Working...", ts: 2 },
			{
				role: "assistant",
				content: [{ type: "text" as const, text: "Launching parallel tools" }, toolUseBlockA, toolUseBlockB],
				ts: 3,
			},
			{
				role: "user",
				content: [
					{ type: "tool_result" as const, tool_use_id: "toolu_parallel_1", content: "result A" },
					{ type: "tool_result" as const, tool_use_id: "toolu_parallel_2", content: "result B" },
					{ type: "text" as const, text: "Continue" },
				],
				ts: 4,
			},
			{ role: "assistant", content: "Processing results", ts: 5 },
			{ role: "user", content: "Thanks", ts: 6 },
		]

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			undefined,
			true,
		)

		// Find the summary message (it has isSummary: true)
		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		expect(Array.isArray(summaryMessage!.content)).toBe(true)
		const summaryContent = summaryMessage!.content as Anthropic.Messages.ContentBlockParam[]
		expect(summaryContent.some((block) => (block as any).type === "reasoning")).toBe(false)
		expect(summaryContent[0]).toEqual({ type: "text", text: "This is a summary" })

		const preservedToolUses = summaryContent.filter(
			(block): block is Anthropic.Messages.ToolUseBlockParam => block.type === "tool_use",
		)
		expect(preservedToolUses).toHaveLength(2)
		expect(preservedToolUses.map((block) => block.id)).toEqual(["toolu_parallel_1", "toolu_parallel_2"])
	})

	it("should preserve reasoning blocks in summary message for DeepSeek/Z.ai interleaved thinking", async () => {
		const reasoningBlock = {
			type: "reasoning" as const,
			text: "Let me think about this step by step...",
		}
		const toolUseBlock = {
			type: "tool_use" as const,
			id: "toolu_deepseek_reason",
			name: "read_file",
			input: { path: "test.txt" },
		}
		const toolResultBlock = {
			type: "tool_result" as const,
			tool_use_id: "toolu_deepseek_reason",
			content: "file contents",
		}

		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Let me help", ts: 2 },
			{ role: "user", content: "Please read the file", ts: 3 },
			{
				role: "assistant",
				// DeepSeek stores reasoning as content blocks alongside tool_use
				content: [reasoningBlock as any, { type: "text" as const, text: "Reading file..." }, toolUseBlock],
				ts: 4,
			},
			{
				role: "user",
				content: [toolResultBlock, { type: "text" as const, text: "Continue" }],
				ts: 5,
			},
			{ role: "assistant", content: "Got it, the file says...", ts: 6 },
			{ role: "user", content: "Thanks", ts: 7 },
		]

		// Create a stream with usage information
		const streamWithUsage = (async function* () {
			yield { type: "text" as const, text: "Summary of conversation" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
		})()

		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithUsage) as any
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(50)) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false, // isAutomaticTrigger
			undefined, // customCondensingPrompt
			undefined, // condensingApiHandler
			true, // useNativeTools - required for tool_use block preservation
		)

		// Find the summary message
		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		expect(summaryMessage!.role).toBe("assistant")
		expect(summaryMessage!.isSummary).toBe(true)
		expect(Array.isArray(summaryMessage!.content)).toBe(true)

		// Compression summaries must not carry hidden reasoning across the provider
		// boundary. The original tool_use remains only to preserve tool protocol shape.
		const content = summaryMessage!.content as Anthropic.Messages.ContentBlockParam[]
		expect(content).toHaveLength(2)
		expect(content[0].type).toBe("text")
		expect((content[0] as Anthropic.Messages.TextBlockParam).text).toBe("Summary of conversation")
		expect(content.some((block) => (block as any).type === "reasoning")).toBe(false)
		expect(content[1].type).toBe("tool_use")
		expect((content[1] as Anthropic.Messages.ToolUseBlockParam).id).toBe("toolu_deepseek_reason")

		expect(result.error).toBeUndefined()
	})

	it("should not synthesize reasoning blocks in summary messages without preserved tool_use blocks", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Tell me a joke", ts: 1 },
			{ role: "assistant", content: "Why did the programmer quit?", ts: 2 },
			{ role: "user", content: "I don't know, why?", ts: 3 },
			{ role: "assistant", content: "He didn't get arrays!", ts: 4 },
			{ role: "user", content: "Another one please", ts: 5 },
			{ role: "assistant", content: "Why do programmers prefer dark mode?", ts: 6 },
			{ role: "user", content: "Why?", ts: 7 },
		]

		const streamWithUsage = (async function* () {
			yield { type: "text" as const, text: "Summary: User requested jokes." }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
		})()

		mockApiHandler.createMessage = vi.fn().mockReturnValue(streamWithUsage) as any
		mockApiHandler.countTokens = vi.fn().mockImplementation(() => Promise.resolve(50)) as any

		const result = await summarizeConversation(
			messages,
			mockApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			undefined,
			false,
		)

		const summaryMessage = result.messages.find((m) => m.isSummary)
		expect(summaryMessage).toBeDefined()
		expect(summaryMessage!.role).toBe("assistant")
		expect(summaryMessage!.isSummary).toBe(true)
		expect(Array.isArray(summaryMessage!.content)).toBe(true)
		const content = summaryMessage!.content as any[]

		expect(content).toEqual([{ type: "text", text: "Summary: User requested jokes." }])
		expect(content.some((block) => block.type === "reasoning")).toBe(false)
		expect(result.error).toBeUndefined()
	})
})

describe("summarizeConversation with custom settings", () => {
	// Mock necessary dependencies
	let mockMainApiHandler: ApiHandler
	let mockCondensingApiHandler: ApiHandler
	const defaultSystemPrompt = "Default prompt"
	const taskId = "test-task"

	// Sample messages for testing
	const sampleMessages: ApiMessage[] = [
		{ role: "user", content: "Hello", ts: 1 },
		{ role: "assistant", content: "Hi there", ts: 2 },
		{ role: "user", content: "How are you?", ts: 3 },
		{ role: "assistant", content: "I'm good", ts: 4 },
		{ role: "user", content: "What's new?", ts: 5 },
		{ role: "assistant", content: "Not much", ts: 6 },
		{ role: "user", content: "Tell me more", ts: 7 },
	]

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks()

		// Reset telemetry mock
		;(TelemetryService.instance.captureContextCondensed as Mock).mockClear()

		// Setup mock API handlers
		mockMainApiHandler = {
			createMessage: vi.fn().mockImplementation(() => {
				return (async function* () {
					yield { type: "text" as const, text: "Summary from main handler" }
					yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
				})()
			}),
			countTokens: vi.fn().mockImplementation(() => Promise.resolve(50)),
			getModel: vi.fn().mockReturnValue({
				id: "main-model",
				info: {
					contextWindow: 8000,
					supportsImages: true,
					supportsVision: true,
					maxTokens: 4000,
					supportsPromptCache: true,
					maxCachePoints: 10,
					minTokensPerCachePoint: 100,
					cachableFields: ["system", "messages"],
				},
			}),
		} as unknown as ApiHandler

		mockCondensingApiHandler = {
			createMessage: vi.fn().mockImplementation(() => {
				return (async function* () {
					yield { type: "text" as const, text: "Summary from condensing handler" }
					yield { type: "usage" as const, totalCost: 0.03, outputTokens: 80 }
				})()
			}),
			countTokens: vi.fn().mockImplementation(() => Promise.resolve(40)),
			getModel: vi.fn().mockReturnValue({
				id: "condensing-model",
				info: {
					contextWindow: 4000,
					supportsImages: true,
					supportsVision: false,
					maxTokens: 2000,
					supportsPromptCache: false,
					maxCachePoints: 0,
					minTokensPerCachePoint: 0,
					cachableFields: [],
				},
			}),
		} as unknown as ApiHandler
	})

	/**
	 * Test that custom prompt is used when provided
	 */
	it("should use custom prompt when provided", async () => {
		const customPrompt = "Custom summarization prompt"

		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			customPrompt,
		)

		// Verify the custom prompt was used
		const createMessageCalls = (mockMainApiHandler.createMessage as Mock).mock.calls
		expect(createMessageCalls.length).toBe(1)
		expect(createMessageCalls[0][0]).toBe(customPrompt)
	})

	/**
	 * Test that default system prompt is used when custom prompt is empty
	 */
	it("should use default systemPrompt when custom prompt is empty or not provided", async () => {
		// Test with empty string
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			"  ", // Empty custom prompt
		)

		// Verify the default prompt was used
		let createMessageCalls = (mockMainApiHandler.createMessage as Mock).mock.calls
		expect(createMessageCalls.length).toBe(1)
		expect(createMessageCalls[0][0]).toContain("The newest user instruction is the active acceptance target")

		// Reset mock and test with undefined
		vi.clearAllMocks()
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined, // No custom prompt
		)

		// Verify the default prompt was used again
		createMessageCalls = (mockMainApiHandler.createMessage as Mock).mock.calls
		expect(createMessageCalls.length).toBe(1)
		expect(createMessageCalls[0][0]).toContain("The newest user instruction is the active acceptance target")
	})

	/**
	 * Test that condensing API handler is used when provided and valid
	 */
	it("should use condensingApiHandler when provided and valid", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			mockCondensingApiHandler,
		)

		// Verify the condensing handler was used
		expect((mockCondensingApiHandler.createMessage as Mock).mock.calls.length).toBe(1)
		expect((mockMainApiHandler.createMessage as Mock).mock.calls.length).toBe(0)
	})

	/**
	 * Test fallback to main API handler when condensing handler is not provided
	 */
	it("should fall back to mainApiHandler if condensingApiHandler is not provided", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			undefined,
		)

		// Verify the main handler was used
		expect((mockMainApiHandler.createMessage as Mock).mock.calls.length).toBe(1)
	})

	/**
	 * Test fallback to main API handler when condensing handler is invalid
	 */
	it("should fall back to mainApiHandler if condensingApiHandler is invalid", async () => {
		// Create an invalid handler (missing createMessage)
		const invalidHandler = {
			countTokens: vi.fn(),
			getModel: vi.fn(),
			// createMessage is missing
		} as unknown as ApiHandler

		// Mock console.warn to verify warning message
		const originalWarn = console.warn
		const mockWarn = vi.fn()
		console.warn = mockWarn

		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			invalidHandler,
		)

		// Verify the main handler was used as fallback
		expect((mockMainApiHandler.createMessage as Mock).mock.calls.length).toBe(1)

		// Verify warning was logged
		expect(mockWarn).toHaveBeenCalledWith(
			expect.stringContaining("Chosen API handler for condensing does not support message creation"),
		)

		// Restore console.warn
		console.warn = originalWarn
	})

	/**
	 * Test that telemetry is called for custom prompt usage
	 */
	// kilocode_change: skip
	it.skip("should capture telemetry when using custom prompt", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			"Custom prompt",
		)

		// Verify telemetry was called with custom prompt flag
		expect(TelemetryService.instance.captureContextCondensed).toHaveBeenCalledWith(
			taskId,
			false,
			true, // usedCustomPrompt
			false, // usedCustomApiHandler
		)
	})

	/**
	 * Test that telemetry is called for custom API handler usage
	 */
	// kilocode_change: skip
	it.skip("should capture telemetry when using custom API handler", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			false,
			undefined,
			mockCondensingApiHandler,
		)

		// Verify telemetry was called with custom API handler flag
		expect(TelemetryService.instance.captureContextCondensed).toHaveBeenCalledWith(
			taskId,
			false,
			false, // usedCustomPrompt
			true, // usedCustomApiHandler
		)
	})

	/**
	 * Test that telemetry is called with both custom prompt and API handler
	 */
	// kilocode_change: skip
	it.skip("should capture telemetry when using both custom prompt and API handler", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			DEFAULT_PREV_CONTEXT_TOKENS,
			true, // isAutomaticTrigger
			"Custom prompt",
			mockCondensingApiHandler,
		)

		// Verify telemetry was called with both flags
		expect(TelemetryService.instance.captureContextCondensed).toHaveBeenCalledWith(
			taskId,
			true, // isAutomaticTrigger
			true, // usedCustomPrompt
			true, // usedCustomApiHandler
		)
	})
})
