// npx vitest src/core/condense/__tests__/keep-window-alignment.spec.ts
import { describe, expect, it } from "vitest"

import { ApiMessage } from "../../task-persistence/apiMessages"
import {
	extendKeepStartToLatestUserMessage,
	MAX_KEEP_WINDOW_EXTENSION,
	N_MESSAGES_TO_KEEP,
} from "../index"

const user = (text: string, ts: number): ApiMessage => ({ role: "user", content: text, ts })
const assistant = (text: string, ts: number): ApiMessage => ({ role: "assistant", content: text, ts })
const toolResult = (ts: number): ApiMessage => ({
	role: "user",
	content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }],
	ts,
})
const toolUse = (ts: number): ApiMessage => ({
	role: "assistant",
	content: [{ type: "tool_use", id: "t", name: "read_file", input: {} }],
	ts,
})

describe("extendKeepStartToLatestUserMessage", () => {
	it("keeps the count-based boundary when the default window already contains a real user instruction", () => {
		const messages = [
			user("task", 1),
			assistant("a", 2),
			user("latest instruction", 3),
			toolUse(4),
			toolResult(5),
		]
		// length=5, default keepStart = 5-3 = 2 → messages[2] is the real user instruction
		const keepStart = extendKeepStartToLatestUserMessage(messages, messages.length - N_MESSAGES_TO_KEEP)
		expect(keepStart).toBe(2)
	})

	it("extends the boundary back to the newest real user instruction when the tail is tool messages", () => {
		const messages = [
			user("old task", 1),
			assistant("old answer", 2),
			user("newest real instruction", 3),
			toolUse(4),
			toolResult(5),
			toolUse(6),
			toolResult(7),
			toolUse(8),
			toolResult(9),
		]
		// length=9, default keepStart = 6 → tail is pure tools; newest real instruction at index 2
		const keepStart = extendKeepStartToLatestUserMessage(messages, messages.length - N_MESSAGES_TO_KEEP)
		expect(keepStart).toBe(2)
		// The newest instruction must be INSIDE the keep window
		expect(messages[keepStart].content).toBe("newest real instruction")
	})

	it("does not extend more than MAX_KEEP_WINDOW_EXTENSION messages", () => {
		const filler = Array.from({ length: 60 }, (_, i) =>
			i % 2 === 0 ? toolUse(100 + i) : toolResult(101 + i),
		)
		const messages = [user("only real instruction at index 0", 1), ...filler]
		// Default keepStart ~57; instruction at 0 is beyond 24-message extension floor
		const keepStart = extendKeepStartToLatestUserMessage(messages, messages.length - N_MESSAGES_TO_KEEP)
		expect(keepStart).toBe(messages.length - N_MESSAGES_TO_KEEP)
		expect(MAX_KEEP_WINDOW_EXTENSION).toBe(24)
	})

	it("never crosses an existing summary when extending", () => {
		const messages: ApiMessage[] = [
			user("task", 1),
			{ role: "assistant", content: "Summary1", isSummary: true, condenseId: "s1", ts: 2 },
			toolUse(3),
			toolResult(4),
			toolUse(5),
			toolResult(6),
		]
		// Default keepStart = 3; newest real instruction is at 0 but summary at 1 blocks it
		const keepStart = extendKeepStartToLatestUserMessage(messages, messages.length - N_MESSAGES_TO_KEEP)
		expect(keepStart).toBe(3)
	})

	it("treats a tool_result-only user turn as NOT a real instruction", () => {
		const messages = [
			user("task", 1),
			assistant("work", 2),
			toolUse(3),
			toolResult(4),
			toolUse(5),
			toolResult(6),
		]
		// Default keepStart = 3 → tail tool_result at index 3/5 is not an instruction; no real
		// instruction exists after index 2... index 2 is toolUse (assistant). user("work"...)
		// wait: assistant at 2. Real instruction at 1 ("task")? "work" is assistant. user("task") at 0.
		const keepStart = extendKeepStartToLatestUserMessage(messages, messages.length - N_MESSAGES_TO_KEEP)
		// Should extend to index 1? No — index 1 is assistant. Index 0 is the real instruction
		// but floor is max(1, 3-24)=1, so index 0 is unreachable; boundary stays at default.
		expect(keepStart).toBe(3)
	})

	it("extends to index 1 at most (first message stays in the summarize range)", () => {
		const messages = [
			user("first task", 1),
			user("second instruction", 2),
			toolUse(3),
			toolResult(4),
			toolUse(5),
			toolResult(6),
		]
		const keepStart = extendKeepStartToLatestUserMessage(messages, messages.length - N_MESSAGES_TO_KEEP)
		expect(keepStart).toBe(1)
	})

	it("returns the input boundary for an empty message list", () => {
		expect(extendKeepStartToLatestUserMessage([], 0)).toBe(0)
	})
})
