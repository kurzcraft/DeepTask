import type { ClineMessage } from "@roo-code/types"

import { safeJsonParse } from "./safeJsonParse.js"

export const COMMAND_OUTPUT_STRING = "Output:"

/**
 * Consolidates sequences of command and command_output messages in an array of ClineMessages.
 * Also consolidates sequences of use_mcp_server and mcp_server_response messages.
 *
 * This function processes an array of ClineMessages objects, looking for sequences
 * where a 'command' message is followed by one or more 'command_output' messages,
 * or where a 'use_mcp_server' message is followed by one or more 'mcp_server_response' messages.
 * When such a sequence is found, it consolidates them into a single message, merging
 * their text contents.
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns A new array of ClineMessage objects with command and MCP sequences consolidated.
 *
 * @example
 * const messages: ClineMessage[] = [
 *   { type: 'ask', ask: 'command', text: 'ls', ts: 1625097600000 },
 *   { type: 'ask', ask: 'command_output', text: 'file1.txt', ts: 1625097601000 },
 *   { type: 'ask', ask: 'command_output', text: 'file2.txt', ts: 1625097602000 }
 * ];
 * const result = consolidateCommands(messages);
 * // Result: [{ type: 'ask', ask: 'command', text: 'ls\nfile1.txt\nfile2.txt', ts: 1625097600000 }]
 */
function isAbsorbedCommandOrMcpOutput(msg: ClineMessage): boolean {
	return msg.ask === "command_output" || msg.say === "command_output" || msg.say === "mcp_server_response"
}

function isCommandStart(msg: ClineMessage): boolean {
	return msg.type === "ask" && msg.ask === "command"
}

function isMcpStart(msg: ClineMessage): boolean {
	return msg.type === "ask" && msg.ask === "use_mcp_server"
}

function isCommandOutput(msg: ClineMessage): boolean {
	return msg.ask === "command_output" || msg.say === "command_output"
}

function isMcpOutput(msg: ClineMessage): boolean {
	return msg.say === "mcp_server_response"
}

function countKeptMessages(messages: readonly ClineMessage[], end: number): number {
	let count = 0
	const limit = Math.min(end, messages.length)
	for (let i = 0; i < limit; i++) {
		const msg = messages[i]
		if (msg && !isAbsorbedCommandOrMcpOutput(msg)) {
			count++
		}
	}
	return count
}

function changedRegionHasOutputBeforeNextStart(
	messages: readonly ClineMessage[],
	start: number,
	isStart: (msg: ClineMessage) => boolean,
	isOutput: (msg: ClineMessage) => boolean,
): boolean {
	for (let i = start; i < messages.length; i++) {
		const msg = messages[i]
		if (!msg) {
			continue
		}
		if (isStart(msg)) {
			return false
		}
		if (isOutput(msg)) {
			return true
		}
	}
	return false
}

function findRefoldStart(
	messages: readonly ClineMessage[],
	previousInput: readonly ClineMessage[],
	commonPrefixLength: number,
): number {
	let refoldFrom = commonPrefixLength

	const consider = (
		isStart: (msg: ClineMessage) => boolean,
		isOutput: (msg: ClineMessage) => boolean,
	): void => {
		const hasRelevantOutput =
			changedRegionHasOutputBeforeNextStart(messages, commonPrefixLength, isStart, isOutput) ||
			changedRegionHasOutputBeforeNextStart(previousInput, commonPrefixLength, isStart, isOutput)
		if (!hasRelevantOutput) {
			return
		}
		for (let i = commonPrefixLength - 1; i >= 0; i--) {
			const msg = messages[i]
			if (msg && isStart(msg)) {
				refoldFrom = Math.min(refoldFrom, i)
				return
			}
		}
	}

	consider(isCommandStart, isCommandOutput)
	consider(isMcpStart, isMcpOutput)
	return refoldFrom
}

/**
 * Fold command/MCP sequences while reusing an already-folded prefix.
 *
 * Streaming `messageUpdated` keeps unchanged message object identity. Re-folding
 * only the open command avoids reallocating historical command-output strings on
 * every tick of a long session.
 *
 * Task switches, rewinds past the common prefix, and callers without a previous
 * fold still take the full `consolidateCommands` path.
 */
export function consolidateCommandsIncremental(
	messages: ClineMessage[],
	previousInput?: readonly ClineMessage[],
	previousOutput?: readonly ClineMessage[],
): ClineMessage[] {
	if (!previousInput || !previousOutput || previousInput.length === 0) {
		return consolidateCommands(messages)
	}
	if (messages.length === 0) {
		return messages
	}
	if (messages === previousInput) {
		return previousOutput as ClineMessage[]
	}

	let commonPrefixLength = 0
	const limit = Math.min(messages.length, previousInput.length)
	while (commonPrefixLength < limit && messages[commonPrefixLength] === previousInput[commonPrefixLength]) {
		commonPrefixLength++
	}

	if (commonPrefixLength === 0) {
		return consolidateCommands(messages)
	}
	if (commonPrefixLength === messages.length && commonPrefixLength === previousInput.length) {
		return previousOutput as ClineMessage[]
	}

	const refoldFrom = findRefoldStart(messages, previousInput, commonPrefixLength)
	if (refoldFrom <= 0) {
		return consolidateCommands(messages)
	}

	const outputPrefixLength = countKeptMessages(previousInput, refoldFrom)
	if (outputPrefixLength > previousOutput.length) {
		return consolidateCommands(messages)
	}

	const foldedPrefix = previousOutput.slice(0, outputPrefixLength)
	const foldedSuffix = consolidateCommands(messages.slice(refoldFrom))
	if (foldedPrefix.length === 0) {
		return foldedSuffix
	}
	if (foldedSuffix.length === 0) {
		return foldedPrefix as ClineMessage[]
	}
	return foldedPrefix.concat(foldedSuffix)
}

export function consolidateCommands(messages: ClineMessage[]): ClineMessage[] {
	if (messages.length === 0) {
		return messages
	}

	// Folding only allocates a new transcript when an output or MCP
	// response still needs to be merged into its matching request.
	let isMergeNecessary = false
	for (const msg of messages) {
		if (msg.ask === "command_output" || msg.say === "command_output" || msg.say === "mcp_server_response") {
			isMergeNecessary = true
			break
		}
	}

	if (!isMergeNecessary) {
		return messages
	}

	const consolidatedMessages = new Map<number, ClineMessage>()
	const processedIndices = new Set<number>()

	// Single pass through all messages
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]
		if (!msg) continue

		// Handle MCP server requests
		if (msg.type === "ask" && msg.ask === "use_mcp_server") {
			// Look ahead for MCP responses
			const responses: string[] = []
			let j = i + 1

			while (j < messages.length) {
				const nextMsg = messages[j]
				if (!nextMsg) {
					j++
					continue
				}
				if (nextMsg.say === "mcp_server_response") {
					responses.push(nextMsg.text || "")
					processedIndices.add(j)
					j++
				} else if (nextMsg.type === "ask" && nextMsg.ask === "use_mcp_server") {
					// Stop if we encounter another MCP request
					break
				} else {
					j++
				}
			}

			if (responses.length > 0) {
				// Parse the JSON from the message text
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const jsonObj = safeJsonParse<any>(msg.text || "{}", {})

				// Add the response to the JSON object
				jsonObj.response = responses.join("\n")

				// Stringify the updated JSON object
				const consolidatedText = JSON.stringify(jsonObj)

				consolidatedMessages.set(msg.ts, { ...msg, text: consolidatedText })
			}
		}
		// Handle command sequences
		else if (msg.type === "ask" && msg.ask === "command") {
			let consolidatedText = msg.text || ""
			let j = i + 1
			let previous: { type: "ask" | "say"; text: string } | undefined
			let lastProcessedIndex = i

			while (j < messages.length) {
				const currentMsg = messages[j]
				if (!currentMsg) {
					j++
					continue
				}
				const { type, ask, say, text = "" } = currentMsg

				if (type === "ask" && ask === "command") {
					break // Stop if we encounter the next command.
				}

				if (ask === "command_output" || say === "command_output") {
					if (!previous) {
						consolidatedText += `\n${COMMAND_OUTPUT_STRING}`
					}

					const isDuplicate = previous && previous.type !== type && previous.text === text

					if (text.length > 0 && !isDuplicate) {
						// Add a newline before adding the text if there's already content
						if (
							previous &&
							consolidatedText.length >
								consolidatedText.indexOf(COMMAND_OUTPUT_STRING) + COMMAND_OUTPUT_STRING.length
						) {
							consolidatedText += "\n"
						}
						consolidatedText += text
					}

					previous = { type, text }
					processedIndices.add(j)
					lastProcessedIndex = j
				}

				j++
			}

			// Only clone the command when outputs were actually folded in.
			if (lastProcessedIndex > i) {
				consolidatedMessages.set(msg.ts, { ...msg, text: consolidatedText })
				i = lastProcessedIndex
			}
		}
	}

	// Build final result: filter out processed messages and use consolidated versions
	const result: ClineMessage[] = []
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]
		if (!msg) continue

		// Skip messages that were processed as outputs/responses
		if (processedIndices.has(i)) {
			continue
		}

		// Skip command_output and mcp_server_response messages
		if (msg.ask === "command_output" || msg.say === "command_output" || msg.say === "mcp_server_response") {
			continue
		}

		// Use consolidated version if available
		const consolidatedMsg = consolidatedMessages.get(msg.ts)
		if (consolidatedMsg) {
			result.push(consolidatedMsg)
		} else {
			result.push(msg)
		}
	}

	return result
}
