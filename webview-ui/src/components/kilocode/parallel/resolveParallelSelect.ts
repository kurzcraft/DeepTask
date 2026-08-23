import type { ParallelConversation, ParallelSession } from "@roo-code/types"

export function resolveParallelSelectTarget(
	id: string,
	conversations: ParallelConversation[],
	sessions: ParallelSession[],
): { kind: "session" | "conversation" | "other"; targetId: string } {
	if (id.startsWith("cv:")) {
		// Live subagents use the same main chat as the parent conversation.
		return { kind: "conversation", targetId: id.slice(3) }
	}
	return { kind: "other", targetId: id }
}
