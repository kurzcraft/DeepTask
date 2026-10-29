// npx vitest run packages/core/src/message-utils/__tests__/consolidateCommands.spec.ts

import type { ClineMessage } from "@roo-code/types"

import { consolidateCommands, consolidateCommandsIncremental, COMMAND_OUTPUT_STRING } from "../consolidateCommands.js"

describe("consolidateCommands", () => {
	describe("command sequences", () => {
		it("should consolidate command and command_output messages", () => {
			const messages: ClineMessage[] = [
				{ type: "ask", ask: "command", text: "ls", ts: 1000 },
				{ type: "ask", ask: "command_output", text: "file1.txt", ts: 1001 },
				{ type: "ask", ask: "command_output", text: "file2.txt", ts: 1002 },
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(1)
			expect(result[0]!.ask).toBe("command")
			expect(result[0]!.text).toBe(`ls\n${COMMAND_OUTPUT_STRING}file1.txt\nfile2.txt`)
		})

		it("should handle multiple command sequences", () => {
			const messages: ClineMessage[] = [
				{ type: "ask", ask: "command", text: "ls", ts: 1000 },
				{ type: "ask", ask: "command_output", text: "output1", ts: 1001 },
				{ type: "ask", ask: "command", text: "pwd", ts: 1002 },
				{ type: "ask", ask: "command_output", text: "output2", ts: 1003 },
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(2)
			expect(result[0]!.text).toBe(`ls\n${COMMAND_OUTPUT_STRING}output1`)
			expect(result[1]!.text).toBe(`pwd\n${COMMAND_OUTPUT_STRING}output2`)
		})

		it("should handle command without output", () => {
			const messages: ClineMessage[] = [
				{ type: "ask", ask: "command", text: "ls", ts: 1000 },
				{ type: "say", say: "text", text: "some text", ts: 1001 },
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(2)
			expect(result[0]!.ask).toBe("command")
			expect(result[0]!.text).toBe("ls")
			expect(result[1]!.say).toBe("text")
		})

		it("should handle duplicate outputs (ask and say with same text)", () => {
			const messages: ClineMessage[] = [
				{ type: "ask", ask: "command", text: "ls", ts: 1000 },
				{ type: "ask", ask: "command_output", text: "same output", ts: 1001 },
				{ type: "say", say: "command_output", text: "same output", ts: 1002 },
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(1)
			expect(result[0]!.text).toBe(`ls\n${COMMAND_OUTPUT_STRING}same output`)
		})
	})

	describe("MCP server sequences", () => {
		it("should consolidate use_mcp_server and mcp_server_response messages", () => {
			const messages: ClineMessage[] = [
				{
					type: "ask",
					ask: "use_mcp_server",
					text: JSON.stringify({ server: "test", tool: "myTool" }),
					ts: 1000,
				},
				{ type: "say", say: "mcp_server_response", text: "response data", ts: 1001 },
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(1)
			expect(result[0]!.ask).toBe("use_mcp_server")
			const parsed = JSON.parse(result[0]!.text || "{}")
			expect(parsed.server).toBe("test")
			expect(parsed.response).toBe("response data")
		})

		it("should handle MCP request without response", () => {
			const messages: ClineMessage[] = [
				{
					type: "ask",
					ask: "use_mcp_server",
					text: JSON.stringify({ server: "test" }),
					ts: 1000,
				},
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(1)
			expect(result[0]!.ask).toBe("use_mcp_server")
		})

		it("should handle multiple MCP responses", () => {
			const messages: ClineMessage[] = [
				{
					type: "ask",
					ask: "use_mcp_server",
					text: JSON.stringify({ server: "test" }),
					ts: 1000,
				},
				{ type: "say", say: "mcp_server_response", text: "response1", ts: 1001 },
				{ type: "say", say: "mcp_server_response", text: "response2", ts: 1002 },
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(1)
			const parsed = JSON.parse(result[0]!.text || "{}")
			expect(parsed.response).toBe("response1\nresponse2")
		})
	})

	describe("mixed messages", () => {
		it("should preserve non-command, non-MCP messages", () => {
			const messages: ClineMessage[] = [
				{ type: "say", say: "text", text: "before", ts: 1000 },
				{ type: "ask", ask: "command", text: "ls", ts: 1001 },
				{ type: "ask", ask: "command_output", text: "output", ts: 1002 },
				{ type: "say", say: "text", text: "after", ts: 1003 },
			]

			const result = consolidateCommands(messages)

			expect(result.length).toBe(3)
			expect(result[0]!.text).toBe("before")
			expect(result[1]!.text).toBe(`ls\n${COMMAND_OUTPUT_STRING}output`)
			expect(result[2]!.text).toBe("after")
		})

		it("should handle empty array", () => {
			const messages: ClineMessage[] = []
			const result = consolidateCommands(messages)
			expect(result).toBe(messages)
			expect(result).toEqual([])
		})

		it("should reuse the original array when there is nothing to fold", () => {
			const messages: ClineMessage[] = [
				{ type: "say", say: "text", text: "hello", ts: 1000 },
				{ type: "ask", ask: "command", text: "ls", ts: 1001 },
				{
					type: "ask",
					ask: "use_mcp_server",
					text: JSON.stringify({ server: "test" }),
					ts: 1002,
				},
			]

			const result = consolidateCommands(messages)

			expect(result).toBe(messages)
			expect(result).toEqual(messages)
		})
	})

	describe("incremental prefix reuse", () => {
		const historyCommand: ClineMessage = { type: "ask", ask: "command", text: "ls", ts: 1000 }
		const historyOutput: ClineMessage = { type: "ask", ask: "command_output", text: "old-output", ts: 1001 }
		const laterText: ClineMessage = { type: "say", say: "text", text: "after", ts: 1002 }
		const openCommand: ClineMessage = { type: "ask", ask: "command", text: "cat log", ts: 1003 }
		const firstChunk: ClineMessage = { type: "say", say: "command_output", text: "line1", ts: 1004 }

		it("reuses folded historical command objects when appending a new output chunk", () => {
			const previousInput = [historyCommand, historyOutput, laterText, openCommand]
			const previousOutput = consolidateCommands(previousInput)
			const nextInput = [...previousInput, firstChunk]

			const incremental = consolidateCommandsIncremental(nextInput, previousInput, previousOutput)
			const full = consolidateCommands(nextInput)

			expect(incremental).toEqual(full)
			expect(incremental[0]).toBe(previousOutput[0])
			expect(incremental[1]).toBe(previousOutput[1])
			expect(incremental[2]).not.toBe(previousOutput[2])
			expect(incremental[2]!.text).toBe(`cat log\n${COMMAND_OUTPUT_STRING}line1`)
		})

		it("reuses the folded prefix when replacing the last output object", () => {
			const previousInput = [historyCommand, historyOutput, laterText, openCommand, firstChunk]
			const previousOutput = consolidateCommands(previousInput)
			const replacedChunk: ClineMessage = { type: "say", say: "command_output", text: "line1\nline2", ts: 1004 }
			const nextInput = [...previousInput.slice(0, -1), replacedChunk]

			const incremental = consolidateCommandsIncremental(nextInput, previousInput, previousOutput)
			const full = consolidateCommands(nextInput)

			expect(incremental).toEqual(full)
			expect(incremental[0]).toBe(previousOutput[0])
			expect(incremental[1]).toBe(previousOutput[1])
			expect(incremental[2]!.text).toBe(`cat log\n${COMMAND_OUTPUT_STRING}line1\nline2`)
		})

		it("falls back to a full fold when the common prefix is empty", () => {
			const previousInput = [historyCommand, historyOutput]
			const previousOutput = consolidateCommands(previousInput)
			const switched: ClineMessage[] = [
				{ type: "ask", ask: "command", text: "pwd", ts: 2000 },
				{ type: "ask", ask: "command_output", text: " /tmp", ts: 2001 },
			]

			const incremental = consolidateCommandsIncremental(switched, previousInput, previousOutput)
			const full = consolidateCommands(switched)

			expect(incremental).toEqual(full)
			expect(incremental[0]!.text).toBe(`pwd\n${COMMAND_OUTPUT_STRING} /tmp`)
		})

		it("returns the previous output when the input array identity is unchanged", () => {
			const previousInput = [historyCommand, historyOutput]
			const previousOutput = consolidateCommands(previousInput)

			const incremental = consolidateCommandsIncremental(previousInput, previousInput, previousOutput)

			expect(incremental).toBe(previousOutput)
		})
	})
})
