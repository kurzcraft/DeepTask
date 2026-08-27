// npx vitest run core/webview/__tests__/ClineProvider.profile-focus-drift.spec.ts
//
// Regression tests for defect 1 (twelfth feedback round): while
// activateProviderProfile awaits, a new conversation can be created and pushed
// onto the task stack. The old code then wrote the newly activated profile
// into the PREVIOUS conversation's sticky profile (focus drift pollution).
// ClineProvider is too heavyweight to instantiate in unit tests, so these
// tests assert the required guard structure directly against the source.

import * as fs from "fs"
import * as path from "path"

const sourcePath = path.resolve(__dirname, "../ClineProvider.ts")

describe("ClineProvider - provider profile focus drift", () => {
	let source: string

	beforeAll(() => {
		source = fs.readFileSync(sourcePath, "utf8")
	})

	it("activateProviderProfile guards sticky write and handler rebuild against focus drift", () => {
		// The guard must capture the focused task before any await and compare
		// the reference after the awaits.
		expect(source).toContain("const focusedTaskAtEntry = this.getCurrentTask()")
		expect(source).toContain("const focusedTaskNow = this.getCurrentTask()")
		expect(source).toContain("if (focusedTaskNow === focusedTaskAtEntry) {")

		// The sticky write must live INSIDE the focus-drift guard (search after
		// the guard; the method DEFINITION appears earlier in the file).
		const guardIndex = source.indexOf("if (focusedTaskNow === focusedTaskAtEntry) {")
		const stickyIndex = source.indexOf("await this.persistStickyProviderProfileToCurrentTask(name)", guardIndex)
		expect(guardIndex).toBeGreaterThan(-1)
		expect(stickyIndex).toBeGreaterThan(guardIndex)

		// The guarded block must also contain the handler rebuild.
		const guardEnd = source.indexOf("// kilocode_change end", guardIndex)
		expect(guardEnd).toBeGreaterThan(guardIndex)
		const guardedBlock = source.slice(guardIndex, guardEnd)
		expect(guardedBlock).toContain("this.updateTaskApiHandlerIfNeeded(providerSettings")
		expect(guardedBlock).toContain("persistStickyProviderProfileToCurrentTask")
	})

	it("restoreFocusedTaskProviderProfile re-checks focus after each await", () => {
		const fnStart = source.indexOf("private async restoreFocusedTaskProviderProfile")
		expect(fnStart).toBeGreaterThan(-1)
		const fnEnd = source.indexOf("activateProviderProfile", fnStart)
		expect(fnEnd).toBeGreaterThan(fnStart)
		const fnBody = source.slice(fnStart, fnEnd)

		// Focus must be captured before the first await and re-verified after
		// every subsequent await.
		expect(fnBody).toContain("const taskAtEntry = this.getCurrentTask()")
		expect((fnBody.match(/this\.getCurrentTask\(\) !== taskAtEntry/g) ?? []).length).toBeGreaterThanOrEqual(2)
	})

	it("showTaskWithId registers the rail conversation even when history loading fails", () => {
		const fnStart = source.indexOf("async showTaskWithId")
		expect(fnStart).toBeGreaterThan(-1)
		const fnEnd = source.indexOf("async exportTaskWithId", fnStart)
		const fnBody = source.slice(fnStart, fnEnd)

		// History load must be tolerant (try/catch) and the rail registration
		// must happen afterwards regardless of history load success.
		expect(fnBody).toContain("catch (historyError)")
		const catchIndex = fnBody.indexOf("catch (historyError)")
		const ensureIndex = fnBody.indexOf("await this.parallelManager.ensureTaskConversation")
		expect(ensureIndex).toBeGreaterThan(catchIndex)
		// Workspace must fall back to the provider cwd so the conversation
		// groups under a real folder instead of a ghost path.
		expect(fnBody).toContain("taskWorkspace || this.cwd")
	})
})
