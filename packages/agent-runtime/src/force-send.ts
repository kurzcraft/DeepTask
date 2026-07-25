import type { ExtensionService } from "./services/extension.js"
import type { ExtensionState, WebviewMessage } from "./types/index.js"

// kilocode_change - new file
const FORCE_SEND_POLL_INTERVAL_MS = 100
const FORCE_SEND_READY_TIMEOUT_MS = 5_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function hasPendingAsk(state: ExtensionState | null): boolean {
	const messages = state?.clineMessages ?? state?.chatMessages ?? []
	const lastAsk = [...messages].reverse().find((message) => message.type === "ask")
	return lastAsk !== undefined && lastAsk.partial !== true && lastAsk.isAnswered !== true
}

export async function waitForPendingAsk(agent: Pick<ExtensionService, "getState">): Promise<void> {
	const startedAt = Date.now()
	while (Date.now() - startedAt < FORCE_SEND_READY_TIMEOUT_MS) {
		if (hasPendingAsk(agent.getState())) {
			return
		}
		await sleep(FORCE_SEND_POLL_INTERVAL_MS)
	}
}

export async function forceSendWebviewMessage(
	agent: Pick<ExtensionService, "getState" | "sendWebviewMessage">,
	payload: WebviewMessage,
): Promise<void> {
	if (hasPendingAsk(agent.getState())) {
		await agent.sendWebviewMessage(payload)
		return
	}

	await agent.sendWebviewMessage({ type: "cancelTask" })
	await waitForPendingAsk(agent)
	await agent.sendWebviewMessage(payload)
}
