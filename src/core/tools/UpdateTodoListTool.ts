import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import cloneDeep from "clone-deep"
import crypto from "crypto"
import { TodoItem, TodoStatus, todoStatusSchema } from "@roo-code/types"
import { getLatestTodo } from "../../shared/todo"

interface BindTaskProgressParams {
	path?: string
}

let approvedTodoList: TodoItem[] | undefined = undefined

export class BindTaskProgressTool extends BaseTool<"bind_task_progress"> {
	readonly name = "bind_task_progress" as const

	parseLegacy(params: Partial<Record<string, string>>): BindTaskProgressParams {
		return {
			path: params.path?.trim() || undefined,
		}
	}

	async execute(params: BindTaskProgressParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult, handleError, askApproval } = callbacks
		const requestedPath = params.path?.trim() || undefined

		try {
			let boundTodos: TodoItem[]
			try {
				boundTodos = await task.bindTaskProgressFile(requestedPath)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				task.consecutiveMistakeCount++
				task.recordToolError("bind_task_progress")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(`Task progress binding failed: ${message}`))
				return
			}

			const { valid, error } = validateTodos(boundTodos)
			if (!valid) {
				task.consecutiveMistakeCount++
				task.recordToolError("bind_task_progress")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(error || "bound checklist validation failed"))
				return
			}

			let normalizedTodos: TodoItem[] = boundTodos.map((t) => ({
				id: t.id,
				content: t.content,
				status: normalizeStatus(t.status),
				...(t.depth ? { depth: t.depth } : {}),
			}))
			const requiresActionableExpansion = task.shouldRequireProgressListExpansion()
			const requestedAllCompleted =
				normalizedTodos.length > 0 && normalizedTodos.every((todo) => todo.status === "completed")
			if (requiresActionableExpansion && requestedAllCompleted) {
				pushToolResult(
					formatResponse.toolError(
						"This is a new user work turn. An all-completed checklist is not a new task. Write concrete unfinished milestones into the EXTRA/task Markdown first, then call bind_task_progress.",
					),
				)
				return
			}
			const hasActionableExpansion =
				!requiresActionableExpansion || task.hasActionableProgressListForContinuation(normalizedTodos)

			const approvalMsg = JSON.stringify({
				tool: "updateTodoList",
				todos: normalizedTodos,
			})

			approvedTodoList = cloneDeep(normalizedTodos)
			const didApprove = await askApproval("tool", approvalMsg)
			if (!didApprove) {
				pushToolResult("User declined to bind the task progress file.")
				return
			}

			const isTodoListChanged =
				approvedTodoList !== undefined && JSON.stringify(normalizedTodos) !== JSON.stringify(approvedTodoList)
			if (isTodoListChanged) {
				normalizedTodos = approvedTodoList ?? []
				task.say(
					"user_edit_todos",
					JSON.stringify({
						tool: "updateTodoList",
						todos: normalizedTodos,
					}),
				)
			}

			let synchronizedTodos: TodoItem[]
			try {
				synchronizedTodos = await setTodoListForTask(task, normalizedTodos)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				task.consecutiveMistakeCount++
				task.recordToolError("bind_task_progress")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(`Task progress synchronization failed: ${message}`))
				return
			}
			task.markProgressListExpandedForContinuation(synchronizedTodos)

			if (isTodoListChanged) {
				pushToolResult(formatResponse.toolResult("User edits todo:\n\n" + todoListToMarkdown(normalizedTodos)))
			} else if (requiresActionableExpansion && !hasActionableExpansion) {
				pushToolResult(
					formatResponse.toolError(
						"Progress list expansion is still required. Write concrete unfinished milestones into the EXTRA/task Markdown first, then call bind_task_progress.",
					),
				)
			} else {
				const boundPath = requestedPath || "the currently bound EXTRA/task file"
				pushToolResult(
					formatResponse.toolResult(
						`Native todos now follow ${boundPath}. Call bind_task_progress again only to rebind a different root or light file.`,
					),
				)
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			task.consecutiveMistakeCount++
			task.recordToolError("bind_task_progress")
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.toolError(`bind_task_progress failed: ${message}`))
			await handleError("bind task progress", error instanceof Error ? error : new Error(message))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"bind_task_progress">): Promise<void> {
		const approvalMsg = JSON.stringify({
			tool: "updateTodoList",
			todos: task.todoList ?? [],
			path: block.params.path,
		})
		await task.ask("tool", approvalMsg, block.partial).catch(() => {})
	}
}

export function addTodoToTask(cline: Task, content: string, status: TodoStatus = "pending", id?: string): TodoItem {
	const todo: TodoItem = {
		id: id ?? crypto.randomUUID(),
		content,
		status,
	}
	if (!cline.todoList) cline.todoList = []
	cline.todoList.push(todo)
	return todo
}

export function updateTodoStatusForTask(cline: Task, id: string, nextStatus: TodoStatus): boolean {
	if (!cline.todoList) return false
	const idx = cline.todoList.findIndex((t) => t.id === id)
	if (idx === -1) return false
	const current = cline.todoList[idx]
	if (
		(current.status === "pending" && nextStatus === "in_progress") ||
		(current.status === "in_progress" && nextStatus === "completed") ||
		current.status === nextStatus
	) {
		cline.todoList[idx] = { ...current, status: nextStatus }
		return true
	}
	return false
}

export function removeTodoFromTask(cline: Task, id: string): boolean {
	if (!cline.todoList) return false
	const idx = cline.todoList.findIndex((t) => t.id === id)
	if (idx === -1) return false
	cline.todoList.splice(idx, 1)
	return true
}

export function getTodoListForTask(cline: Task): TodoItem[] | undefined {
	return cline.todoList?.slice()
}

export async function setTodoListForTask(cline?: Task, todos?: TodoItem[]): Promise<TodoItem[]> {
	if (cline === undefined) return []
	const normalizedTodos = Array.isArray(todos) ? todos : []

	// kilocode_change start
	// Read and validate the unique durable checklist before exposing native state.
	// The tool payload cannot create or rewrite a task file through this boundary.
	const synchronizedTodos = await cline.syncTaskProgressWithTodoList(normalizedTodos)
	cline.todoList = synchronizedTodos

	// `currentTaskTodos` is part of the provider state snapshot consumed by the
	// expandable top todo panel. Publish only after the source file was validated.
	await cline.providerRef.deref()?.postStateToWebview()
	return synchronizedTodos
	// kilocode_change end
}

export function restoreTodoListForTask(cline: Task, todoList?: TodoItem[]) {
	if (todoList) {
		cline.todoList = Array.isArray(todoList) ? todoList : []
		return
	}
	cline.todoList = getLatestTodo(cline.clineMessages)
}

function todoListToMarkdown(todos: TodoItem[]): string {
	return todos
		.map((t) => {
			let box = "[ ]"
			if (t.status === "completed") box = "[x]"
			else if (t.status === "in_progress") box = "[-]"
			return `${"    ".repeat(t.depth ?? 0)}${box} ${t.content}`
		})
		.join("\n")
}

function normalizeStatus(status: string | undefined): TodoStatus {
	if (status === "completed") return "completed"
	if (status === "in_progress") return "in_progress"
	return "pending"
}

export function parseMarkdownChecklist(md: string): TodoItem[] {
	if (typeof md !== "string") return []
	const checklistLines = md
		.split(/\r?\n/)
		.filter((line) => line.trim())
		.map((line) => ({ line, indent: line.match(/^\s*/)?.[0].replace(/\t/g, "    ").length ?? 0 }))
		.filter(({ line }) => /^(\s*)(?:-\s*)?\[\s*[ xX\-~]\s*\]\s+/.test(line))
	const baseIndent = checklistLines.length > 0 ? Math.min(...checklistLines.map(({ indent }) => indent)) : 0
	const todos: TodoItem[] = []
	for (const { line, indent } of checklistLines) {
		const match = line.match(/^\s*(?:-\s*)?\[\s*([ xX\-~])\s*\]\s+(.+)$/)
		if (!match) continue
		let status: TodoStatus = "pending"
		if (match[1] === "x" || match[1] === "X") status = "completed"
		else if (match[1] === "-" || match[1] === "~") status = "in_progress"
		const depth = Math.floor(Math.max(0, indent - baseIndent) / 4)
		const content = match[2].trim()
		const id = crypto.createHash("md5").update(`${depth}:${content}${status}`).digest("hex")
		todos.push({
			id,
			content,
			status,
			...(depth > 0 ? { depth } : {}),
		})
	}
	return todos
}

export function setPendingTodoList(todos: TodoItem[]) {
	approvedTodoList = todos
}

function validateTodos(todos: any[]): { valid: boolean; error?: string } {
	if (!Array.isArray(todos)) return { valid: false, error: "todos must be an array" }
	for (const [i, t] of todos.entries()) {
		if (!t || typeof t !== "object") return { valid: false, error: `Item ${i + 1} is not an object` }
		if (!t.id || typeof t.id !== "string") return { valid: false, error: `Item ${i + 1} is missing id` }
		if (!t.content || typeof t.content !== "string")
			return { valid: false, error: `Item ${i + 1} is missing content` }
		if (t.status && !todoStatusSchema.options.includes(t.status as TodoStatus))
			return { valid: false, error: `Item ${i + 1} has invalid status` }
		if (t.depth !== undefined && (!Number.isInteger(t.depth) || t.depth < 0))
			return { valid: false, error: `Item ${i + 1} has invalid depth` }
	}
	return { valid: true }
}

export const bindTaskProgressTool = new BindTaskProgressTool()
export const updateTodoListTool = bindTaskProgressTool
