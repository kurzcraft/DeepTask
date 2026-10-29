import { atom } from "jotai"
import {
	clearSessionMessagesAtom,
	hasSessionMessagesAtomFamily,
	lastSessionMessageAtomFamily,
	sessionMessagesAtomFamily,
	sessionMessageVersionsAtomFamily,
} from "./messages"
import { remoteSessionsAtom, sessionsMapAtom, sessionImagesAtomFamily, sessionInputAtomFamily } from "./sessions"
import { cleanupSessionMachineAtom } from "./stateMachine"
import { sessionTodosAtomFamily, sessionTodoStatsAtomFamily } from "./todos"

/** Release view-only data after the authoritative session lists remove its owner. */
export const releaseRemovedSessionAtom = atom(null, (get, set, sessionId: string) => {
	if (get(sessionsMapAtom)[sessionId] || get(remoteSessionsAtom).some((s) => s.session_id === sessionId)) {
		return
	}

	// Reset subscribed atoms before removing family keys: mounted readers must not
	// keep the removed transcript alive until their next render or unmount.
	set(clearSessionMessagesAtom, sessionId)
	set(sessionInputAtomFamily(sessionId), "")
	set(sessionImagesAtomFamily(sessionId), [])
	set(sessionTodosAtomFamily(sessionId), [])
	set(cleanupSessionMachineAtom, sessionId)

	lastSessionMessageAtomFamily.remove(sessionId)
	hasSessionMessagesAtomFamily.remove(sessionId)
	sessionTodoStatsAtomFamily.remove(sessionId)
	sessionMessagesAtomFamily.remove(sessionId)
	sessionMessageVersionsAtomFamily.remove(sessionId)
	sessionInputAtomFamily.remove(sessionId)
	sessionImagesAtomFamily.remove(sessionId)
	sessionTodosAtomFamily.remove(sessionId)
})
