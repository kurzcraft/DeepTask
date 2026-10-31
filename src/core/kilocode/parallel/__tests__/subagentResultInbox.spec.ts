import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { safeWriteJson } from "../../../../utils/safeWriteJson"
import {
	buildInboxResumeInjection,
	confirmInboxDeliveryFromMessages,
	formatInboxEntriesForToolResult,
	inboxMarker,
	listInboxEntries,
	markInboxEntryDelivered,
	messagesContainInboxMarker,
	persistSubagentResult,
	shouldRedeliverInboxEntry,
	SubagentResultInboxError,
	undeliveredEntries,
	type SubagentInboxEntry,
} from "../subagentResultInbox"

vi.mock("../../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn(async (filePath: string, data: unknown) => {
		const { promises: fs } = await import("node:fs")
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8")
	}),
}))

const makeEntry = (
	overrides: Partial<SubagentInboxEntry> & Pick<SubagentInboxEntry, "childSessionId" | "status">,
): SubagentInboxEntry => ({
	version: 1,
	parentTaskId: "parent",
	childSessionId: overrides.childSessionId,
	childTaskId: overrides.childSessionId,
	label: overrides.label ?? overrides.childSessionId,
	status: overrides.status,
	result: overrides.result,
	error: overrides.error,
	toolCallId: overrides.toolCallId,
	createdAt: overrides.createdAt ?? 1,
	updatedAt: overrides.updatedAt ?? 1,
	cancelled: overrides.cancelled ?? overrides.status === "cancelled",
	deliveryState: overrides.deliveryState ?? "pending",
	deliveredAt: overrides.deliveredAt,
	deliveryEvidence: overrides.deliveryEvidence,
	persistError: overrides.persistError,
	parentInstanceId: overrides.parentInstanceId,
	workspaceName: overrides.workspaceName,
	branch: overrides.branch,
})

describe("subagentResultInbox", () => {
	let tmp: string

	beforeEach(async () => {
		tmp = await mkdtemp(path.join(os.tmpdir(), "928-inbox-"))
		vi.mocked(safeWriteJson).mockClear()
	})

	afterEach(async () => {
		await rm(tmp, { recursive: true, force: true })
	})

	test("persist writes pending entries and is idempotent for the same child", async () => {
		const first = await persistSubagentResult({
			globalStoragePath: tmp,
			parentTaskId: "parent",
			parentInstanceId: "inst-a",
			childSessionId: "child-1",
			label: "alpha",
			status: "completed",
			result: "done-1",
			toolCallId: "tool-1",
		})
		const second = await persistSubagentResult({
			globalStoragePath: tmp,
			parentTaskId: "parent",
			parentInstanceId: "inst-b",
			childSessionId: "child-1",
			label: "alpha",
			status: "completed",
			result: "done-1-retry",
			toolCallId: "tool-1",
		})
		expect(first.deliveryState).toBe("pending")
		expect(second.createdAt).toBe(first.createdAt)
		expect(second.deliveryState).toBe("pending")
		const listed = await listInboxEntries(tmp, "parent")
		expect(listed).toHaveLength(1)
		expect(listed[0].childSessionId).toBe("child-1")
	})

	test("concurrent persists for different children do not swallow results", async () => {
		await Promise.all([
			persistSubagentResult({
				globalStoragePath: tmp,
				parentTaskId: "parent",
				childSessionId: "child-a",
				label: "a",
				status: "completed",
				result: "A",
			}),
			persistSubagentResult({
				globalStoragePath: tmp,
				parentTaskId: "parent",
				childSessionId: "child-b",
				label: "b",
				status: "completed",
				result: "B",
			}),
		])
		const listed = await listInboxEntries(tmp, "parent")
		expect(listed.map((entry) => entry.childSessionId).sort()).toEqual(["child-a", "child-b"])
	})

	test("mark delivered requires API history confirmation and never regresses", async () => {
		await persistSubagentResult({
			globalStoragePath: tmp,
			parentTaskId: "parent",
			childSessionId: "child-1",
			label: "alpha",
			status: "completed",
			result: "done",
		})
		await expect(
			markInboxEntryDelivered({
				globalStoragePath: tmp,
				parentTaskId: "parent",
				childSessionId: "child-1",
				evidence: {
					kind: "api_history",
					persistedAt: Date.now(),
					confirmation: "no marker here",
				},
			}),
		).rejects.toBeInstanceOf(SubagentResultInboxError)

		const confirmed = await confirmInboxDeliveryFromMessages({
			globalStoragePath: tmp,
			parentTaskId: "parent",
			messages: [
				{
					content: formatInboxEntriesForToolResult([
						makeEntry({ childSessionId: "child-1", status: "completed", result: "done" }),
					]),
				},
			],
			toolUseId: "tool-1",
		})
		expect(confirmed).toEqual(["child-1"])
		const listed = await listInboxEntries(tmp, "parent")
		expect(listed[0].deliveryState).toBe("delivered")
		expect(listed[0].deliveryEvidence?.confirmation).toContain(inboxMarker("child-1"))

		const again = await persistSubagentResult({
			globalStoragePath: tmp,
			parentTaskId: "parent",
			childSessionId: "child-1",
			label: "alpha",
			status: "completed",
			result: "should-not-regress",
		})
		expect(again.deliveryState).toBe("delivered")
		expect(again.result).toBe("done")
	})

	test("resume injection replaces interrupted native results and never creates orphan tool_result", () => {
		const completed = makeEntry({
			childSessionId: "child-1",
			status: "completed",
			result: "ok",
			toolCallId: "call-1",
		})
		const cancelled = makeEntry({
			childSessionId: "child-2",
			status: "cancelled",
			cancelled: true,
		})
		const injection = buildInboxResumeInjection({
			entries: [completed, cancelled],
			historyText: "",
			assistantToolUses: [{ id: "call-1", name: "dispatch_subagents" }],
			existingToolResultIds: ["call-1"],
			existingToolResultTextById: {
				"call-1": "Task was interrupted before this tool call could be completed.",
			},
		})
		expect(injection.nativeResults).toHaveLength(1)
		expect(injection.nativeResults[0].toolUseId).toBe("call-1")
		expect(injection.nativeResults[0].content).toContain(inboxMarker("child-1"))
		expect(injection.userText).toContain("cancelled")
		expect(injection.userText).toContain("will not be respawned")
		expect(injection.childSessionIds).toEqual(["child-1", "child-2"])

		const orphan = buildInboxResumeInjection({
			entries: [completed],
			historyText: "",
			assistantToolUses: [],
		})
		expect(orphan.nativeResults).toEqual([])
		expect(orphan.userText).toContain(inboxMarker("child-1"))
	})

	test("already delivered or already present history is not redelivered", () => {
		const delivered = makeEntry({
			childSessionId: "child-1",
			status: "completed",
			deliveryState: "delivered",
		})
		const pending = makeEntry({
			childSessionId: "child-2",
			status: "completed",
			result: "later",
		})
		expect(shouldRedeliverInboxEntry(delivered, "")).toBe(false)
		expect(shouldRedeliverInboxEntry(pending, inboxMarker("child-2"))).toBe(false)
		const injection = buildInboxResumeInjection({
			entries: [delivered, pending],
			historyText: formatInboxEntriesForToolResult([pending]),
			assistantToolUses: [{ id: "call-1", name: "dispatch_subagents" }],
		})
		expect(injection.childSessionIds).toEqual([])
		expect(undeliveredEntries([delivered, pending])).toEqual([pending])
	})

	test("resume injection scans messages without concatenating history text", () => {
		const pending = makeEntry({
			childSessionId: "child-scan",
			status: "completed",
			result: "done",
		})
		const messages = [
			{ content: [{ type: "text", text: "unrelated" }] },
			{ content: [{ type: "text", text: inboxMarker("child-scan") }] },
		]
		expect(messagesContainInboxMarker(messages, "child-scan")).toBe(true)
		expect(shouldRedeliverInboxEntry(pending, "", messages)).toBe(false)
		const injection = buildInboxResumeInjection({
			entries: [pending],
			messages,
			assistantToolUses: [{ id: "call-1", name: "dispatch_subagents" }],
		})
		expect(injection.childSessionIds).toEqual([])
		expect(
			shouldRedeliverInboxEntry(pending, "", [{ content: [{ type: "text", text: "no marker" }] }]),
		).toBe(true)
	})

	test("persist failure is logged as a recoverable error", async () => {
		vi.mocked(safeWriteJson).mockRejectedValueOnce(new Error("disk full"))
		await expect(
			persistSubagentResult({
				globalStoragePath: tmp,
				parentTaskId: "parent",
				childSessionId: "child-fail",
				label: "fail",
				status: "completed",
				result: "lost",
			}),
		).rejects.toBeInstanceOf(SubagentResultInboxError)
	})

	test("corrupt inbox files do not hide remaining entries", async () => {
		await persistSubagentResult({
			globalStoragePath: tmp,
			parentTaskId: "parent",
			childSessionId: "child-ok",
			label: "ok",
			status: "completed",
			result: "kept",
		})
		const dir = path.join(tmp, "tasks", "parent", "subagent-result-inbox")
		await mkdir(dir, { recursive: true })
		await writeFile(path.join(dir, "broken.json"), "{not json", "utf8")
		const listed = await listInboxEntries(tmp, "parent")
		expect(listed.map((entry) => entry.childSessionId)).toEqual(["child-ok"])
		expect(listed[0].result).toBe("kept")
	})
})
