// npx vitest src/core/assistant-message/__tests__/nativeAssistantHistory.spec.ts
import { describe, expect, it } from "vitest"

import { buildNativeAssistantApiContent } from "../nativeAssistantHistory"
import type { AssistantMessageContent } from "../parseAssistantMessage"

describe("buildNativeAssistantApiContent", () => {
	it("keeps text and tools in stream order instead of dumping every sentence before tools", () => {
		const blocks: AssistantMessageContent[] = [
			{ type: "text", content: "收到。先修重复句。", partial: false },
			{
				type: "tool_use",
				name: "read_file",
				params: { path: "a.ts" },
				nativeArgs: { files: [{ path: "a.ts" }] },
				partial: false,
				id: "tool-1",
			},
			{ type: "text", content: "接着核对压缩摘要。", partial: false },
		]

		expect(buildNativeAssistantApiContent(blocks)).toEqual([
			{ type: "text", text: "收到。先修重复句。" },
			{
				type: "tool_use",
				id: "tool-1",
				name: "read_file",
				input: { files: [{ path: "a.ts" }] },
			},
			{ type: "text", text: "接着核对压缩摘要。" },
		])
	})

	it("skips duplicate tool ids and empty text", () => {
		const blocks: AssistantMessageContent[] = [
			{ type: "text", content: "", partial: false },
			{
				type: "tool_use",
				name: "read_file",
				params: {},
				partial: false,
				id: "tool 1",
			},
			{
				type: "tool_use",
				name: "read_file",
				params: {},
				partial: false,
				id: "tool 1",
			},
		]

		expect(buildNativeAssistantApiContent(blocks)).toEqual([
			{ type: "tool_use", id: "tool_1", name: "read_file", input: {} },
		])
	})

	it("keeps MCP tools in stream order and prepends thinking", () => {
		const blocks: AssistantMessageContent[] = [
			{ type: "text", content: "先查仓库。", partial: false },
			{
				type: "mcp_tool_use",
				name: "mcp_github_search",
				serverName: "github",
				toolName: "search",
				arguments: { query: "deeptask" },
				partial: false,
				id: "mcp.1",
			},
			{ type: "text", content: "接着压缩。", partial: false },
		]

		expect(
			buildNativeAssistantApiContent(blocks, [
				{ type: "thinking", thinking: "plan", signature: "sig" },
			]),
		).toEqual([
			{ type: "thinking", thinking: "plan", signature: "sig" },
			{ type: "text", text: "先查仓库。" },
			{
				type: "tool_use",
				id: "mcp_1",
				name: "mcp_github_search",
				input: { query: "deeptask" },
			},
			{ type: "text", text: "接着压缩。" },
		])
	})
})
