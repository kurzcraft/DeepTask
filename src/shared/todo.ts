import { ClineMessage, TodoItem } from "@roo-code/types"

interface TodoMetadata {
	tool?: string
	todos?: TodoItem[]
}

export function getLatestTodo(clineMessages: ClineMessage[]): TodoItem[] {
	const todos = clineMessages
		.filter(
			(msg) =>
				(msg.type === "ask" && msg.ask === "tool") || (msg.type === "say" && msg.say === "user_edit_todos"),
		)
		.map((msg) => {
			const metadata = msg.metadata as TodoMetadata | undefined
			if (metadata?.tool === "updateTodoList" && Array.isArray(metadata.todos)) {
				return { tool: "updateTodoList", todos: metadata.todos }
			}
			try {
				return JSON.parse(msg.text ?? "{}")
			} catch {
				return null
			}
		})
		.filter((item) => item && item.tool === "updateTodoList" && Array.isArray(item.todos) && item.todos.length > 0)
		.map((item) => item.todos as TodoItem[])
		.pop()

	if (todos) {
		return todos
	} else {
		return []
	}
}
