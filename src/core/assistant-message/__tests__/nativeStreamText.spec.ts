// npx vitest src/core/assistant-message/__tests__/nativeStreamText.spec.ts
import { describe, expect, it } from "vitest"

import type { AssistantMessageContent } from "../parseAssistantMessage"
import {
	appendNativeStreamText,
	committedNativeTextLength,
	sealPrecedingPartialText,
} from "../nativeStreamText"

describe("appendNativeStreamText", () => {
	it("updates a partial text block with the uncommitted remainder", () => {
		const blocks: AssistantMessageContent[] = [{ type: "text", content: "收到。", partial: true }]

		const result = appendNativeStreamText(blocks, "收到。先修重复句。")

		expect(result).toEqual({ created: false })
		expect(blocks).toEqual([{ type: "text", content: "收到。先修重复句。", partial: true }])
	})

	it("does not recopy sealed opening text after a tool block", () => {
		const blocks: AssistantMessageContent[] = [
			{ type: "text", content: "收到。先修重复句。", partial: false },
			{ type: "tool_use", name: "read_file", params: { path: "a.ts" }, partial: false, id: "tool-1" },
		]

		const result = appendNativeStreamText(blocks, "收到。先修重复句。接着核对压缩摘要。")

		expect(result).toEqual({ created: true })
		expect(committedNativeTextLength(blocks.slice(0, 1))).toBe("收到。先修重复句。".length)
		expect(blocks[2]).toEqual({
			type: "text",
			content: "接着核对压缩摘要。",
			partial: true,
		})
		expect(blocks.filter((block) => block.type === "text").map((block) => block.content)).toEqual([
			"收到。先修重复句。",
			"接着核对压缩摘要。",
		])
	})

	it("ignores empty remainder after a tool so the opening sentence is not replayed", () => {
		const blocks: AssistantMessageContent[] = [
			{ type: "text", content: "收到。", partial: false },
			{ type: "tool_use", name: "read_file", params: {}, partial: false, id: "tool-1" },
		]

		expect(appendNativeStreamText(blocks, "收到。")).toEqual({ created: false })
		expect(blocks).toHaveLength(2)
	})

	it("seals trailing partial text before a complete tool_call so later chunks stay incremental", () => {
		const blocks: AssistantMessageContent[] = [{ type: "text", content: "收到。先修重复句。", partial: true }]

		sealPrecedingPartialText(blocks)
		expect(blocks[0]).toEqual({ type: "text", content: "收到。先修重复句。", partial: false })

		blocks.push({ type: "tool_use", name: "read_file", params: {}, partial: false, id: "tool-1" })
		expect(appendNativeStreamText(blocks, "收到。先修重复句。接着核对压缩摘要。")).toEqual({ created: true })
		expect(blocks[2]).toEqual({
			type: "text",
			content: "接着核对压缩摘要。",
			partial: true,
		})
	})
})
