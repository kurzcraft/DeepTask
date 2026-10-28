// kilocode_change - new file
import type { ExtensionMessage, ExtensionState } from "./types/index.js"

export type ForkParentIpcMessage =
	| { type: "message"; payload: ExtensionMessage }
	| { type: "stateChange"; state: ExtensionState }

/**
 * ExtensionService emits message/state immediately followed by stateChange.
 * Suppress only that synchronous pair, not later reuse of the same object.
 * Weak references cannot keep an otherwise dead conversation snapshot alive.
 * Public ExtensionService events and standalone stateChange remain unchanged.
 */
export function createForkParentIpcForwarder(send: (message: ForkParentIpcMessage) => void) {
	let pairedState: WeakRef<ExtensionState> | undefined
	let expiryScheduled = false
	return {
		forwardMessage(message: ExtensionMessage): void {
			send({ type: "message", payload: message })
			pairedState = message.type === "state" && message.state ? new WeakRef(message.state) : undefined
			if (pairedState && !expiryScheduled) {
				expiryScheduled = true
				queueMicrotask(() => {
					pairedState = undefined
					expiryScheduled = false
				})
			}
		},
		forwardStateChange(state: ExtensionState): void {
			const duplicate = pairedState?.deref() === state
			pairedState = undefined
			if (!duplicate) send({ type: "stateChange", state })
		},
	}
}
