// kilocode_change - new file
import { NativeToolCallParser } from "../NativeToolCallParser"

describe("request owned native parsing", () => {
	afterEach(() => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	})

	it("keeps identical local indices and call IDs independent during interleaved arguments", () => {
		const a = NativeToolCallParser.createSession()
		const b = NativeToolCallParser.createSession()
		for (const parser of [a, b]) {
			expect(parser.processRawChunk({ index: 0, id: "same", name: "write_to_file" })).toEqual([
				{ type: "tool_call_start", id: "same", name: "write_to_file" },
			])
			parser.startStreamingToolCall("same", "write_to_file")
		}
		const jsonA = JSON.stringify({ path: "a.txt", content: "A: " + "x".repeat(1024) })
		const jsonB = JSON.stringify({ path: "b.txt", content: "B: " + "y".repeat(1024) })
		for (let i = 0; i < Math.max(jsonA.length, jsonB.length); i += 13) {
			a.processStreamingChunk("same", jsonA.slice(i, i + 13))
			b.processStreamingChunk("same", jsonB.slice(i, i + 13))
		}
		expect(a.finalizeStreamingToolCall("same")).toMatchObject({
			nativeArgs: { path: "a.txt", content: "A: " + "x".repeat(1024) },
		})
		expect(b.finalizeStreamingToolCall("same")).toMatchObject({
			nativeArgs: { path: "b.txt", content: "B: " + "y".repeat(1024) },
		})
		expect(a.hasActiveStreamingToolCalls()).toBe(false)
		expect(b.hasActiveStreamingToolCalls()).toBe(false)
		expect(NativeToolCallParser.hasActiveStreamingToolCalls()).toBe(false)
	})

	it("does not let cancellation or retry cleanup discard another request", () => {
		const cancelled = NativeToolCallParser.createSession()
		const live = NativeToolCallParser.createSession()
		cancelled.processRawChunk({ index: 0, id: "cancelled", name: "write_to_file" })
		live.processRawChunk({ index: 0, id: "live", arguments: '{"path":"live.txt",' })
		cancelled.startStreamingToolCall("same", "write_to_file")
		live.startStreamingToolCall("same", "write_to_file")
		live.processStreamingChunk("same", '{"path":"live.txt",')
		cancelled.clearAllStreamingToolCalls()
		cancelled.clearRawChunkState()
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
		expect(live.processRawChunk({ index: 0, name: "write_to_file", arguments: '"content":"live"}' })).toEqual([
			{ type: "tool_call_start", id: "live", name: "write_to_file" },
			{ type: "tool_call_delta", id: "live", delta: '{"path":"live.txt",' },
			{ type: "tool_call_delta", id: "live", delta: '"content":"live"}' },
		])
		live.processStreamingChunk("same", '"content":"live"}')
		expect(live.finalizeStreamingToolCall("same")).toMatchObject({
			nativeArgs: { path: "live.txt", content: "live" },
		})
		expect(live.finalizeRawChunks()).toEqual([{ type: "tool_call_end", id: "live" }])
		expect(live.finalizeRawChunks()).toEqual([])
		expect(cancelled.finalizeRawChunks()).toEqual([])
		expect(NativeToolCallParser.createSession().finalizeRawChunks()).toEqual([])
	})

	it("does not clear legacy static callers or retain failed request buffers in a new session", () => {
		NativeToolCallParser.startStreamingToolCall("legacy", "write_to_file")
		const failed = NativeToolCallParser.createSession()
		failed.startStreamingToolCall("bad", "write_to_file")
		failed.processStreamingChunk("bad", "{")
		failed.clearAllStreamingToolCalls()
		failed.clearRawChunkState()
		expect(failed.hasActiveStreamingToolCalls()).toBe(false)
		expect(NativeToolCallParser.hasActiveStreamingToolCalls()).toBe(true)
		const retry = NativeToolCallParser.createSession()
		retry.startStreamingToolCall("bad", "write_to_file")
		retry.processStreamingChunk("bad", JSON.stringify({ path: "retry.txt", content: "complete" }))
		expect(retry.finalizeStreamingToolCall("bad")).toMatchObject({
			nativeArgs: { path: "retry.txt", content: "complete" },
		})
	})

	it("releases request-owned raw chunk buffers after finish, finalize, or cancel", () => {
		const finished = NativeToolCallParser.createSession()
		finished.processRawChunk({
			index: 0,
			id: "done",
			name: "write_to_file",
			arguments: '{"path":"done.txt"}',
		})
		expect(finished.processFinishReason("tool_calls")).toEqual([{ type: "tool_call_end", id: "done" }])
		expect(finished.processFinishReason("tool_calls")).toEqual([])
		expect(finished.finalizeRawChunks()).toEqual([])

		const leftover = NativeToolCallParser.createSession()
		leftover.processRawChunk({
			index: 0,
			id: "stop",
			name: "write_to_file",
			arguments: '{"path":"stop.txt"}',
		})
		expect(leftover.processFinishReason("stop")).toEqual([])
		expect(leftover.finalizeRawChunks()).toEqual([{ type: "tool_call_end", id: "stop" }])
		expect(leftover.finalizeRawChunks()).toEqual([])

		const cancelled = NativeToolCallParser.createSession()
		cancelled.processRawChunk({
			index: 0,
			id: "cancelled",
			name: "write_to_file",
			arguments: '{"path":"cancelled.txt","content":"' + "x".repeat(2048) + '"}',
		})
		cancelled.startStreamingToolCall("cancelled", "write_to_file")
		cancelled.processStreamingChunk("cancelled", '{"path":"cancelled.txt"}')
		cancelled.clearAllStreamingToolCalls()
		cancelled.clearRawChunkState()
		expect(cancelled.hasActiveStreamingToolCalls()).toBe(false)
		expect(cancelled.finalizeRawChunks()).toEqual([])
		expect(cancelled.finalizeStreamingToolCall("cancelled")).toBeNull()
	})
})
