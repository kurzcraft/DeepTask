import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("vscode", () => ({
	env: { sessionId: "window-1" },
	commands: {
		executeCommand: vi.fn().mockResolvedValue(undefined),
	},
	window: {
		tabGroups: { all: [] as Array<{ tabs: unknown[] }> },
	},
	workspace: {
		textDocuments: [] as Array<{ isUntitled: boolean }>,
	},
}))

import * as vscode from "vscode"
import {
	alignDeeptaskPanelToWindowCenter,
	resetDeeptaskPanelAlignmentForTests,
	sidebarGrowCountForWindowWidth,
} from "../alignDeeptaskPanel"

describe("alignDeeptaskPanelToWindowCenter", () => {
	afterEach(() => {
		resetDeeptaskPanelAlignmentForTests()
		;(vscode.window.tabGroups.all as unknown as Array<{ tabs: unknown[] }>).length = 0
		;(vscode.workspace.textDocuments as unknown as Array<{ isUntitled: boolean }>).length = 0
		vi.clearAllMocks()
	})

	it("keeps Deeptask in the primary sidebar and closes the auxiliary bar", async () => {
		await alignDeeptaskPanelToWindowCenter()
		const commands = vi.mocked(vscode.commands.executeCommand).mock.calls.map((call) => call[0])
		expect(commands).toContain("workbench.action.closeAuxiliaryBar")
		expect(commands).toContain("workbench.action.focusSideBar")
		expect(commands).not.toContain("workbench.action.moveFocusedViewToSecondarySideBar")
		expect(commands).not.toContain("workbench.action.focusAuxiliaryBar")
		expect(commands.filter((command) => command === "workbench.action.increaseViewSize").length).toBeGreaterThan(0)
		expect(commands.filter((command) => command === "workbench.action.increaseViewWidth").length).toBeGreaterThan(0)
	})

	it("does not realign the same window session twice", async () => {
		await alignDeeptaskPanelToWindowCenter()
		vi.mocked(vscode.commands.executeCommand).mockClear()
		await alignDeeptaskPanelToWindowCenter()
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
	})

	it("does not change a restored previous-session layout", async () => {
		;(vscode.window.tabGroups.all as unknown as Array<{ tabs: unknown[] }>).push({
			tabs: [
				{ label: "a.ts", input: { uri: { scheme: "file", path: "/repo/a.ts" } } },
				{ label: "b.ts", input: { uri: { scheme: "file", path: "/repo/b.ts" } } },
				{ label: "c.ts", input: { uri: { scheme: "file", path: "/repo/c.ts" } } },
				{ label: "d.ts", input: { uri: { scheme: "file", path: "/repo/d.ts" } } },
			],
		})
		await alignDeeptaskPanelToWindowCenter()
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
	})

	it("still grows the sidebar when only a few restored files are open", async () => {
		;(vscode.window.tabGroups.all as unknown as Array<{ tabs: unknown[] }>).push({
			tabs: [{ label: "README.md", input: { uri: { scheme: "file", path: "/repo/README.md" } } }],
		})
		await alignDeeptaskPanelToWindowCenter()
		const commands = vi.mocked(vscode.commands.executeCommand).mock.calls.map((call) => call[0])
		expect(commands.filter((command) => command === "workbench.action.increaseViewWidth").length).toBeGreaterThan(0)
	})

	it("still grows the sidebar when only a welcome tab is open", async () => {
		;(vscode.window.tabGroups.all as unknown as Array<{ tabs: unknown[] }>).push({
			tabs: [{ label: "Welcome", input: { viewType: "workbench.editor.welcome" } }],
		})
		await alignDeeptaskPanelToWindowCenter()
		const commands = vi.mocked(vscode.commands.executeCommand).mock.calls.map((call) => call[0])
		expect(commands.filter((command) => command === "workbench.action.increaseViewWidth").length).toBeGreaterThan(0)
		expect(commands).not.toContain("workbench.action.focusActiveEditorGroup")
	})

	it("grows about three times the previous half-window target, capped inside the window", () => {
		expect(sidebarGrowCountForWindowWidth(1280)).toBeLessThan(sidebarGrowCountForWindowWidth(2560))
		expect(sidebarGrowCountForWindowWidth(1920)).toBe(37)
	})
})
