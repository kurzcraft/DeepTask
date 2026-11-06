import { describe, expect, it } from "vitest"

import {
	HOST_TASK_STATE_CLOSE,
	HOST_TASK_STATE_OPEN,
	reshapeCondensedApiHistory,
	upsertHostTaskState,
} from "../index"
import type { ApiMessage } from "../../task-persistence/apiMessages"

const hostState = `${HOST_TASK_STATE_OPEN}
Newest user instruction: 压缩后要连续进度，但不压缩时每次开头不要重复
- [-] reshape condensed API payload so the original task is background only
${HOST_TASK_STATE_CLOSE}`

describe("reshapeCondensedApiHistory", () => {
	it("is a no-op when there is no summary so uncompressed turns do not repeat an opening recap", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "修复长对话内存溢出插件灰屏", ts: 1 },
			{ role: "assistant", content: "working", ts: 2 },
			{ role: "user", content: "continue", ts: 3 },
		]

		expect(reshapeCondensedApiHistory(messages)).toEqual(messages)
	})

	it("turns the original first task into a background stub after condensation", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "修复长对话内存溢出插件灰屏", ts: 1 },
			{
				role: "assistant",
				content: upsertHostTaskState("1. Previous Conversation:\nOld recap", hostState),
				isSummary: true,
				ts: 2,
			},
			{ role: "user", content: "continue the current milestone", ts: 3 },
		]

		const reshaped = reshapeCondensedApiHistory(messages)
		expect(reshaped[0].content).toBe(
			"Background context only. Continue from the current work and host task state, not from this opening request.",
		)
		expect(reshaped[0].content).not.toContain("修复长对话内存溢出")
	})

	it("moves host task state onto the last keep-window user message", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "original task", ts: 1 },
			{
				role: "assistant",
				content: upsertHostTaskState("Summary recap", hostState),
				isSummary: true,
				ts: 2,
			},
			{ role: "assistant", content: "tool call", ts: 3 },
			{ role: "user", content: "latest keep-window user turn", ts: 4 },
		]

		const reshaped = reshapeCondensedApiHistory(messages)
		const lastUser = reshaped[reshaped.length - 1]
		expect(lastUser.role).toBe("user")
		expect(lastUser.content).toContain("latest keep-window user turn")
		expect(lastUser.content).toContain(HOST_TASK_STATE_OPEN)
		expect(lastUser.content).toContain("压缩后要连续进度")
		expect(reshaped.find((message) => message.isSummary)?.content).not.toContain(HOST_TASK_STATE_OPEN)
	})

	it("strips a persisted local-fallback <task> dump from the summary at request time", () => {
		const opening = `<task>
整理uni-research skill并在实际科研中不断更新你认为正确的套路,梳理研究的核心方法论
</task>
[Environment details omitted]`
		const persistedSummary = upsertHostTaskState(
			`1. Previous Conversation:\n${opening}\n\n2. Current Work and Recent Decisions:\n\n3. Continuation State:\nNewest user request, unfinished work, modified files, test results, and acceptance criteria are listed above. Continue that work.`,
			hostState,
		)
		const messages: ApiMessage[] = [
			{ role: "user", content: opening, ts: 1 },
			{ role: "assistant", content: persistedSummary, isSummary: true, ts: 2 },
			{ role: "user", content: "重新运行一下等待命令", ts: 3 },
		]

		const reshaped = reshapeCondensedApiHistory(messages)
		const summaryText = String(reshaped.find((message) => message.isSummary)?.content ?? "")
		expect(reshaped[0].content).toContain("Background context only")
		expect(summaryText).not.toContain("<task>")
		expect(summaryText).not.toContain("整理uni-research skill")
		expect(summaryText).not.toContain(HOST_TASK_STATE_OPEN)
		expect(String(reshaped[reshaped.length - 1].content)).toContain("重新运行一下等待命令")
		expect(String(reshaped[reshaped.length - 1].content)).toContain(HOST_TASK_STATE_OPEN)
	})

	it("inserts host task state after the summary when the keep window has no user turn", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "original task", ts: 1 },
			{
				role: "assistant",
				content: upsertHostTaskState("Summary recap", hostState),
				isSummary: true,
				ts: 2,
			},
			{ role: "assistant", content: "tool tail", ts: 3 },
		]

		const reshaped = reshapeCondensedApiHistory(messages)
		expect(reshaped[0].content).toContain("Background context only")
		expect(reshaped[1].isSummary).toBe(true)
		expect(reshaped[2].role).toBe("user")
		expect(reshaped[2].content).toContain(HOST_TASK_STATE_OPEN)
		expect(reshaped[3].content).toBe("tool tail")
	})
})
