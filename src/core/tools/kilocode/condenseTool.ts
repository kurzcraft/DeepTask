import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../../shared/tools"
import { Task } from "../../task/Task"
import { formatResponse } from "../../prompts/responses"

export const condenseTool = async (
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) => {
	const context: string | undefined = block.params.message
	try {
		if (block.partial) {
			await cline.ask("condense", removeClosingTag("message", context), block.partial).catch(() => {})
			return
		} else {
			if (!context) {
				cline.consecutiveMistakeCount++
				pushToolResult(await cline.sayAndCreateMissingParamError("condense", "context"))
				return
			}
			cline.consecutiveMistakeCount = 0

			const { text, images } = await cline.ask("condense", context, false)

			// If the user provided a response, treat it as feedback
			if (text || images?.length) {
				await cline.say("user_feedback", text ?? "", images)
				pushToolResult(
					formatResponse.toolResult(
						`The user provided feedback on the condensed conversation summary:\n<feedback>\n${text}\n</feedback>`,
						images,
					),
				)
			} else {
				// kilocode_change start
				// The model-invoked manual tool must use the same transactional manual
				// entrypoint as the toolbar. That shared path flushes pending tool results,
				// applies the configured condensing prompt/profile, respects the task's
				// locked native protocol, validates token reduction, rejects stale results,
				// preserves the latest continuation focus, and emits consistent UI events.
				// Calling summarizeConversation directly here silently bypassed all of those
				// quality and safety guarantees.
				const condensed = await cline.condenseContext()
				pushToolResult(
					formatResponse.toolResult(
						condensed
							? formatResponse.condense()
							: "Context condensation did not commit; the original conversation was preserved. See the visible condensation error or retry after the active history update finishes.",
					),
				)
				// kilocode_change end
			}
			return
		}
	} catch (error) {
		await handleError("condensing context window", error)
		return
	}
}
