import { describe, it, expect, vi } from "vitest"
import { parseMarkdownChecklist, updateTodoListTool } from "../UpdateTodoListTool"
import { TodoItem } from "@roo-code/types"
import { Task } from "../../task/Task"

describe("updateTodoListTool", () => {
	it("rejects an all-completed checklist during a new feedback work turn", async () => {
		const pushToolResult = vi.fn()
		const task = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			normalizeTodoListForActiveContinuation: vi.fn((todos: TodoItem[]) => todos),
			syncTaskProgressWithTodoList: vi.fn().mockResolvedValue(undefined),
			shouldRequireProgressListExpansion: vi.fn().mockReturnValue(true),
			hasActionableProgressListForContinuation: vi.fn().mockReturnValue(false),
			markProgressListExpandedForContinuation: vi.fn(),
		} as unknown as Task

		await updateTodoListTool.execute({ todos: "[x] 研究问题本质\n[x] 汇总安装位置、skill 内容和测试结论" }, task, {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult,
			removeClosingTag: vi.fn(),
			toolProtocol: "xml",
		})

		expect(task.normalizeTodoListForActiveContinuation).not.toHaveBeenCalled()
		expect(task.markProgressListExpandedForContinuation).not.toHaveBeenCalled()
		expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("new user work turn"))
	})

	it("returns a model-visible synchronization error without updating native state", async () => {
		const pushToolResult = vi.fn()
		const handleError = vi.fn()
		const task = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			normalizeTodoListForActiveContinuation: vi.fn((todos: TodoItem[]) => todos),
			syncTaskProgressWithTodoList: vi
				.fn()
				.mockRejectedValue(new Error("No verified task progress file for host task host-1")),
			shouldRequireProgressListExpansion: vi.fn().mockReturnValue(false),
			hasActionableProgressListForContinuation: vi.fn().mockReturnValue(true),
			markProgressListExpandedForContinuation: vi.fn(),
		} as unknown as Task

		await updateTodoListTool.execute({ todos: "[-] 写入权威任务文件" }, task, {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError,
			pushToolResult,
			removeClosingTag: vi.fn(),
			toolProtocol: "xml",
		})

		expect(pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Task progress synchronization failed: No verified task progress file"),
		)
		expect(task.recordToolError).toHaveBeenCalledWith("update_todo_list")
		expect(task.didToolFailInCurrentTurn).toBe(true)
		expect(task.markProgressListExpandedForContinuation).not.toHaveBeenCalled()
		expect(handleError).not.toHaveBeenCalled()
	})

	it("writes concrete milestones to the task file before synchronizing the native list", async () => {
		const pushToolResult = vi.fn()
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const task = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			normalizeTodoListForActiveContinuation: vi.fn((todos: TodoItem[]) => todos),
			providerRef: { deref: () => ({ postStateToWebview }) },
			todoList: [{ id: "old", content: "previous native state", status: "completed" }],
			syncTaskProgressWithTodoList: vi.fn().mockImplementation(async (todos: TodoItem[]) => {
				expect((task as any).todoList).toEqual([
					{ id: "old", content: "previous native state", status: "completed" },
				])
				expect(todos).toEqual([
					{ id: expect.any(String), content: "修复反馈路由", status: "in_progress" },
					{ id: expect.any(String), content: "验证新任务响应", status: "pending" },
				])
			}),
			shouldRequireProgressListExpansion: vi.fn().mockReturnValue(true),
			hasActionableProgressListForContinuation: vi.fn().mockReturnValue(true),
			markProgressListExpandedForContinuation: vi.fn(),
			ask: undefined,
		} as unknown as Task

		await updateTodoListTool.execute({ todos: "[-] 修复反馈路由\n[ ] 验证新任务响应" }, task, {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult,
			removeClosingTag: vi.fn(),
			toolProtocol: "xml",
		})

		expect(task.syncTaskProgressWithTodoList).toHaveBeenCalledOnce()
		expect(task.markProgressListExpandedForContinuation).toHaveBeenCalled()
		expect(postStateToWebview).toHaveBeenCalledOnce()
		expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Todo list updated successfully"))
	})
})

describe("parseMarkdownChecklist", () => {
	describe("standard checkbox format (without dash prefix)", () => {
		it("should parse pending tasks", () => {
			const md = `[ ] Task 1
[ ] Task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Task 1")
			expect(result[0].status).toBe("pending")
			expect(result[1].content).toBe("Task 2")
			expect(result[1].status).toBe("pending")
		})

		it("should parse completed tasks with lowercase x", () => {
			const md = `[x] Completed task 1
[x] Completed task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Completed task 1")
			expect(result[0].status).toBe("completed")
			expect(result[1].content).toBe("Completed task 2")
			expect(result[1].status).toBe("completed")
		})

		it("should parse completed tasks with uppercase X", () => {
			const md = `[X] Completed task 1
[X] Completed task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Completed task 1")
			expect(result[0].status).toBe("completed")
			expect(result[1].content).toBe("Completed task 2")
			expect(result[1].status).toBe("completed")
		})

		it("should parse in-progress tasks with dash", () => {
			const md = `[-] In progress task 1
[-] In progress task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("In progress task 1")
			expect(result[0].status).toBe("in_progress")
			expect(result[1].content).toBe("In progress task 2")
			expect(result[1].status).toBe("in_progress")
		})

		it("should parse in-progress tasks with tilde", () => {
			const md = `[~] In progress task 1
[~] In progress task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("In progress task 1")
			expect(result[0].status).toBe("in_progress")
			expect(result[1].content).toBe("In progress task 2")
			expect(result[1].status).toBe("in_progress")
		})
	})

	describe("dash-prefixed checkbox format", () => {
		it("should parse pending tasks with dash prefix", () => {
			const md = `- [ ] Task 1
- [ ] Task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Task 1")
			expect(result[0].status).toBe("pending")
			expect(result[1].content).toBe("Task 2")
			expect(result[1].status).toBe("pending")
		})

		it("should parse completed tasks with dash prefix and lowercase x", () => {
			const md = `- [x] Completed task 1
- [x] Completed task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Completed task 1")
			expect(result[0].status).toBe("completed")
			expect(result[1].content).toBe("Completed task 2")
			expect(result[1].status).toBe("completed")
		})

		it("should parse completed tasks with dash prefix and uppercase X", () => {
			const md = `- [X] Completed task 1
- [X] Completed task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Completed task 1")
			expect(result[0].status).toBe("completed")
			expect(result[1].content).toBe("Completed task 2")
			expect(result[1].status).toBe("completed")
		})

		it("should parse in-progress tasks with dash prefix and dash marker", () => {
			const md = `- [-] In progress task 1
- [-] In progress task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("In progress task 1")
			expect(result[0].status).toBe("in_progress")
			expect(result[1].content).toBe("In progress task 2")
			expect(result[1].status).toBe("in_progress")
		})

		it("preserves four-space checklist hierarchy as todo depth", () => {
			const md = ["- [-] Parent task", "    - [x] Child task", "        - [ ] Grandchild task"].join("\n")
			const result = parseMarkdownChecklist(md)

			expect(result).toMatchObject([
				{ content: "Parent task", status: "in_progress" },
				{ content: "Child task", status: "completed", depth: 1 },
				{ content: "Grandchild task", status: "pending", depth: 2 },
			])
			expect(result[0]).not.toHaveProperty("depth")
		})

		it("should parse in-progress tasks with dash prefix and tilde marker", () => {
			const md = `- [~] In progress task 1
- [~] In progress task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("In progress task 1")
			expect(result[0].status).toBe("in_progress")
			expect(result[1].content).toBe("In progress task 2")
			expect(result[1].status).toBe("in_progress")
		})
	})

	describe("mixed formats", () => {
		it("should parse mixed formats correctly", () => {
			const md = `[ ] Task without dash
- [ ] Task with dash
[x] Completed without dash
- [X] Completed with dash
[-] In progress without dash
- [~] In progress with dash`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(6)

			expect(result[0].content).toBe("Task without dash")
			expect(result[0].status).toBe("pending")

			expect(result[1].content).toBe("Task with dash")
			expect(result[1].status).toBe("pending")

			expect(result[2].content).toBe("Completed without dash")
			expect(result[2].status).toBe("completed")

			expect(result[3].content).toBe("Completed with dash")
			expect(result[3].status).toBe("completed")

			expect(result[4].content).toBe("In progress without dash")
			expect(result[4].status).toBe("in_progress")

			expect(result[5].content).toBe("In progress with dash")
			expect(result[5].status).toBe("in_progress")
		})
	})

	describe("edge cases", () => {
		it("should handle empty strings", () => {
			const result = parseMarkdownChecklist("")
			expect(result).toEqual([])
		})

		it("should handle non-string input", () => {
			const result = parseMarkdownChecklist(null as any)
			expect(result).toEqual([])
		})

		it("should handle undefined input", () => {
			const result = parseMarkdownChecklist(undefined as any)
			expect(result).toEqual([])
		})

		it("should ignore non-checklist lines", () => {
			const md = `This is not a checklist
[ ] Valid task
Just some text
- Not a checklist item
- [x] Valid completed task
[not valid] Invalid format`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Valid task")
			expect(result[0].status).toBe("pending")
			expect(result[1].content).toBe("Valid completed task")
			expect(result[1].status).toBe("completed")
		})

		it("should handle extra spaces", () => {
			const md = `  [ ]   Task with spaces  
-  [ ]  Task with dash and spaces
  [x]  Completed with spaces
-   [X]   Completed with dash and spaces`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(4)
			expect(result[0].content).toBe("Task with spaces")
			expect(result[1].content).toBe("Task with dash and spaces")
			expect(result[2].content).toBe("Completed with spaces")
			expect(result[3].content).toBe("Completed with dash and spaces")
		})

		it("should handle Windows line endings", () => {
			const md = "[ ] Task 1\r\n- [x] Task 2\r\n[-] Task 3"
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(3)
			expect(result[0].content).toBe("Task 1")
			expect(result[0].status).toBe("pending")
			expect(result[1].content).toBe("Task 2")
			expect(result[1].status).toBe("completed")
			expect(result[2].content).toBe("Task 3")
			expect(result[2].status).toBe("in_progress")
		})
	})

	describe("ID generation", () => {
		it("should generate consistent IDs for the same content and status", () => {
			const md1 = `[ ] Task 1
[x] Task 2`
			const md2 = `[ ] Task 1
[x] Task 2`
			const result1 = parseMarkdownChecklist(md1)
			const result2 = parseMarkdownChecklist(md2)

			expect(result1[0].id).toBe(result2[0].id)
			expect(result1[1].id).toBe(result2[1].id)
		})

		it("should generate different IDs for different content", () => {
			const md = `[ ] Task 1
[ ] Task 2`
			const result = parseMarkdownChecklist(md)
			expect(result[0].id).not.toBe(result[1].id)
		})

		it("should generate different IDs for same content but different status", () => {
			const md = `[ ] Task 1
[x] Task 1`
			const result = parseMarkdownChecklist(md)
			expect(result[0].id).not.toBe(result[1].id)
		})

		it("should generate same IDs regardless of dash prefix", () => {
			const md1 = `[ ] Task 1`
			const md2 = `- [ ] Task 1`
			const result1 = parseMarkdownChecklist(md1)
			const result2 = parseMarkdownChecklist(md2)
			expect(result1[0].id).toBe(result2[0].id)
		})
	})
})
