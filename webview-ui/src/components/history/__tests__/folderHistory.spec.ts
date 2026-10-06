import { describe, expect, it } from "vitest"

import type { HistoryItem, ParallelConversation, ParallelWorkspace } from "@roo-code/types"

import { filterHistoryToFolder, groupHistoryByWorkspace } from "../folderHistory"

const item = (id: string, overrides: Partial<HistoryItem> = {}): HistoryItem =>
	({
		id,
		ts: 1700000000000,
		task: `task ${id}`,
		taskNumber: 1,
		workspace: "/repo",
		...overrides,
	}) as HistoryItem

const workspace = (path: string, name: string, folderPath: string): ParallelWorkspace =>
	({ path, name, folderPath }) as ParallelWorkspace

// kilocode_change: DEFECT W2 regression specs — subagent history must stay
// visible under its parent even after the isolated worktree workspace (and
// its conversation) has been cleaned up.
describe("filterHistoryToFolder (DEFECT W2 family adoption)", () => {
	it("keeps a subagent whose worktree workspace was cleaned up when its parent matches", () => {
		const parent = item("parent-1", { workspace: "/repo" })
		const child = item("child-1", {
			workspace: "/repo/.kilocode/worktrees/writer-1",
			parentTaskId: "parent-1",
			rootTaskId: "parent-1",
		})
		const items = [parent, child]
		const conversations: ParallelConversation[] = [
			{ id: "c-main", sessionId: "parent-1", folderPath: "/repo" } as ParallelConversation,
		]
		const workspacePaths = new Set<string>(["/repo"])
		const filtered = filterHistoryToFolder(items, conversations, workspacePaths)
		expect(filtered.map((i) => i.id)).toEqual(["parent-1", "child-1"])
	})

	it("keeps an orphaned subagent whose root task matches via rootTaskId", () => {
		const root = item("root-1", { workspace: "/repo" })
		const child = item("child-2", {
			workspace: "/repo/.kilocode/worktrees/reader-1",
			parentTaskId: "missing-parent",
			rootTaskId: "root-1",
		})
		const filtered = filterHistoryToFolder([root, child], [], new Set(["/repo"]))
		expect(filtered.map((i) => i.id)).toContain("child-2")
	})

	it("drops an unrelated task from another folder", () => {
		const stranger = item("stranger-1", { workspace: "/other" })
		const parent = item("parent-2", { workspace: "/repo" })
		const filtered = filterHistoryToFolder([stranger, parent], [], new Set(["/repo"]))
		expect(filtered.map((i) => i.id)).toEqual(["parent-2"])
	})
})

// kilocode_change: DEFECT W2 — while the worktree workspace is still alive,
// grouping by the item's own workspace tore the dispatch tree apart; the
// subagent must follow its family head's group.
describe("groupHistoryByWorkspace (DEFECT W2 family grouping)", () => {
	it("groups a running worktree subagent with its parent in the main group", () => {
		const parent = item("parent-3", { workspace: "/repo" })
		const child = item("child-3", {
			workspace: "/repo/.kilocode/worktrees/writer-2",
			parentTaskId: "parent-3",
		})
		const workspaces = [workspace("/repo/.kilocode/worktrees/writer-2", "writer-2", "/repo")]
		const groups = groupHistoryByWorkspace({
			folderPath: "/repo",
			folderTasks: [parent, child],
			folderConversations: [],
			workspaces,
			mainLabel: "Main",
		})
		const main = groups.find((g) => g.key === "main")
		expect(main?.items.map((i) => i.id).sort()).toEqual(["child-3", "parent-3"])
	})

	it("still groups a plain worktree-own task into its workspace group when it has no parent", () => {
		const solo = item("solo-1", { workspace: "/repo/.kilocode/worktrees/research" })
		const workspaces = [workspace("/repo/.kilocode/worktrees/research", "research", "/repo")]
		const groups = groupHistoryByWorkspace({
			folderPath: "/repo",
			folderTasks: [solo],
			folderConversations: [],
			workspaces,
			mainLabel: "Main",
		})
		expect(groups.find((g) => g.key === "research")?.items.map((i) => i.id)).toEqual(["solo-1"])
	})
})
