import type { ClineMessage } from "@roo-code/types"

// kilocode_change - new file
export type ChatRowListMeta = {
	hasCheckpoint: boolean
	lastModifiedMessage: ClineMessage | undefined
	browserActions: ClineMessage[]
	browserActionIndexByTs: Map<number, number>
	nextBrowserActionResultByActionTs: Map<number, ClineMessage>
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

function isUpdateTodoListMessage(message: ClineMessage): boolean {
	if (message.type !== "ask" || message.ask !== "tool") {
		return false
	}

	try {
		const tool = JSON.parse(message.text || "{}")
		return tool.tool === "updateTodoList"
	} catch {
		return false
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
		if (msg.ts >= currentMessageTs || !isUpdateTodoListMessage(msg)) {
			continue
		}

		try {
			const tool = JSON.parse(msg.text || "{}")
			return tool.todos || []
		} catch {
			return []
		}
	}

	return []
}

export function buildPreviousTodosByTs(messages: ClineMessage[]): Map<number, any[]> {
	const previousTodosByTs = new Map<number, any[]>()

	for (const message of messages) {
		if (isUpdateTodoListMessage(message)) {
			previousTodosByTs.set(message.ts, getPreviousTodos(messages, message.ts))
		}
	}

	return previousTodosByTs
}
