// kilocode_change - new file
import { EventEmitter } from "node:events"
import { fork } from "node:child_process"
import { RuntimeProcessHandler, type RuntimeProcessHandlerCallbacks } from "../RuntimeProcessHandler"
import type { AgentRegistry } from "../AgentRegistry"

vi.mock("node:child_process", () => ({ fork: vi.fn() }))

class FakeProcess extends EventEmitter {
	pid = 12345
	exitCode: number | null = null
	signalCode: string | null = null
	kill = vi.fn().mockReturnValue(true)
	send = vi.fn((_message: unknown, callback?: (error: Error | null) => void) => {
		callback?.(null)
		return true
	})
	ready() {
		this.emit("message", { type: "ready" })
	}
	exit(code: number | null, signal: string | null = null) {
		this.exitCode = code
		this.signalCode = signal
		this.emit("exit", code, signal)
	}
}

describe("RuntimeProcessHandler process ownership", () => {
	const handlers: RuntimeProcessHandler[] = []
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
		vi.mocked(fork).mockReset()
	})
	afterEach(() => {
		for (const handler of handlers.splice(0)) handler.dispose()
		vi.clearAllTimers()
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	function fixture() {
		const children: FakeProcess[] = []
		vi.mocked(fork).mockImplementation(() => {
			const child = new FakeProcess()
			children.push(child)
			return child as unknown as ReturnType<typeof fork>
		})
		const registry = {
			getSession: vi.fn(),
			createSession: vi.fn(),
			updateSessionStatus: vi.fn(),
			updateParallelModeInfo: vi.fn(),
			setPendingSession: vi.fn((prompt: string) => ({ prompt, label: prompt, startTime: Date.now() })),
			clearPendingSession: vi.fn(),
		}
		const callbacks: RuntimeProcessHandlerCallbacks = {
			onLog: vi.fn(),
			onSessionLog: vi.fn(),
			onStateChanged: vi.fn(),
			onPendingSessionChanged: vi.fn(),
			onStartSessionFailed: vi.fn(),
			onChatMessages: vi.fn(),
			onSessionCreated: vi.fn(),
			onSessionCompleted: vi.fn(),
		}
		const handler = new RuntimeProcessHandler(registry as unknown as AgentRegistry, callbacks)
		handlers.push(handler)
		const internal = handler as any
		vi.spyOn(internal, "getProcessEntryPath").mockReturnValue("/fake/agent.js")
		const config = vi.spyOn(internal, "buildAgentConfig").mockImplementation((...args: unknown[]) => ({
			workspace: args[0],
			prompt: args[1],
			options: args[2],
		}))
		const events = vi.fn()
		const spawn = (prompt: string, options?: Parameters<RuntimeProcessHandler["spawnProcess"]>[3]) =>
			handler.spawnProcess("", "/fake/workspace", prompt, options, events)
		return { handler, internal, children, callbacks, registry, events, spawn, config }
	}

	it("serializes only handshakes and retains concurrent active sessions and full prompts", async () => {
		const f = fixture()
		f.spawn("first complete prompt", { images: ["complete-image"] })
		f.spawn("second complete prompt")
		f.spawn("third complete prompt")
		expect(f.children).toHaveLength(1)
		f.children[0].ready()
		await Promise.resolve()
		expect(f.children).toHaveLength(2)
		expect(f.handler.getActiveSessionCount()).toBe(1)
		expect(f.children[0].send).toHaveBeenCalledWith(
			{
				type: "sendMessage",
				payload: { type: "newTask", text: "first complete prompt", images: ["complete-image"] },
			},
			expect.any(Function),
		)
		f.children[1].ready()
		await Promise.resolve()
		f.children[2].ready()
		await Promise.resolve()
		expect(f.handler.getActiveSessionCount()).toBe(3)
		expect(f.handler.hasPendingSession()).toBe(false)
		expect(f.config.mock.calls.map((args) => args[1])).toEqual([
			"first complete prompt",
			"second complete prompt",
			"third complete prompt",
		])
		expect(f.callbacks.onSessionCreated).toHaveBeenCalledTimes(3)
	})

	it("keeps queued resume history and continuation inputs intact", async () => {
		const f = fixture()
		const sessionData = {
			uiMessages: [{ ts: 1, type: "say" as const, say: "text" as const, text: "full history" }],
			apiConversationHistory: [{ role: "user", content: "necessary context" }],
			metadata: { sessionId: "resume", title: "title", createdAt: "date", mode: "code" },
		}
		f.spawn("first")
		f.spawn("continue", { sessionId: "resume", sessionData, images: ["image"] })
		f.children[0].ready()
		await Promise.resolve()
		const config = JSON.parse(vi.mocked(fork).mock.calls[1][2]!.env!.AGENT_CONFIG!)
		expect(config.options.sessionData).toEqual(sessionData)
		f.children[1].ready()
		expect(f.internal.pendingResumeContinuation.get("resume")).toEqual({ prompt: "continue", images: ["image"] })
		expect(f.callbacks.onSessionCreated).toHaveBeenLastCalledWith(false, { prompt: "continue", images: ["image"] })
	})

	it.each(["fork", "configuration"])(
		"recovers from synchronous %s failure and starts the next request",
		async (failure) => {
			const f = fixture()
			f.spawn("first")
			f.spawn("failed", { sessionId: "failed" })
			f.spawn("third")
			if (failure === "fork")
				vi.mocked(fork).mockImplementationOnce(() => {
					throw new Error("fork rejected")
				})
			else
				f.config.mockImplementationOnce(() => {
					throw new Error("configuration rejected")
				})
			f.children[0].ready()
			await Promise.resolve()
			expect(f.callbacks.onStartSessionFailed).toHaveBeenCalledTimes(1)
			expect(f.registry.updateSessionStatus).toHaveBeenCalledWith("failed", "error")
			expect(f.children).toHaveLength(2)
			expect(f.internal.pendingProcess.prompt).toBe("third")
		},
	)

	it.each(["timeout", "error-message", "error-event", "exit"])(
		"settles pending %s once and advances the queue",
		async (failure) => {
			const f = fixture()
			f.spawn("first", { sessionId: "failed" })
			f.spawn("next")
			const child = f.children[0]
			if (failure === "timeout") vi.advanceTimersByTime(30_000)
			else if (failure === "error-message")
				child.emit("message", { type: "error", error: { message: "initialization failed" } })
			else if (failure === "error-event") child.emit("error", new Error("spawn failed"))
			else child.exit(1)
			await Promise.resolve()
			expect(f.children).toHaveLength(2)
			expect(f.callbacks.onStartSessionFailed).toHaveBeenCalledTimes(1)
			expect(f.registry.updateSessionStatus).toHaveBeenCalledWith("failed", "error")
			child.ready()
			child.exit(1)
			expect(f.callbacks.onSessionCreated).not.toHaveBeenCalled()
			expect(f.callbacks.onStartSessionFailed).toHaveBeenCalledTimes(1)
			expect(f.internal.pendingProcess.process).toBe(f.children[1])
		},
	)

	it("keeps active ownership until exit and settles each terminal event exactly once", async () => {
		const f = fixture()
		f.spawn("first", { sessionId: "one" })
		f.spawn("second", { sessionId: "two" })
		f.children[0].ready()
		await Promise.resolve()
		f.children[1].ready()
		f.internal.sentApiReqStarted.add("one")
		f.internal.sessionModes.set("one", "code")
		f.handler.stopAllProcesses()
		f.handler.stopAllProcesses()
		expect(f.handler.getActiveSessionCount()).toBe(2)
		for (const child of f.children) expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM")
		f.children[0].emit("message", {
			type: "message",
			payload: { type: "state", state: { clineMessages: [{ ts: 1, text: "late" }] } },
		})
		expect(f.callbacks.onChatMessages).not.toHaveBeenCalled()
		for (const child of f.children) {
			child.exit(null, "SIGTERM")
			child.exit(null, "SIGTERM")
		}
		expect(f.handler.getActiveSessionCount()).toBe(0)
		expect(f.callbacks.onSessionCompleted).toHaveBeenCalledTimes(2)
		expect(f.events.mock.calls.filter(([, event]) => event.streamEventType === "complete")).toHaveLength(2)
		expect(f.internal.terminationTimers.size).toBe(0)
		expect(f.internal.sentApiReqStarted.size).toBe(0)
		expect(f.internal.pendingResumeContinuation.size).toBe(0)
		expect(f.internal.sessionModes.size).toBe(0)
		vi.advanceTimersByTime(60_000)
		for (const child of f.children) expect(child.kill).toHaveBeenCalledTimes(1)
	})

	it("kills only a still-live owned process after the termination grace period", () => {
		const f = fixture()
		f.spawn("first")
		const child = f.children[0]
		f.handler.cancelPendingSession()
		vi.advanceTimersByTime(4999)
		expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM")
		vi.advanceTimersByTime(1)
		expect(child.kill).toHaveBeenLastCalledWith("SIGKILL")
		expect(f.internal.terminationTimers.size).toBe(0)
		child.exit(null, "SIGKILL")
		expect(f.callbacks.onStartSessionFailed).not.toHaveBeenCalled()
	})

	it("cancels only the pending handshake while retaining queued work", async () => {
		const f = fixture()
		f.spawn("cancelled", { sessionId: "cancelled" })
		f.spawn("next")
		f.handler.cancelPendingSession()
		expect(f.handler.hasPendingSession()).toBe(true)
		await Promise.resolve()
		expect(f.registry.updateSessionStatus).toHaveBeenCalledWith("cancelled", "stopped")
		expect(f.children).toHaveLength(2)
		f.children[0].ready()
		expect(f.handler.getActiveSessionCount()).toBe(0)
		f.children[1].ready()
		expect(f.handler.getActiveSessionCount()).toBe(1)
	})

	it("does not overwrite an active session when a duplicate resume is queued", async () => {
		const f = fixture()
		f.spawn("one", { sessionId: "same" })
		f.spawn("duplicate", { sessionId: "same" })
		f.spawn("next")
		f.children[0].ready()
		await Promise.resolve()
		expect(f.children).toHaveLength(2)
		expect(f.internal.activeSessions.get("same").process).toBe(f.children[0])
		expect(f.callbacks.onStartSessionFailed).toHaveBeenCalledTimes(1)
		expect(f.internal.pendingProcess.prompt).toBe("next")
	})

	it.each(["stopAllProcesses", "dispose"] as const)(
		"%s clears queued inputs and prevents scheduled forks",
		async (operation) => {
			const f = fixture()
			f.spawn("first")
			f.spawn("queued")
			f.children[0].ready()
			f.handler[operation]()
			await Promise.resolve()
			expect(f.children).toHaveLength(1)
			expect(f.internal.spawnQueue).toHaveLength(0)
			expect(f.handler.hasPendingProcess()).toBe(false)
			if (operation === "dispose") {
				f.spawn("late")
				expect(f.children).toHaveLength(1)
				expect(f.callbacks.onStartSessionFailed).toHaveBeenCalledTimes(1)
			}
		},
	)

	it("clears the ready deadline and records successful active exit", () => {
		const f = fixture()
		f.spawn("first", { sessionId: "success" })
		f.children[0].ready()
		vi.advanceTimersByTime(60_000)
		expect(f.callbacks.onStartSessionFailed).not.toHaveBeenCalled()
		expect(f.children[0].kill).not.toHaveBeenCalled()
		f.children[0].exit(0)
		expect(f.registry.updateSessionStatus).toHaveBeenLastCalledWith("success", "done")
		expect(f.callbacks.onSessionCompleted).toHaveBeenCalledExactlyOnceWith("success", 0)
	})
})
