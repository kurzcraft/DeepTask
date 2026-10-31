// kilocode_change - new file
import { clineMessagesSnapshotCursor, shouldPostClineMessages } from "../clineMessagesSnapshot"

describe("clineMessagesSnapshotCursor", () => {
	it("uses taskId, instanceId, and epoch without hashing contents", () => {
		expect(
			clineMessagesSnapshotCursor({
				taskId: "task-a",
				instanceId: "inst-1",
				epoch: 3,
			}),
		).toBe("task-a:inst-1:3")
	})

	it("treats a pending new conversation as empty even when a previous task is still on the stack", () => {
		expect(
			clineMessagesSnapshotCursor({
				pendingNewConversation: true,
				taskId: "task-a",
				instanceId: "inst-1",
				epoch: 9,
			}),
		).toBe("empty")
	})

	it("treats a missing task identity as empty", () => {
		expect(clineMessagesSnapshotCursor({ epoch: 1 })).toBe("empty")
		expect(clineMessagesSnapshotCursor({ taskId: "task-a", epoch: 1 })).toBe("empty")
	})
})

describe("shouldPostClineMessages", () => {
	it("omits the array when the cursor is unchanged", () => {
		expect(shouldPostClineMessages(false, "task-a:inst-1:3", "task-a:inst-1:3")).toBe(false)
	})

	it("posts the array on force even when the cursor is unchanged", () => {
		expect(shouldPostClineMessages(true, "task-a:inst-1:3", "task-a:inst-1:3")).toBe(true)
	})

	it("posts the array when the task, instance, or epoch changes", () => {
		expect(shouldPostClineMessages(false, "task-b:inst-1:3", "task-a:inst-1:3")).toBe(true)
		expect(shouldPostClineMessages(false, "task-a:inst-2:3", "task-a:inst-1:3")).toBe(true)
		expect(shouldPostClineMessages(false, "task-a:inst-1:4", "task-a:inst-1:3")).toBe(true)
		expect(shouldPostClineMessages(false, "empty", "task-a:inst-1:3")).toBe(true)
	})

	it("posts the first snapshot when no cursor has been sent yet", () => {
		expect(shouldPostClineMessages(false, "task-a:inst-1:0", undefined)).toBe(true)
	})
})
