import {
	resolveAssignedWorkspacePath,
	resolveTaskToolWorkspace,
	workspaceBindingDrifted,
} from "../taskWorkspaceRouting"

describe("taskWorkspaceRouting", () => {
	const assigned = "/repo/.kilocode/worktrees/928-workspace-routing"
	const parent = "/repo"
	const uiFocus = "/repo/.kilocode/worktrees/other-focus"

	test("in-process write subagent tools use the dispatch-assigned worktree", () => {
		expect(
			resolveTaskToolWorkspace({
				taskId: "child-1",
				isSubagent: true,
				taskCwd: assigned,
				sessionWorkspacePath: assigned,
				conversationWorkspacePath: assigned,
				historyWorkspace: parent,
				providerCwd: uiFocus,
				parentCwd: parent,
			}),
		).toBe(assigned)
	})

	test("fork child config workspace wins over parent and UI cwd", () => {
		expect(
			resolveAssignedWorkspacePath({
				taskId: "fork-child",
				isSubagent: true,
				taskCwd: parent,
				sessionWorkspacePath: assigned,
				historyWorkspace: parent,
				providerCwd: parent,
				parentCwd: parent,
			}),
		).toBe(assigned)
	})

	test("restore/focus does not fall back to history parent cwd or UI focus", () => {
		expect(
			resolveAssignedWorkspacePath({
				taskId: "child-1",
				isSubagent: true,
				taskCwd: parent,
				historyWorkspace: parent,
				sessionWorkspacePath: assigned,
				conversationWorkspacePath: assigned,
				providerCwd: uiFocus,
				parentCwd: parent,
			}),
		).toBe(assigned)
		expect(workspaceBindingDrifted(parent, assigned)).toBe(true)
		expect(workspaceBindingDrifted(assigned, assigned)).toBe(false)
	})

	test("a write subagent never falls back to provider.cwd", () => {
		expect(
			resolveAssignedWorkspacePath({
				taskId: "child-1",
				isSubagent: true,
				providerCwd: parent,
				parentCwd: parent,
			}),
		).toBeUndefined()
		expect(
			resolveTaskToolWorkspace({
				taskId: "child-1",
				isSubagent: true,
				taskCwd: assigned,
				providerCwd: uiFocus,
				parentCwd: parent,
			}),
		).toBe(assigned)
	})

	test("shared read-only (non-subagent / parent) may use provider cwd", () => {
		expect(
			resolveAssignedWorkspacePath({
				isSubagent: false,
				providerCwd: parent,
			}),
		).toBe(parent)
	})
})
