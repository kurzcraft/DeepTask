// kilocode_change - new file
import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser"
import { applyDiffTool } from "../ApplyDiffTool"
import type { Task } from "../../task/Task"
import type { ToolUse } from "../../../shared/tools"

vi.mock("../../task/Task")
vi.mock("fs/promises", () => ({ default: { readFile: vi.fn().mockResolvedValue("original") } }))
vi.mock("../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(true) }))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureDiffApplicationError: vi.fn() } },
}))

const newline = String.fromCharCode(10)
const slash = String.fromCharCode(92)
const amp = String.fromCharCode(38)
const literal = [
	amp + "lt;node" + amp + "gt; " + amp + "amp; " + amp + "quot;",
	"escape " + slash + "n " + slash + "t " + slash + "r " + slash + "u0041",
	"C:" + slash + "temp" + slash + "file.txt; 中文 😀",
	"quote: \" single: ' regex: " + slash + "d+" + slash + "s*",
	"1 | literal line numbers",
	"```",
].join(newline)

const cases = [
	{ name: "write_to_file" as const, args: { path: "fixture.txt", content: literal }, field: "content" },
	{ name: "apply_diff" as const, args: { path: "fixture.txt", diff: literal }, field: "diff" },
	{ name: "execute_command" as const, args: { command: literal }, field: "command" },
	{
		name: "edit_file" as const,
		args: { file_path: "fixture.txt", old_string: "old", new_string: literal },
		field: "new_string",
	},
]

describe("native argument decode fidelity", () => {
	beforeEach(() => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	})

	it.each(cases)("decodes $name arguments exactly once", ({ name, args, field }) => {
		const parsed = NativeToolCallParser.parseToolCall({ id: "fidelity", name, arguments: JSON.stringify(args) })
		expect(parsed).not.toBeNull()
		if (!parsed || parsed.type !== "tool_use") throw new Error("Expected native tool use")
		expect((parsed.params as Record<string, string>)[field]).toBe(literal)
	})

	it.each(cases)("preserves $name at every streaming split boundary", ({ name, args, field }) => {
		const json = JSON.stringify(args)
		for (let split = 1; split < json.length; split++) {
			const id = "split-" + split
			NativeToolCallParser.startStreamingToolCall(id, name)
			NativeToolCallParser.processStreamingChunk(id, json.slice(0, split))
			NativeToolCallParser.processStreamingChunk(id, json.slice(split))
			const parsed = NativeToolCallParser.finalizeStreamingToolCall(id)
			expect(parsed).not.toBeNull()
			if (!parsed || parsed.type !== "tool_use") throw new Error("Expected native tool use")
			expect((parsed.params as Record<string, string>)[field]).toBe(literal)
		}
		expect(NativeToolCallParser.hasActiveStreamingToolCalls()).toBe(false)
	})
})

describe("apply_diff protocol content fidelity", () => {
	it.each(["native", "xml"] as const)("preserves protocol semantics for %s", async (toolProtocol) => {
		const source = amp + "lt;tag" + amp + "gt;"
		const diff = ["<<<<<<< SEARCH", ":start_line:1", "-------", source, "=======", literal, ">>>>>>> REPLACE"].join(
			newline,
		)
		const applyDiff = vi.fn().mockResolvedValue({ success: false, error: "fixture inspected" })
		const task = {
			cwd: "/fixture",
			taskId: "fidelity",
			consecutiveMistakeCount: 0,
			consecutiveMistakeCountForApplyDiff: new Map(),
			api: { getModel: () => ({ id: "gpt-test" }) },
			rooIgnoreController: { validateAccess: () => true },
			diffStrategy: { applyDiff },
			recordToolError: vi.fn(),
		} as unknown as Task
		const callbacks = {
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
			removeClosingTag: vi.fn(),
			toolProtocol,
		}
		const block =
			toolProtocol === "native"
				? NativeToolCallParser.parseToolCall({
						id: "diff",
						name: "apply_diff",
						arguments: JSON.stringify({ path: "fixture.txt", diff }),
					})
				: { type: "tool_use", name: "apply_diff", params: { path: "fixture.txt", diff }, partial: false }
		await applyDiffTool.handle(task, block as ToolUse<"apply_diff">, callbacks)
		expect(callbacks.handleError).not.toHaveBeenCalled()
		expect(applyDiff).toHaveBeenCalledTimes(1)
		const actual = applyDiff.mock.calls[0][1]
		if (toolProtocol === "native") {
			expect(actual).toBe(diff)
		} else {
			expect(actual).not.toBe(diff)
			expect(actual).toContain("<tag>")
		}
	})
})
