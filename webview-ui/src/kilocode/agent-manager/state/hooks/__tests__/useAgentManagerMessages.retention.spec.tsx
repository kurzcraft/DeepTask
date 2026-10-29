import { act, renderHook } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import type { ReactNode } from "react"
import type { ClineMessage } from "@roo-code/types"
import { useAgentManagerMessages } from "../useAgentManagerMessages"
import {
	sessionMessagesAtomFamily,
	sessionMessageVersionsAtomFamily,
	lastSessionMessageAtomFamily,
	hasSessionMessagesAtomFamily,
} from "../../atoms/messages"
import {
	sessionInputAtomFamily,
	sessionImagesAtomFamily,
	sessionsArrayAtom,
	remoteSessionsAtom,
	selectedSessionIdAtom,
	type AgentSession,
} from "../../atoms/sessions"
import { sessionTodosAtomFamily, sessionTodoStatsAtomFamily } from "../../atoms/todos"
import { __resetStateMachines, sessionMachineStateAtom, sessionMachineUiStateAtom } from "../../atoms/stateMachine"

const session = (sessionId: string, status: AgentSession["status"] = "running"): AgentSession => ({
	sessionId,
	label: sessionId,
	prompt: "Full prompt",
	status,
	startTime: 1,
	source: "local",
})
const state = (sessions: AgentSession[], selectedId: string | null = null) => {
	window.dispatchEvent(
		new MessageEvent("message", {
			data: {
				type: "agentManager.state",
				state: { sessions, selectedId },
			},
		}),
	)
}
const transcript = (sessionId: string, messages: ClineMessage[]) => {
	window.dispatchEvent(
		new MessageEvent("message", {
			data: {
				type: "agentManager.chatMessages",
				sessionId,
				messages,
			},
		}),
	)
}

describe("Agent Manager removed-session retention", () => {
	beforeEach(() => __resetStateMachines())
	afterEach(() => __resetStateMachines())

	function setup() {
		const store = createStore()
		const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
		const hook = renderHook(() => useAgentManagerMessages(), { wrapper })
		return { store, ...hook }
	}

	function seed(store: ReturnType<typeof createStore>, id: string) {
		const messages: ClineMessage[] = [
			{
				ts: 10,
				type: "say",
				say: "text",
				text: "完整正文\\n <>& 引号",
				images: ["data:image/png;base64,cHJlc2VydmU="],
			},
		]
		act(() => {
			transcript(id, messages)
			store.set(sessionInputAtomFamily(id), "Unsent draft")
			store.set(sessionImagesAtomFamily(id), ["data:image/png;base64,ZHJhZnQ="])
			store.set(sessionTodosAtomFamily(id), [{ id: "todo", content: "Preserve task", status: "pending" }])
		})
		return messages
	}

	it("releases removed local payloads, derived values and family identities", () => {
		const { store } = setup()
		const id = "retention-removed"
		act(() => state([session(id)], id))
		seed(store, id)
		const messagesAtom = sessionMessagesAtomFamily(id)
		const lastAtom = lastSessionMessageAtomFamily(id)
		const hasAtom = hasSessionMessagesAtomFamily(id)
		const statsAtom = sessionTodoStatsAtomFamily(id)
		const families = [
			sessionMessagesAtomFamily,
			sessionMessageVersionsAtomFamily,
			lastSessionMessageAtomFamily,
			hasSessionMessagesAtomFamily,
			sessionInputAtomFamily,
			sessionImagesAtomFamily,
			sessionTodosAtomFamily,
			sessionTodoStatsAtomFamily,
		]
		const oldAtoms = families.map((family) => family(id))
		expect(store.get(lastAtom)?.text).toContain("完整正文")
		expect(store.get(statsAtom).totalCount).toBe(1)
		act(() => state([]))
		expect(store.get(messagesAtom)).toEqual([])
		expect(store.get(lastAtom)).toBeNull()
		expect(store.get(hasAtom)).toBe(false)
		expect(store.get(statsAtom).totalCount).toBe(0)
		expect(store.get(sessionMessageVersionsAtomFamily(id)).size).toBe(0)
		expect(store.get(sessionInputAtomFamily(id))).toBe("")
		expect(store.get(sessionImagesAtomFamily(id))).toEqual([])
		expect(store.get(sessionTodosAtomFamily(id))).toEqual([])
		expect(store.get(sessionMachineStateAtom)[id]).toBeUndefined()
		expect(store.get(sessionMachineUiStateAtom)[id]).toBeUndefined()
		families.forEach((family, index) => expect(family(id)).not.toBe(oldAtoms[index]))
	})

	it.each(["done", "stopped", "error", "running"] as const)(
		"preserves full data for retained %s sessions",
		(status) => {
			const { store } = setup()
			const id = "retention-kept-" + status
			act(() => state([session(id), session("remove-neighbor")], id))
			const messages = seed(store, id)
			const original = sessionMessagesAtomFamily(id)
			act(() => state([session(id, status)], id))
			expect(sessionMessagesAtomFamily(id)).toBe(original)
			expect(store.get(original)).toEqual(messages)
			expect(store.get(sessionInputAtomFamily(id))).toBe("Unsent draft")
			expect(store.get(sessionImagesAtomFamily(id))).toHaveLength(1)
			expect(store.get(sessionTodosAtomFamily(id))).toHaveLength(1)
		},
	)

	it("retains payloads when a local session still exists remotely", () => {
		const { store } = setup()
		const id = "retention-remote"
		act(() => {
			store.set(remoteSessionsAtom, [
				{ session_id: id, title: "Remote", created_at: "2026-01-01", updated_at: "2026-01-01" },
			])
			state([session(id)], id)
		})
		const messages = seed(store, id)
		act(() => state([]))
		expect(store.get(sessionMessagesAtomFamily(id))).toEqual(messages)
		expect(store.get(sessionInputAtomFamily(id))).toBe("Unsent draft")
		expect(store.get(sessionImagesAtomFamily(id))).toHaveLength(1)
		expect(store.get(sessionTodosAtomFamily(id))).toHaveLength(1)
	})

	it.each([false, true])("reconciles remote removal while local retention is %s", (keepLocal) => {
		const { store } = setup()
		const id = keepLocal ? "remote-kept-locally" : "remote-removed"
		act(() => {
			if (keepLocal) state([session(id)], id)
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "agentManager.remoteSessions",
						sessions: [
							{ session_id: id, title: "Remote", created_at: "2026-01-01", updated_at: "2026-01-01" },
						],
					},
				}),
			)
		})
		const messages = seed(store, id)
		const original = sessionMessagesAtomFamily(id)
		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", { data: { type: "agentManager.remoteSessions", sessions: [] } }),
			)
		})
		expect(store.get(original)).toEqual(keepLocal ? messages : [])
		expect(store.get(sessionInputAtomFamily(id))).toBe(keepLocal ? "Unsent draft" : "")
		expect(store.get(sessionImagesAtomFamily(id))).toHaveLength(keepLocal ? 1 : 0)
		expect(store.get(sessionTodosAtomFamily(id))).toHaveLength(keepLocal ? 1 : 0)
		expect(sessionMessagesAtomFamily(id) === original).toBe(keepLocal)
	})

	it("reconciles successive snapshots before React rerenders without leaking a removed session", () => {
		const { store } = setup()
		act(() => {
			state([session("same-batch")], "same-batch")
			transcript("same-batch", [{ ts: 12, type: "say", say: "text", text: "Payload" }])
			state([])
		})
		expect(store.get(sessionsArrayAtom)).toEqual([])
		expect(store.get(selectedSessionIdAtom)).toBeNull()
		expect(store.get(sessionMessagesAtomFamily("same-batch"))).toEqual([])
		expect(store.get(sessionMachineStateAtom)["same-batch"]).toBeUndefined()
	})

	it("restores the same id from a subsequent full snapshot without old drafts", () => {
		const { store } = setup()
		const id = "retention-reopened"
		act(() => state([session(id)], id))
		seed(store, id)
		act(() => state([]))
		const restored: ClineMessage[] = [
			{ ts: 15, type: "say", say: "text", text: "完整恢复", images: ["data:image/png;base64,cmVzdG9yZWQ="] },
		]
		act(() => {
			state([session(id)], id)
			transcript(id, restored)
		})
		expect(store.get(sessionMessagesAtomFamily(id))).toEqual(restored)
		expect(store.get(sessionInputAtomFamily(id))).toBe("")
		expect(store.get(sessionImagesAtomFamily(id))).toEqual([])
		expect(store.get(sessionMachineStateAtom)[id]).toBeDefined()
	})
})
