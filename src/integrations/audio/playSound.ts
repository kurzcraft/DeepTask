// kilocode_change - new file
import { execa } from "execa"
import * as path from "path"

import type { AudioType } from "@roo-code/types"

const AUDIO_FILES: Record<AudioType, string> = {
	notification: "notification.wav",
	celebration: "celebration.wav",
	progress_loop: "progress_loop.wav",
}

const LINUX_PLAYERS = [
	{ command: "pw-play", volumeArgs: (volume: number) => ["--volume", String(volume)] },
	{ command: "paplay", volumeArgs: (volume: number) => ["--volume", String(Math.round(volume * 65_536))] },
	{ command: "aplay", volumeArgs: () => [] },
]

export async function playLinuxSound(extensionPath: string, audioType: AudioType, volume = 0.5): Promise<void> {
	const normalizedVolume = Math.min(1, Math.max(0, volume))
	const audioPath = path.join(extensionPath, "webview-ui", "audio", AUDIO_FILES[audioType])
	const errors: string[] = []

	for (const player of LINUX_PLAYERS) {
		try {
			await execa(player.command, [...player.volumeArgs(normalizedVolume), audioPath])
			return
		} catch (error) {
			errors.push(`${player.command}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	throw new Error(`No Linux audio player could play ${audioType}: ${errors.join("; ")}`)
}
