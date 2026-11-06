// npx vitest core/condense/__tests__/continuity-anchor.spec.ts

import { ApiMessage } from "../../task-persistence/apiMessages"
import {
	buildLocalFallbackSummary,
	extractContinuityAnchor,
	flattenPriorSummary,
	reshapeCondensedApiHistory,
	HOST_TASK_STATE_OPEN,
} from "../index"

const BANNER =
	"[Fast local summary used because the configured condense provider failed: Automatic context condense exceeded its 15 second fast-path budget]"
const PLACEHOLDER =
	"Newest user request, unfinished work, modified files, test results, and acceptance criteria are listed above. Continue that work."
const ANCHOR_STATEMENT =
	"A4 前向已接上，criterion 还要把 loss_a4_aux 纳入汇总。对照 D3 的 yml/watcher 把 A4 配齐后立刻占卡。"

// Exact stale host state persisted in the field export: the "当前阶段" line was
// written when D1 launched, before the model pivoted itself to A4.
const STALE_HOST_STATE = `${HOST_TASK_STATE_OPEN}
当前阶段：D1 已占卡，挂有界 wait 等到 e19 快筛或 100e 完判
- [-] D1 挂有界 wait（三查终态 + fail-fast）阻塞到快筛杀训或 100e 完判
- [-] 用户指令：重新运行 D1 有界等待
</current_task_state>`

// The exact bad summary shape 9.3.3 persisted (field export
// kilo_code_task_nov-6-2026_2-28-34-pm.md ~line 728654): empty Current Work
// with a self-referencing placeholder, banner duplicated, stale host state.
const BAD_PRIOR_SUMMARY = `1. Previous Conversation:
<task>
整理uni-research skill并在实际科研中不断更新你认为正确的套路
</task>

2. Current Work and Recent Decisions:
Assistant: ${PLACEHOLDER} ${BANNER} Newest user request, unfinished work, modified files, test results, and acceptance criteria are listed above. Continue that work. ${BANNER}

[Tool read_file: {"files":[{"path":"LESIN-DEIM/engine/deim/deim_criterion.py"}]}]

3. Continuation State:
${PLACEHOLDER} Do not repeat this summary, any prior opening sentence, or a status mantra as chat.

${BANNER}

${STALE_HOST_STATE}`

describe("continuity anchor across condensation (field 2026-11-06 export shape)", () => {
	it("fallback summary quotes the last assistant statement verbatim and arbitrates it over the stale host state", () => {
		const messages: ApiMessage[] = [
			{ role: "assistant", content: BAD_PRIOR_SUMMARY, ts: 1, isSummary: true },
			{ role: "user", content: "[Tool result: d1 log.txt epoch 12 ok]", ts: 2 },
			{ role: "assistant", content: ANCHOR_STATEMENT, ts: 3 },
		]

		const summary = buildLocalFallbackSummary(messages, "Automatic context condense exceeded its 15 second fast-path budget")

		// The model's own declared next step survives verbatim.
		expect(summary).toContain("Continuity anchor")
		expect(summary).toContain(ANCHOR_STATEMENT)

		// Boilerplate no longer multiplies: exactly one banner, zero placeholders.
		expect(summary.match(/\[Fast local summary/g)?.length).toBe(1)
		expect(summary).not.toContain("are listed above")

		// Host state is kept as a single background copy (not duplicated).
		const opens = summary.match(new RegExp(HOST_TASK_STATE_OPEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))
		expect(opens?.length).toBe(1)

		// Explicit arbitration: the anchor outranks the stale D1 host checklist.
		expect(summary).toContain("continue exactly from the anchor's declared next step")
		expect(summary).toContain("must not override the anchor")
	})

	it("falls back to the newest user instruction only when no assistant statement survived", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "原始任务", ts: 1 },
			{ role: "user", content: "Newest request: rerun the bounded wait", ts: 3 },
		]

		const summary = buildLocalFallbackSummary(messages, "relay down")

		expect(summary).toContain("No assistant statement survived before condensing")
		expect(summary).toContain("Newest request: rerun the bounded wait")
		expect(summary).not.toContain("原始任务")
	})

	it("re-embedding a fixed summary strips its arbitration tail and banner but keeps the quoted anchor", () => {
		const fixedSummary = `1. Previous Conversation:
Background context only. Continue from the current work and host task state, not from this opening request.

2. Current Work and Recent Decisions:
User: [Tool result: d1 log.txt epoch 12 ok]

3. Continuation State:
Continuity anchor (model's last statement before condensing; continue exactly from here):
${ANCHOR_STATEMENT}
Newest user instruction (verbatim; overrides the anchor only if it arrived after the anchor):
[Tool result: d1 log.txt epoch 12 ok]

Arbitration: continue exactly from the anchor's declared next step. An older host checklist snapshot describing an earlier task must not override the anchor. Only a user instruction arriving after the anchor overrides it.

${BANNER}`

		const flattened = flattenPriorSummary(fixedSummary)

		// Anchor quote and labels survive; fixed rule text and banner do not.
		expect(flattened).toContain("Continuity anchor")
		expect(flattened).toContain(ANCHOR_STATEMENT)
		expect(flattened).toContain("Newest user instruction")
		expect(flattened).not.toContain("Arbitration:")
		expect(flattened).not.toContain("[Fast local summary")
		expect(flattened).not.toContain("are listed above")
	})

	it("request-time reshape strips banner and placeholder from an already-persisted bad summary", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "<task>整理uni-research skill</task>", ts: 1 },
			{ role: "assistant", content: BAD_PRIOR_SUMMARY, ts: 2, isSummary: true },
			{ role: "user", content: "继续", ts: 3 },
		]

		const reshaped = reshapeCondensedApiHistory(messages)
		const summaryText =
			typeof reshaped[1].content === "string"
				? reshaped[1].content
				: reshaped[1].content.map((block) => (block.type === "text" ? block.text : "")).join("\n")

		expect(summaryText).not.toContain("[Fast local summary")
		expect(summaryText).not.toContain("are listed above")
		// Reshape's contract (locked by reshape-condensed-history.spec.ts): the
		// summary body loses the host block; hostState is relocated verbatim into
		// the last user turn after the summary so providers read it as live state.
		expect(summaryText).not.toContain(HOST_TASK_STATE_OPEN)
		expect(String(reshaped[2].content)).toContain(HOST_TASK_STATE_OPEN)
		expect(String(reshaped[2].content)).toContain("D1 已占卡")
		expect(typeof reshaped[0].content === "string" ? reshaped[0].content : "").toContain("Background context only")
	})

	// Field 2026-11-06 15:59 export (kilo_code_task_nov-6-2026_3-59-36-pm.md):
	// r4 searched only messagesToSummarize. The discarded half ended on a D1
	// tool_use; the live A4 statement lived in keep. getApiMessageText drops
	// tool_use, so the anchor was empty and Current Work recopied the D1 tool.
	const A4_KEEP_STATEMENT =
		"先确认 backbone 输出通道和 enhance_losses 抽取路径，再把 A4 的 criterion/yml/启动脚本一次配齐。"
	const d1ToolUse: ApiMessage = {
		role: "assistant",
		content: [
			{
				type: "tool_use",
				id: "toolu_d1",
				name: "read_file",
				input: {
					files: [
						{ path: "LESIN-DEIM/engine/deim/deim_criterion.py", lineRanges: [{ start: 70, end: 90 }] },
						{ path: "LESIN-DEIM/configs/deim_dfine/deim_hgnetv2_s_coco_lite_hvi_std32_d3_consist_100e.yml" },
						{ path: "EXTRA/bash/d3_watch_and_replay.sh" },
					],
				},
			},
		],
		ts: 2,
	}
	const discardedHalf: ApiMessage[] = [
		{ role: "user", content: "<task>整理uni-research skill并在实际科研中不断更新</task>", ts: 1 },
		d1ToolUse,
		{ role: "user", content: "[Tool result: File: LESIN-DEIM/engine/deim/deim_criterion.py enable_d1_illum_weight]", ts: 3 },
	]
	const keepWindow: ApiMessage[] = [{ role: "assistant", content: A4_KEEP_STATEMENT, ts: 4 }]
	const liveHistory: ApiMessage[] = [...discardedHalf, ...keepWindow]

	it("r4 regression: searching only the discarded half finds no prose and recopies the D1 tool", () => {
		const discardedOnly = extractContinuityAnchor(discardedHalf)
		expect(discardedOnly.text).toContain("deim_criterion.py")
		expect(discardedOnly.text).not.toContain(A4_KEEP_STATEMENT)

		const r4Summary = buildLocalFallbackSummary(
			discardedHalf,
			"Automatic context condense exceeded its 15 second fast-path budget",
		)
		// Without liveHistory the tool_use fallback still fires, so the
		// summary has a Continuity anchor — but it is the discarded D1
		// tool, not the keep-window A4 statement (field 15:59).
		expect(r4Summary).toContain("Continuity anchor")
		expect(r4Summary).toContain("deim_criterion.py")
		expect(r4Summary).not.toContain(A4_KEEP_STATEMENT)
		expect(r4Summary).not.toContain("No assistant statement survived")
	})

	it("anchors Current Work on the keep-window A4 statement, not the discarded D1 tool_use", () => {
		const liveAnchor = extractContinuityAnchor(liveHistory)
		expect(liveAnchor.text).toContain(A4_KEEP_STATEMENT)

		const summary = buildLocalFallbackSummary(
			discardedHalf,
			"Automatic context condense exceeded its 15 second fast-path budget",
			liveHistory,
		)

		expect(summary).toContain("Continuity anchor")
		expect(summary).toContain(A4_KEEP_STATEMENT)
		expect(summary).toContain("2. Current Work and Recent Decisions:\n" + A4_KEEP_STATEMENT)
		expect(summary).not.toContain("No assistant statement survived")
		expect(summary).not.toContain("deim_criterion.py")
		expect(summary).not.toContain("d3_watch_and_replay")
		expect(summary).not.toContain("<task>")
	})

	it("falls back to the last tool_use as the declared step when keep has no prose", () => {
		const a4Tool: ApiMessage = {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "toolu_a4",
					name: "read_file",
					input: { files: [{ path: "LESIN-DEIM/engine/deim/enhance_losses.py" }] },
				},
			],
			ts: 5,
		}
		const live = [...discardedHalf, a4Tool]
		const summary = buildLocalFallbackSummary(discardedHalf, "relay down", live)
		expect(summary).toContain("Continuity anchor")
		expect(summary).toContain("enhance_losses.py")
		expect(summary).not.toContain("deim_criterion.py")
		expect(summary).not.toContain("No assistant statement survived")
	})
})
