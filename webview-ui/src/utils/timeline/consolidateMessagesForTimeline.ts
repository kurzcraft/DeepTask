import type { ClineMessage } from "@roo-code/types"
import { combineApiRequests } from "@roo/combineApiRequests"
import { combineCommandSequences } from "@roo/combineCommandSequences"
import { shouldShowInTimeline } from "../messageColors"

function needsTimelineCombining(messages: readonly ClineMessage[]): boolean {
	for (const message of messages) {
		if (message.ask === "command_output" || message.say === "command_output") {
			return true
		}

		if (message.say === "api_req_finished") {
			return true
		}
	}

	return false
}

/**
 * Processes grouped messages using the existing shared utilities:
 * 1. Flattens grouped messages to individual messages
 * 2. Combines related messages (API requests, command sequences) using existing utilities
 * 3. Filters out unwanted message types
 * 4. Returns processed messages with original index mapping
 *
 * ChatView already incrementally folds command sequences and API requests before
 * grouping. Re-running those combiners on every streaming tick cloned the whole
 * timeline. Skip them unless independent command_output / api_req_finished rows
 * are still present.
 */
export function consolidateMessagesForTimeline(groupedMessages: (ClineMessage | ClineMessage[])[]): {
	processedMessages: ClineMessage[]
	messageToOriginalIndex: Map<ClineMessage, number>
} {
	if (groupedMessages.length <= 1) {
		return {
			processedMessages: [],
			messageToOriginalIndex: new Map(),
		}
	}

	// Flatten grouped messages to individual messages
	const flatMessages: ClineMessage[] = []
	const messageToOriginalIndex: Map<ClineMessage, number> = new Map()

	// Skip first message like Cline
	for (let i = 1; i < groupedMessages.length; i++) {
		const messageOrGroup = groupedMessages[i]
		if (Array.isArray(messageOrGroup)) {
			// Handle grouped messages - add each individual message
			messageOrGroup.forEach((msg) => {
				flatMessages.push(msg)
				messageToOriginalIndex.set(msg, i)
			})
		} else {
			// Handle single message
			flatMessages.push(messageOrGroup)
			messageToOriginalIndex.set(messageOrGroup, i)
		}
	}

	const combinedMessages = needsTimelineCombining(flatMessages)
		? combineApiRequests(combineCommandSequences(flatMessages))
		: flatMessages

	const updatedMapping = combinedMessages === flatMessages ? messageToOriginalIndex : new Map(messageToOriginalIndex)
	if (combinedMessages !== flatMessages) {
		combinedMessages.forEach((msg: ClineMessage) => {
			if (!updatedMapping.has(msg)) {
				const originalMsg = flatMessages.find((original) => original.ts === msg.ts)
				if (originalMsg && messageToOriginalIndex.has(originalMsg)) {
					updatedMapping.set(msg, messageToOriginalIndex.get(originalMsg)!)
				}
			}
		})
	}
	const processedMessages = combinedMessages.filter(shouldShowInTimeline)

	return {
		processedMessages,
		messageToOriginalIndex: updatedMapping,
	}
}
