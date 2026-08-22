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
			runningTasks: [{ taskId: "task-1", cwd: "/repo" }],
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
			runningTasks: [{ taskId: "task-1", cwd: "/repo" }],
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

	test("a busy registry claim occupies the worktree even without a live task", () => {
		const occupants = collectWorkspaceOccupants({
			workspacePath: "/repo/.kilocode/worktrees/feature-x",
			conversations: [],
			runningTasks: [],
			runningSubagents: [],
			workspaces: [workspace()],
			except: { taskId: "task-1" },
		})
		expect(occupants.some((occupant) => occupant.kind === "registry" && occupant.id === "feature-x")).toBe(true)
	})
})
