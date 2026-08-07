import { describe, expect, it } from "vitest"
import type { ClineMessage } from "@roo-code/types"
import { getLatestTodo } from "../todo"

describe("getLatestTodo", () => {
	it("prefers metadata and ignores an empty update after a valid checklist", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "ask",
				ask: "tool",
				metadata: {
					tool: "updateTodoList",
					todos: [{ id: "1", content: "Keep visible", status: "in_progress" }],
				},
			} as ClineMessage,
			{
				ts: 2,
				type: "ask",
				ask: "tool",
				text: JSON.stringify({ tool: "updateTodoList", todos: [] }),
			},
		]

		expect(getLatestTodo(messages)).toEqual([{ id: "1", content: "Keep visible", status: "in_progress" }])
	})

	it("returns an empty list when no valid non-empty checklist exists", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "ask",
				ask: "tool",
				text: JSON.stringify({ tool: "updateTodoList", todos: [] }),
			},
		]

		expect(getLatestTodo(messages)).toEqual([])
	})
})
