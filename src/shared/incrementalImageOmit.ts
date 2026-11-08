// kilocode_change - new file
import type { ClineMessage } from "@roo-code/types"

/**
 * Host incremental IPC (`messageUpdated`) still JSON.parse's the full
 * base64 image array on every in-place row update. Same-ts image blobs
 * almost never change; repeating them is the remaining renderer amplifier
 * after the 800-row compact window.
 *
 * Fingerprint is length + prefix/suffix only — never hash the full blob.
 * Storage and model I/O stay full. Display-only.
 */
export function imageFingerprint(images: string[] | undefined): string {
	if (!images || images.length === 0) {
		return ""
	}

	return images.map((image) => `${image.length}:${image.slice(0, 16)}:${image.slice(-8)}`).join("|")
}

export function mergeIncrementalClineMessage(
	incoming: ClineMessage,
	existing: ClineMessage | undefined,
): ClineMessage {
	if (incoming.webviewImagesOmitted !== true) {
		return incoming
	}

	const next: ClineMessage = { ...incoming }
	delete next.webviewImagesOmitted
	if (existing?.images && existing.images.length > 0) {
		next.images = existing.images
	}
	return next
}

export class IncrementalImageOmitter {
	private readonly fingerprints = new Map<string, string>()

	private keyFor(ts: number, sessionKey = ""): string {
		return `${sessionKey}:${ts}`
	}

	remember(message: ClineMessage, sessionKey = ""): void {
		this.fingerprints.set(this.keyFor(message.ts, sessionKey), imageFingerprint(message.images))
	}

	rememberAll(messages: readonly ClineMessage[], sessionKey = ""): void {
		const prefix = `${sessionKey}:`
		for (const key of [...this.fingerprints.keys()]) {
			if (key.startsWith(prefix)) {
				this.fingerprints.delete(key)
			}
		}
		for (const message of messages) {
			this.remember(message, sessionKey)
		}
	}

	omitUnchanged(message: ClineMessage, sessionKey = ""): ClineMessage {
		const key = this.keyFor(message.ts, sessionKey)
		const fingerprint = imageFingerprint(message.images)
		const previous = this.fingerprints.get(key)
		this.fingerprints.set(key, fingerprint)

		if (!message.images?.length || previous !== fingerprint) {
			return message
		}

		const next: ClineMessage = { ...message }
		delete next.images
		next.webviewImagesOmitted = true
		return next
	}

	invalidate(): void {
		this.fingerprints.clear()
	}
}
