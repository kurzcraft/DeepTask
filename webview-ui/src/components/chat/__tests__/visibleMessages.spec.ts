import type { ClineMessage } from "@roo-code/types"

import { filterVisibleMessages, filterVisibleMessagesIncremental } from "../visibleMessages"

function createEverVisible() {
	const seen = new Set<number>()
	return {
		has: (ts: number) => seen.has(ts),
		set: (ts: number) => {
			seen.add(ts)
		},
		seen,
	}
}

function say(partial: Partial<ClineMessage> & Pick<ClineMessage, "ts">): ClineMessage {
	return {
		type: "say",
		say: "text",
		text: "hello",
		...partial,
	}
}

describe("filterVisibleMessages", () => {
	it("hides the leading task row by timestamp", () => {
		const task = say({ ts: 1, say: "text", text: "task" })
		const reply = say({ ts: 2, text: "reply" })
		const everVisible = createEverVisible()

		expect(filterVisibleMessages([task, reply], task.ts, everVisible)).toEqual([reply])
	})

	it("hides empty text, finished API rows, and resume asks", () => {
		const messages: ClineMessage[] = [
			say({ ts: 1, text: "keep" }),
			say({ ts: 2, text: "", images: [] }),
			say({ ts: 3, say: "api_req_finished", text: "{}" }),
			{ ts: 4, type: "ask", ask: "resume_task", text: "" },
		]
		const everVisible = createEverVisible()

		expect(filterVisibleMessages(messages, undefined, everVisible).map((msg) => msg.ts)).toEqual([1])
	})

	it("hides suppressed and user-message checkpoint rows", () => {
		const messages: ClineMessage[] = [
			say({
				ts: 1,
				say: "user_feedback",
				text: "edit",
				checkpoint: { type: "user_message", hash: "abc" } as ClineMessage["checkpoint"],
			}),
			say({ ts: 2, say: "checkpoint_saved", text: "abc" }),
			say({
				ts: 3,
				say: "checkpoint_saved",
				text: "other",
				checkpoint: { suppressMessage: true } as ClineMessage["checkpoint"],
			}),
			say({ ts: 4, say: "checkpoint_saved", text: "keep-hash" }),
		]
		const everVisible = createEverVisible()

		expect(filterVisibleMessages(messages, undefined, everVisible).map((msg) => msg.ts)).toEqual([1, 4])
	})

	it("shows delayed rows only while they are last or paired with resume_task", () => {
		const delayed = say({ ts: 1, say: "api_req_retry_delayed", text: "wait" })
		expect(filterVisibleMessages([delayed], undefined, createEverVisible())).toEqual([delayed])

		const later = say({ ts: 2, text: "next" })
		expect(filterVisibleMessages([delayed, later], undefined, createEverVisible()).map((msg) => msg.ts)).toEqual([2])

		const resume: ClineMessage = { ts: 3, type: "ask", ask: "resume_task", text: "" }
		expect(filterVisibleMessages([delayed, resume], undefined, createEverVisible())).toEqual([delayed])
	})

	it("keeps a delayed row after it has already been marked visible", () => {
		const delayed = say({ ts: 1, say: "api_req_retry_delayed", text: "wait" })
		const later = say({ ts: 2, text: "next" })
		const everVisible = createEverVisible()

		expect(filterVisibleMessages([delayed], undefined, everVisible)).toEqual([delayed])
		expect(filterVisibleMessages([delayed, later], undefined, everVisible).map((msg) => msg.ts)).toEqual([1, 2])
	})
})

describe("filterVisibleMessagesIncremental", () => {
	it("reuses the previous visible array when nothing changed", () => {
		const messages = [say({ ts: 1, text: "a" }), say({ ts: 2, text: "b" })]
		const everVisible = createEverVisible()
		const first = filterVisibleMessagesIncremental(messages, [], [], undefined, everVisible)
		const second = filterVisibleMessagesIncremental(messages, messages, first, undefined, everVisible)

		expect(second).toBe(first)
		expect(second.map((msg) => msg.ts)).toEqual([1, 2])
	})

	it("reuses the filtered prefix when a new visible row is appended", () => {
		const first = say({ ts: 1, text: "a" })
		const second = say({ ts: 2, text: "b" })
		const third = say({ ts: 3, text: "c" })
		const everVisible = createEverVisible()
		const previousInput = [first, second]
		const previousOutput = filterVisibleMessagesIncremental(previousInput, [], [], undefined, everVisible)
		const nextInput = [first, second, third]
		const nextOutput = filterVisibleMessagesIncremental(
			nextInput,
			previousInput,
			previousOutput,
			undefined,
			everVisible,
		)

		expect(nextOutput[0]).toBe(first)
		expect(nextOutput[1]).toBe(second)
		expect(nextOutput[2]).toBe(third)
		expect(nextOutput).not.toBe(previousOutput)
	})

	it("reuses the filtered prefix when only the last row is replaced", () => {
		const first = say({ ts: 1, text: "a" })
		const streaming = say({ ts: 2, text: "hel", partial: true })
		const updated = say({ ts: 2, text: "hello", partial: true })
		const everVisible = createEverVisible()
		const previousInput = [first, streaming]
		const previousOutput = filterVisibleMessagesIncremental(previousInput, [], [], undefined, everVisible)
		const nextOutput = filterVisibleMessagesIncremental(
			[first, updated],
			previousInput,
			previousOutput,
			undefined,
			everVisible,
		)

		expect(nextOutput[0]).toBe(first)
		expect(nextOutput[1]).toBe(updated)
		expect(nextOutput).toHaveLength(2)
	})

	it("falls back to a full filter when a delayed row is no longer last", () => {
		const delayed = say({ ts: 1, say: "api_req_retry_delayed", text: "wait" })
		const later = say({ ts: 2, text: "next" })
		const everVisible = createEverVisible()
		const previousInput = [delayed]
		const previousOutput = filterVisibleMessagesIncremental(previousInput, [], [], undefined, everVisible)
		expect(previousOutput).toEqual([delayed])

		const nextOutput = filterVisibleMessagesIncremental(
			[delayed, later],
			previousInput,
			previousOutput,
			undefined,
			everVisible,
		)

		// Once shown, delayed rows stay in the everVisible cache, matching ChatView.
		expect(nextOutput.map((msg) => msg.ts)).toEqual([1, 2])
		expect(nextOutput[0]).toBe(delayed)
		expect(nextOutput[1]).toBe(later)
	})

	it("hides a delayed row that was never marked visible once it is no longer last", () => {
		const delayed = say({ ts: 1, say: "api_req_retry_delayed", text: "wait" })
		const later = say({ ts: 2, text: "next" })
		const nextOutput = filterVisibleMessagesIncremental(
			[delayed, later],
			[],
			[],
			undefined,
			createEverVisible(),
		)

		expect(nextOutput.map((msg) => msg.ts)).toEqual([2])
		expect(nextOutput).not.toContain(delayed)
	})

	it("falls back to a full filter on rewind", () => {
		const first = say({ ts: 1, text: "a" })
		const second = say({ ts: 2, text: "b" })
		const everVisible = createEverVisible()
		const previousInput = [first, second]
		const previousOutput = filterVisibleMessagesIncremental(previousInput, [], [], undefined, everVisible)
		const nextOutput = filterVisibleMessagesIncremental([first], previousInput, previousOutput, undefined, everVisible)

		expect(nextOutput).toEqual([first])
	})

	it("hides earlier checkpoints when a later user_message hash arrives", () => {
		const checkpoint = say({ ts: 1, say: "checkpoint_saved", text: "abc" })
		const reply = say({ ts: 2, text: "keep" })
		const everVisible = createEverVisible()
		const previousInput = [checkpoint, reply]
		const previousOutput = filterVisibleMessagesIncremental(previousInput, [], [], undefined, everVisible)
		expect(previousOutput).toEqual([checkpoint, reply])

		const feedback = say({
			ts: 3,
			say: "user_feedback",
			text: "edit",
			checkpoint: { type: "user_message", hash: "abc" } as ClineMessage["checkpoint"],
		})
		const nextOutput = filterVisibleMessagesIncremental(
			[checkpoint, reply, feedback],
			previousInput,
			previousOutput,
			undefined,
			everVisible,
		)

		expect(nextOutput.map((msg) => msg.ts)).toEqual([2, 3])
	})
})
