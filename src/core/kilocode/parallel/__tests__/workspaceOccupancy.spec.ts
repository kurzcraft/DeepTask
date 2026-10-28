import { collectWorkspaceOccupants } from "../workspaceOccupancy"
import type { ParallelConversation, ParallelWorkspace } from "@roo-code/types"

const conversation = (overrides?: Partial<ParallelConversation>): ParallelConversation => ({
	id: "cv-1",
	folderPath: "/repo",
	workspacePath: "/repo",
	sessionId: "task-1",
	title: "first",
	createdAt: 1,
	lastActiveAt: 1,
	...overrides,
})

const workspace = (overrides?: Partial<ParallelWorkspace>): ParallelWorkspace => ({
	name: "feature-x",
	path: "/repo/.kilocode/worktrees/feature-x",
	branch: "deeptask/feature-x",
	baseBranch: "main",
	status: "busy",
	owner: "task:task-2",
	folderPath: "/repo",
	createdAt: 1,
	updatedAt: 1,
	...overrides,
})

describe("collectWorkspaceOccupants", () => {
	test("a later conversation sees a live task already writing the same cwd", () => {
		const occupants = collectWorkspaceOccupants({
			workspacePath: "/repo",
			conversations: [conversation()],
			runningTasks: [{ taskId: "task-1", cwd: "/repo", isStreaming: true }],
			runningSubagents: [],
			workspaces: [],
			except: { conversationId: "cv-new" },
		})
		expect(occupants.map((occupant) => occupant.kind)).toContain("conversation")
		expect(occupants.some((occupant) => occupant.id === "cv-1")).toBe(true)
	})

	test("the current conversation is not counted as occupying itself", () => {
		const occupants = collectWorkspaceOccupants({
			workspacePath: "/repo",
			conversations: [conversation()],
			runningTasks: [{ taskId: "task-1", cwd: "/repo", isStreaming: true }],
			runningSubagents: [],
			workspaces: [],
			except: { taskId: "task-1", conversationId: "cv-1" },
		})
		expect(occupants).toEqual([])
	})

	test("idle conversations without a live task do not occupy the workspace", () => {
		const occupants = collectWorkspaceOccupants({
			workspacePath: "/repo",
			conversations: [conversation()],
			runningTasks: [],
			runningSubagents: [],
			workspaces: [],
			except: { conversationId: "cv-new" },
		})
		expect(occupants).toEqual([])
	})

	test("idle stacked tasks that are not streaming do not occupy the workspace", () => {
		const occupants = collectWorkspaceOccupants({
			workspacePath: "/repo",
			conversations: [conversation()],
			runningTasks: [{ taskId: "task-1", cwd: "/repo", isStreaming: false }],
			runningSubagents: [],
			workspaces: [],
			except: { conversationId: "cv-new" },
		})
		expect(occupants).toEqual([])
	})

	test("a running subagent occupies its worktree path", () => {
		const occupants = collectWorkspaceOccupants({
			workspacePath: "/repo/.kilocode/worktrees/feature-x",
			conversations: [],
			runningTasks: [],
			runningSubagents: [
				{
					sessionId: "sa-1",
					workspacePath: "/repo/.kilocode/worktrees/feature-x",
					workspaceName: "feature-x",
					label: "impl-x",
				},
			],
			workspaces: [workspace()],
		})
		expect(occupants.some((occupant) => occupant.kind === "subagent" && occupant.id === "sa-1")).toBe(true)
	})

	test("a needs_workspace:false (sharedWorkspace) subagent never occupies the parent workspace", () => {
		const occupants = collectWorkspaceOccupants({
			workspacePath: "/repo",
			conversations: [],
			runningTasks: [],
			runningSubagents: [
				{
					sessionId: "sa-ro-1",
					workspacePath: "/repo",
					workspaceName: undefined,
					label: "reader-1",
					sharedWorkspace: true,
				},
			],
			workspaces: [],
		})
		expect(occupants).toEqual([])
	})

	test("the parent conversation stays in its workspace despite multiple read-only children", () => {
		const occupants = collectWorkspaceOccupants({
			workspacePath: "/repo",
			conversations: [conversation()],
			runningTasks: [{ taskId: "task-1", cwd: "/repo", isStreaming: true }],
			runningSubagents: [
				{ sessionId: "sa-ro-1", workspacePath: "/repo", label: "reader-1", sharedWorkspace: true },
				{ sessionId: "sa-ro-2", workspacePath: "/repo", label: "reader-2", sharedWorkspace: true },
			],
			workspaces: [],
			except: { taskId: "task-1", conversationId: "cv-1" },
		})
		expect(occupants).toEqual([])
	})

	test("a leftover busy registry claim does not occupy without a live streaming task", () => {
		const occupants = collectWorkspaceOccupants({
			workspacePath: "/repo/.kilocode/worktrees/feature-x",
			conversations: [],
			runningTasks: [],
			runningSubagents: [],
			workspaces: [workspace()],
			except: { taskId: "task-1" },
		})
		expect(occupants).toEqual([])
	})

	test("a busy registry claim occupies only while its owner is still streaming", () => {
		const occupants = collectWorkspaceOccupants({
			workspacePath: "/repo/.kilocode/worktrees/feature-x",
			conversations: [],
			runningTasks: [
				{
					taskId: "task-2",
					cwd: "/repo/.kilocode/worktrees/feature-x",
					isStreaming: true,
				},
			],
			runningSubagents: [],
			workspaces: [workspace()],
			except: { taskId: "task-1" },
		})
		expect(occupants.some((occupant) => occupant.kind === "registry" && occupant.id === "feature-x")).toBe(true)
	})

	test("a write subagent does not occupy its own assigned worktree", () => {
		const assigned = "/repo/.kilocode/worktrees/928-workspace-routing"
		const occupants = collectWorkspaceOccupants({
			workspacePath: assigned,
			conversations: [],
			runningTasks: [{ taskId: "child-1", cwd: assigned, isStreaming: true }],
			runningSubagents: [
				{
					sessionId: "child-1",
					workspacePath: assigned,
					workspaceName: "928-workspace-routing",
					label: "928-workspace-routing",
				},
			],
			workspaces: [
				workspace({
					name: "928-workspace-routing",
					path: assigned,
					owner: "dispatch:01a1807d-parent",
				}),
			],
			except: { taskId: "child-1" },
		})
		expect(occupants).toEqual([])
	})

	test("a dispatch:<parent> claim does not eject the assigned child from its worktree", () => {
		const assigned = "/repo/.kilocode/worktrees/child-ws"
		const occupants = collectWorkspaceOccupants({
			workspacePath: assigned,
			conversations: [],
			runningTasks: [
				{ taskId: "parent-1", cwd: "/repo", isStreaming: true },
				{ taskId: "child-1", cwd: assigned, isStreaming: true },
			],
			runningSubagents: [
				{
					sessionId: "child-1",
					workspacePath: assigned,
					workspaceName: "child-ws",
					label: "child-ws",
				},
			],
			workspaces: [
				workspace({
					name: "child-ws",
					path: assigned,
					owner: "dispatch:parent-1",
				}),
			],
			except: { taskId: "child-1" },
		})
		expect(occupants).toEqual([])
	})

	test("a second write subagent still occupies a sibling's assigned worktree", () => {
		const assigned = "/repo/.kilocode/worktrees/child-ws"
		const occupants = collectWorkspaceOccupants({
			workspacePath: assigned,
			conversations: [],
			runningTasks: [{ taskId: "child-1", cwd: assigned, isStreaming: true }],
			runningSubagents: [
				{
					sessionId: "child-1",
					workspacePath: assigned,
					workspaceName: "child-ws",
					label: "writer-1",
				},
			],
			workspaces: [
				workspace({
					name: "child-ws",
					path: assigned,
					owner: "dispatch:parent-1",
				}),
			],
			except: { taskId: "child-2" },
		})
		expect(occupants.some((occupant) => occupant.kind === "subagent" && occupant.id === "child-1")).toBe(true)
	})
})
