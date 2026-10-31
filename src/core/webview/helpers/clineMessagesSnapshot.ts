// kilocode_change - new file
/**
 * Host-side cursor for whether a coalesced state snapshot must carry the full
 * clineMessages array. Incremental rows travel through messageUpdated; repeating
 * the 7k-row JSON blob on every settings post is the renderer heap amplifier.
 * Do not fingerprint message contents.
 */
export function clineMessagesSnapshotCursor(input: {
	pendingNewConversation?: boolean
	taskId?: string
	instanceId?: string
	epoch?: number
}): string {
	if (input.pendingNewConversation || !input.taskId || !input.instanceId) {
		return "empty"
	}

	return `${input.taskId}:${input.instanceId}:${input.epoch ?? 0}`
}

export function shouldPostClineMessages(
	force: boolean,
	cursor: string,
	lastCursor: string | undefined,
): boolean {
	return force || cursor !== lastCursor
}
