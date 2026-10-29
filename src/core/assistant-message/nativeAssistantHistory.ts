// kilocode_change - new file
import type { Anthropic } from "@anthropic-ai/sdk"

import type { McpToolUse, ToolUse } from "../../shared/tools"
import { sanitizeToolUseId } from "../../utils/tool-id"
import type { AssistantMessageContent } from "./parseAssistantMessage"

/**
 * Rebuild native-protocol assistant API content in stream order.
 * Dumping every text token first and every tool second recites the opening
 * sentence and corrupts later turns after a tool call.
 */
export function buildNativeAssistantApiContent(
	blocks: AssistantMessageContent[],
	thinking: Anthropic.Messages.ContentBlockParam[] = [],
): Anthropic.Messages.ContentBlockParam[] {
	const assistantContent: Anthropic.Messages.ContentBlockParam[] = [...thinking]
	const seenToolUseIds = new Set<string>()

	for (const block of blocks) {
		if (block.type === "text") {
			if (block.content) {
				assistantContent.push({ type: "text", text: block.content })
			}
			continue
		}

		if (block.type === "mcp_tool_use") {
			const mcpBlock = block as McpToolUse
			if (!mcpBlock.id) {
				continue
			}
			const sanitizedId = sanitizeToolUseId(mcpBlock.id)
			if (seenToolUseIds.has(sanitizedId)) {
				continue
			}
			seenToolUseIds.add(sanitizedId)
			assistantContent.push({
				type: "tool_use",
				id: sanitizedId,
				name: mcpBlock.name,
				input: mcpBlock.arguments,
			})
			continue
		}

		if (block.type !== "tool_use") {
			continue
		}

		const toolUse = block as ToolUse
		if (!toolUse.id) {
			continue
		}
		const sanitizedId = sanitizeToolUseId(toolUse.id)
		if (seenToolUseIds.has(sanitizedId)) {
			continue
		}
		seenToolUseIds.add(sanitizedId)
		assistantContent.push({
			type: "tool_use",
			id: sanitizedId,
			name: toolUse.originalName ?? toolUse.name,
			input: toolUse.nativeArgs || toolUse.params,
		})
	}

	return assistantContent
}
