// kilocode_change - new file
import { execa } from "execa"

import { playLinuxSound } from "../playSound"

vi.mock("execa")

const mockedExeca = vi.mocked(execa)

describe("playLinuxSound", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("plays the packaged audio through PipeWire with a normalized volume", async () => {
		mockedExeca.mockResolvedValueOnce({} as never)

		await playLinuxSound("/extension", "celebration", 1.5)

		expect(mockedExeca).toHaveBeenCalledWith("pw-play", [
			"--volume",
			"1",
			"/extension/webview-ui/audio/celebration.wav",
		])
	})

	it("falls back to PulseAudio when PipeWire playback fails", async () => {
		mockedExeca.mockRejectedValueOnce(new Error("pw-play missing")).mockResolvedValueOnce({} as never)

		await playLinuxSound("/extension", "notification", 0.25)

		expect(mockedExeca).toHaveBeenNthCalledWith(1, "pw-play", [
			"--volume",
			"0.25",
			"/extension/webview-ui/audio/notification.wav",
		])
		expect(mockedExeca).toHaveBeenNthCalledWith(2, "paplay", [
			"--volume",
			"16384",
			"/extension/webview-ui/audio/notification.wav",
		])
	})

	it("reports every attempted backend when playback cannot start", async () => {
		mockedExeca.mockRejectedValue(new Error("unavailable"))

		await expect(playLinuxSound("/extension", "progress_loop", -1)).rejects.toThrow(
			"No Linux audio player could play progress_loop: pw-play: unavailable; paplay: unavailable; aplay: unavailable",
		)
		expect(mockedExeca).toHaveBeenLastCalledWith("aplay", ["/extension/webview-ui/audio/progress_loop.wav"])
	})
})
