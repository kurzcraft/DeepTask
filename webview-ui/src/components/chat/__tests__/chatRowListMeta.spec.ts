import type { ClineMessage } from "@roo-code/types"

import { buildChatRowListMeta, buildPreviousTodosByTs, getPreviousTodos } from "../chatRowListMeta"

function say(ts: number, say: ClineMessage["say"], extra: Partial<ClineMessage> = {}): ClineMessage {
	return { ts, type: "say", say, ...extra }
}

function todoAsk(ts: number, todos: Array<{ id: string; content: string }>): ClineMessage {
	return {
		ts,
		type: "ask",
		ask: "tool",
		text: JSON.stringify({ tool: "updateTodoList", todos }),
	}
}

describe("buildChatRowListMeta", () => {
	it("matches original checkpoint, last-message, and next-result lookups", () => {
		const messages: ClineMessage[] = [
			say(1, "text"),
			say(2, "browser_action"),
			say(3, "browser_action_result"),
			say(4, "checkpoint_saved"),
			say(5, "browser_action"),
			say(6, "text"),
			say(7, "browser_action_result"),
		]

		const meta = buildChatRowListMeta(messages)

		expect(meta.hasCheckpoint).toBe(true)
		expect(meta.lastModifiedMessage).toBe(messages.at(-1))
		expect(meta.browserActions.map((message) => message.ts)).toEqual([2, 5])
		expect(meta.browserActionIndexByTs.get(2)).toBe(0)
		expect(meta.browserActionIndexByTs.get(5)).toBe(1)
		expect(meta.nextBrowserActionResultByActionTs.get(2)?.ts).toBe(3)
		expect(meta.nextBrowserActionResultByActionTs.get(5)?.ts).toBe(7)
	})

	it("leaves unmatched browser actions without a next result", () => {
		const meta = buildChatRowListMeta([say(1, "browser_action"), say(2, "text")])

		expect(meta.hasCheckpoint).toBe(false)
		expect(meta.nextBrowserActionResultByActionTs.has(1)).toBe(false)
	})
})

describe("previous todos lookup", () => {
	it("uses the latest earlier updateTodoList payload, matching the original reverse scan", () => {
		const messages: ClineMessage[] = [
			todoAsk(1, [{ id: "a", content: "first" }]),
			say(2, "text"),
			todoAsk(3, [{ id: "b", content: "second" }]),
			todoAsk(4, [{ id: "c", content: "third" }]),
		]

		expect(getPreviousTodos(messages, 4)).toEqual([{ id: "b", content: "second" }])
		expect(getPreviousTodos(messages, 3)).toEqual([{ id: "a", content: "first" }])
		expect(getPreviousTodos(messages, 1)).toEqual([])

		const byTs = buildPreviousTodosByTs(messages)
		expect(byTs.get(1)).toEqual([])
		expect(byTs.get(3)).toEqual([{ id: "a", content: "first" }])
		expect(byTs.get(4)).toEqual([{ id: "b", content: "second" }])
		expect(byTs.has(2)).toBe(false)
	})
})
