import { resolveParallelSelectTarget } from "../resolveParallelSelect"
import type { ParallelConversation, ParallelSession } from "@roo-code/types"

const conversation = (overrides?: Partial<ParallelConversation>): ParallelConversation => ({
	id: "cv-sa",
	folderPath: "/repo",
	workspacePath: "/repo/.kilocode/worktrees/sa",
	title: "subagent-term-a",
	sessionId: "sa-1",
	createdAt: 1,
	lastActiveAt: 1,
	...overrides,
})

const session = (overrides?: Partial<ParallelSession>): ParallelSession => ({
	sessionId: "sa-1",
	taskId: "sa-1",
	parentTaskId: "parent-1",
	label: "subagent-term-a",
	task: "write a file",
	status: "running",
	startedAt: 1,
	...overrides,
})

describe("resolveParallelSelectTarget", () => {
	test("opens a live subagent conversation in the main chat", () => {
		expect(resolveParallelSelectTarget("cv:cv-sa", [conversation()], [session()])).toEqual({
			kind: "conversation",
			targetId: "cv-sa",
		})
	})

	test("selects a finished conversation without a live session", () => {
		expect(resolveParallelSelectTarget("cv:cv-1", [conversation({ id: "cv-1", sessionId: "task-1" })], [])).toEqual({
			kind: "conversation",
			targetId: "cv-1",
		})
	})
})
