import type { ClineMessage } from "@roo-code/types"

// kilocode_change - new file
export type ChatRowListMeta = {
	hasCheckpoint: boolean
	lastModifiedMessage: ClineMessage | undefined
	browserActions: ClineMessage[]
	browserActionIndexByTs: Map<number, number>
	nextBrowserActionResultByActionTs: Map<number, ClineMessage>
}

function isBrowserOrCheckpointMessage(message: ClineMessage | undefined): boolean {
	return (
		message?.say === "checkpoint_saved" ||
		message?.say === "browser_action" ||
		message?.say === "browser_action_result"
	)
}

function findCommonPrefixLength(current: readonly ClineMessage[], previous: readonly ClineMessage[]): number {
	const limit = Math.min(current.length, previous.length)
	let index = 0
	while (index < limit && current[index] === previous[index]) {
		index++
	}
	return index
}

/**
 * Precompute ChatView list lookups once per modifiedMessages snapshot.
 * Preserves original per-row semantics:
 * - hasCheckpoint is true if any message is checkpoint_saved
 * - next browser_action_result is the first result with ts greater than the action
 */
export function buildChatRowListMeta(modifiedMessages: ClineMessage[]): ChatRowListMeta {
	const browserActions: ClineMessage[] = []
	const browserActionResults: ClineMessage[] = []
	let hasCheckpoint = false

	for (const message of modifiedMessages) {
		if (message.say === "checkpoint_saved") {
			hasCheckpoint = true
		}
		if (message.say === "browser_action") {
			browserActions.push(message)
		} else if (message.say === "browser_action_result") {
			browserActionResults.push(message)
		}
	}

	const browserActionIndexByTs = new Map<number, number>()
	browserActions.forEach((action, index) => {
		browserActionIndexByTs.set(action.ts, index)
	})

	const nextBrowserActionResultByActionTs = new Map<number, ClineMessage>()
	let resultIndex = 0
	for (const action of browserActions) {
		while (resultIndex < browserActionResults.length && browserActionResults[resultIndex].ts <= action.ts) {
			resultIndex++
		}
		if (resultIndex < browserActionResults.length) {
			nextBrowserActionResultByActionTs.set(action.ts, browserActionResults[resultIndex])
		}
	}

	return {
		hasCheckpoint,
		lastModifiedMessage: modifiedMessages.at(-1),
		browserActions,
		browserActionIndexByTs,
		nextBrowserActionResultByActionTs,
	}
}

function parseUpdateTodoList(message: ClineMessage): any[] | undefined {
	if (message.type !== "ask" || message.ask !== "tool") {
		return undefined
	}

	try {
		const tool = JSON.parse(message.text || "{}")
		if (tool.tool !== "updateTodoList") {
			return undefined
		}
		return tool.todos || []
	} catch {
		return undefined
	}
}

/**
 * Previous updateTodoList todos before a specific message.
 * Matches the original ChatRow reverse-scan: the latest earlier tool
 * message whose payload is updateTodoList.
 */
export function getPreviousTodos(messages: ClineMessage[], currentMessageTs: number): any[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.ts >= currentMessageTs) {
			continue
		}

		const todos = parseUpdateTodoList(msg)
		if (todos !== undefined) {
			return todos
		}
	}

	return []
}

export function buildPreviousTodosByTs(messages: ClineMessage[]): Map<number, any[]> {
	const previousTodosByTs = new Map<number, any[]>()
	let lastTodos: any[] = []

	for (const message of messages) {
		const todos = parseUpdateTodoList(message)
		if (todos === undefined) {
			continue
		}

		previousTodosByTs.set(message.ts, lastTodos)
		lastTodos = todos
	}

	return previousTodosByTs
}
