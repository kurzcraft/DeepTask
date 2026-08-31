// npx vitest run core/webview/__tests__/ClineProvider.model-crosstalk.spec.ts
// Regression for 9.1.4 stage-4c: switching models for a brand-new parallel
// conversation must never rebuild the API handler of an older background
// conversation. getFocusedChatTask() can return undefined while the focused
// conversation has no live Task yet; the old code then fell back to the
// stack-top task and silently re-pointed that older conversation's model.

import { readFileSync } from "fs"
import { join } from "path"

describe("updateTaskApiHandlerIfNeeded model cross-talk guard (9.1.4)", () => {
	const source = readFileSync(
		join(__dirname, "..", "ClineProvider.ts"),
		"utf8",
	)

	it("does not fall back to the stack-top task when a focused conversation has no live Task", () => {
		const start = source.indexOf("private updateTaskApiHandlerIfNeeded")
		expect(start).toBeGreaterThan(-1)
		const end = source.indexOf("getProviderProfileEntries", start)
		const body = source.slice(start, end)

		// The guard must bail out when the focused conversation exists
		// (focusedConversationId set) but resolves to no live Task.
		expect(body).toContain("focusedConversationId")
		// And the fallback must happen only after that guard (plain legacy path).
		const guardIdx = body.indexOf("focusedConversationId")
		const fallbackIdx = body.indexOf("task ??= this.getCurrentTask()")
		expect(guardIdx).toBeGreaterThan(-1)
		expect(fallbackIdx).toBeGreaterThan(guardIdx)
	})
})
