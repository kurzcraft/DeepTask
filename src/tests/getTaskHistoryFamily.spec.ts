// kilocode_change - new file
// DEFECT W regression: subagent history items must survive workspace filters
// via family adoption, and pagination must keep families together.
import { describe, expect, it } from "vitest"

import type { HistoryItem, TaskHistoryRequestPayload } from "@roo-code/types"

import { getTaskHistory } from "../shared/kilocode/getTaskHistory"

const makeItem = (overrides: Partial<HistoryItem> & { id: string }): HistoryItem =>
	({
		ts: 1_000,
		task: `task-${overrides.id}`,
		number: 1,
		tokensIn: 0,
		tokensOut: 0,
		cacheWrites: 0,
		cacheReads: 0,
		totalCost: 0,
		size: 0,
		workspace: "/ws/main",
		...overrides,
	}) as HistoryItem

const req = (overrides: Partial<TaskHistoryRequestPayload> = {}): TaskHistoryRequestPayload => ({
	requestId: "req",
	workspace: "all",
	sort: "newest",
	favoritesOnly: false,
	pageIndex: 0,
	...overrides,
})

describe("getTaskHistory family adoption (DEFECT W)", () => {
	it("keeps a subagent whose worktree workspace was cleaned up when its parent matches the filter", () => {
		const parent = makeItem({ id: "parent-1", ts: 2000, workspace: "/repo" })
		const child = makeItem({
			id: "child-1",
			ts: 2100,
			parentTaskId: "parent-1",
			rootTaskId: "parent-1",
			workspace: "/repo/.kilocode/worktrees/child-1",
		})

		const result = getTaskHistory([parent, child], "/somewhere", req({ workspacePaths: ["/repo"] }))

		expect(result.historyItems.map((i) => i.id)).toContain("child-1")
	})

	it("drops a subagent whose family matches nothing", () => {
		const stranger = makeItem({ id: "stranger", ts: 100, workspace: "/other" })
		const orphan = makeItem({ id: "orphan", ts: 150, parentTaskId: "missing", workspace: "/gone" })

		const result = getTaskHistory([stranger, orphan], "/repo", req({ workspacePaths: ["/repo"] }))

		expect(result.historyItems.map((i) => i.id)).toEqual([])
	})

	it("keeps a subagent under the current-cwd filter when the parent runs in cwd", () => {
		const parent = makeItem({ id: "p", ts: 5000, workspace: "/repo" })
		const child = makeItem({ id: "c", ts: 5100, parentTaskId: "p", workspace: "/repo/.kilocode/worktrees/c" })

		const result = getTaskHistory([parent, child], "/repo", req({ workspace: "current" }))

		expect(result.historyItems.map((i) => i.id).sort()).toEqual(["c", "p"])
	})

	it("paginates by family so a parent and its subagents land on the same page", () => {
		const items: HistoryItem[] = []
		for (let i = 0; i < 12; i++) {
			items.push(makeItem({ id: `root-${i}`, ts: 10_000 - i * 10, workspace: "/repo" }))
		}
		const parentOnPage2 = items[0] // newest → first family on page 1
		items.push(makeItem({ id: "kid-a", ts: 9_999, parentTaskId: parentOnPage2.id, workspace: "/repo" }))
		items.push(makeItem({ id: "kid-b", ts: 9_998, parentTaskId: parentOnPage2.id, workspace: "/repo" }))

		const result = getTaskHistory(items, "/repo", req())

		// Page 0 must contain the family head AND both kids together.
		const page0 = result.historyItems.map((i) => i.id)
		expect(page0).toContain(parentOnPage2.id)
		expect(page0).toContain("kid-a")
		expect(page0).toContain("kid-b")
		// totalItems counts every task (families included).
		expect(result.totalItems).toBe(14)
	})

	it("adopted subagents do not duplicate when both child and parent match the filter", () => {
		const parent = makeItem({ id: "pp", ts: 7000, workspace: "/repo" })
		const child = makeItem({ id: "cc", ts: 7100, parentTaskId: "pp", workspace: "/repo" })

		const result = getTaskHistory([parent, child], "/repo", req({ workspacePaths: ["/repo"] }))

		const ids = result.historyItems.map((i) => i.id)
		expect(ids.filter((id) => id === "cc")).toHaveLength(1)
	})

	// kilocode_change start: DEFECT W3b — family floats to top by latest member activity.
	it("floats a family to the top by its most recent member when the parent is old (DEFECT W3b)", () => {
		const parent = makeItem({ id: "old-parent", ts: 2000, workspace: "/repo" })
		const child = makeItem({
			id: "fresh-child",
			ts: 9000,
			parentTaskId: "old-parent",
			workspace: "/repo/.kilocode/worktrees/fresh-child",
		})
		const independentOlderThanChild = makeItem({ id: "mid-task", ts: 8000, workspace: "/repo" })
		const independentOldest = makeItem({ id: "old-task", ts: 5000, workspace: "/repo" })

		const result = getTaskHistory(
			[parent, child, independentOlderThanChild, independentOldest],
			"/repo",
			req({ workspace: "current" }),
		)

		// Family key = max(parent.ts, child.ts) = 9000 → family ranks above mid-task(8000).
		expect(result.historyItems.map((i) => i.id)).toEqual(["old-parent", "fresh-child", "mid-task", "old-task"])
		// Family head stays first within the family group even though child is newer.
		expect(result.historyItems[0]?.id).toBe("old-parent")
	})
	// kilocode_change end
})
