import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { LiveTaskCoordinator } from "../LiveTaskCoordinator"

describe("LiveTaskCoordinator", () => {
	let storageDir: string

	beforeEach(async () => {
		storageDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "deeptask-live-"))
	})

	afterEach(async () => {
		await fs.promises.rm(storageDir, { recursive: true, force: true })
	})

	test("a second window sees the first window's live task as occupancy", async () => {
		const first = new LiveTaskCoordinator({ storageDir, windowId: "win-a", heartbeatMs: 50_000, staleMs: 8_000 })
		await first.upsertTask({
			taskId: "task-1",
			cwd: "/repo",
			conversationId: "cv-1",
			abort: false,
			abandoned: false,
		})

		const second = new LiveTaskCoordinator({ storageDir, windowId: "win-b", heartbeatMs: 50_000, staleMs: 8_000 })
		expect(second.isLiveElsewhere("task-1")).toBe(true)
		expect(second.listRemoteTasks().map((task) => task.taskId)).toEqual(["task-1"])
		expect(second.hasAnyLiveTasks()).toBe(true)
		await second.dispose()
	})

	test("disposing a window removes its live tasks so inference can stop", async () => {
		const first = new LiveTaskCoordinator({ storageDir, windowId: "win-a", heartbeatMs: 50_000, staleMs: 8_000 })
		await first.upsertTask({
			taskId: "task-1",
			cwd: "/repo",
			abort: false,
			abandoned: false,
		})
		await first.dispose()

		const leftover = new LiveTaskCoordinator({ storageDir, windowId: "win-b", heartbeatMs: 50_000, staleMs: 8_000 })
		expect(leftover.hasAnyLiveTasks()).toBe(false)
		await leftover.dispose()
	})

	test("a mirror window can stop watching without deleting the owner's live task", async () => {
		const owner = new LiveTaskCoordinator({ storageDir, windowId: "win-a", heartbeatMs: 50_000, staleMs: 8_000 })
		await owner.upsertTask({
			taskId: "task-1",
			cwd: "/repo",
			abort: false,
			abandoned: false,
		})

		const mirror = new LiveTaskCoordinator({ storageDir, windowId: "win-b", heartbeatMs: 50_000, staleMs: 8_000 })
		expect(mirror.isLiveElsewhere("task-1")).toBe(true)
		mirror.stopWatching()

		const leftover = new LiveTaskCoordinator({ storageDir, windowId: "win-c", heartbeatMs: 50_000, staleMs: 8_000 })
		expect(leftover.isLiveElsewhere("task-1")).toBe(true)
		expect(leftover.hasAnyLiveTasks()).toBe(true)
		await leftover.dispose()
		await owner.dispose()
	})
})
