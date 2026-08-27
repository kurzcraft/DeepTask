// kilocode_change - new file
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import { Package } from "../shared/package"

const alignedWindowSessions = new Set<string>()
const DEFAULT_SIDEBAR_WIDTH = 300
const VIEW_WIDTH_STEP = 40
const MIN_WINDOW_WIDTH = 640

function windowSessionId(): string {
	return vscode.env.sessionId || "activation"
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function windowWidthFromState(raw: unknown): number | undefined {
	if (!raw || typeof raw !== "object") {
		return undefined
	}

	const state = raw as {
		windowsState?: {
			lastActiveWindow?: { width?: unknown }
			openedWindows?: Array<{ width?: unknown }>
		}
		lastActiveWindow?: { width?: unknown }
	}

	return (
		readNumber(state.windowsState?.lastActiveWindow?.width) ??
		readNumber(state.windowsState?.openedWindows?.[0]?.width) ??
		readNumber(state.lastActiveWindow?.width)
	)
}

function storageCandidates(): string[] {
	const home = os.homedir()
	const names = ["VSCodium", "Code", "Code - OSS", "Cursor", "Windsurf"]
	return names.flatMap((name) => [
		path.join(home, ".config", name, "storage.json"),
		path.join(home, ".config", name, "User", "globalStorage", "storage.json"),
	])
}

export function readWorkbenchWindowWidth(): number {
	for (const filePath of storageCandidates()) {
		try {
			const width = windowWidthFromState(JSON.parse(fs.readFileSync(filePath, "utf8")))
			if (width && width >= MIN_WINDOW_WIDTH) {
				return width
			}
		} catch {
			continue
		}
	}

	return 1920
}

/**
 * Grow the Deeptask main chat panel (primary sidebar view) until it covers
 * about half of the window width. Each increaseViewWidth step is
 * VIEW_WIDTH_STEP CSS pixels.
 */
export function sidebarGrowCountForWindowWidth(windowWidth: number): number {
	const width = Math.max(MIN_WINDOW_WIDTH, windowWidth)
	const target = Math.floor(width / 2)
	return Math.max(0, Math.ceil((target - DEFAULT_SIDEBAR_WIDTH) / VIEW_WIDTH_STEP))
}

function isWelcomeOrEmptyTab(tab: vscode.Tab): boolean {
	const input = tab.input as { viewType?: string; uri?: vscode.Uri } | undefined
	const viewType = input?.viewType ?? ""
	const uri = input?.uri
	const scheme = uri?.scheme ?? ""
	const pathValue = uri?.path ?? tab.label ?? ""
	return (
		scheme === "walkThrough" ||
		scheme === "vscode-welcome" ||
		viewType.includes("welcome") ||
		/welcome/i.test(pathValue) ||
		/getting.?started/i.test(pathValue)
	)
}

const RESTORED_FILE_TAB_THRESHOLD = 4

/**
 * Only a previously customized workbench should keep its sidebar width.
 * Opening a folder with a couple of files, or Welcome, is not a restored layout.
 */
export function isRestoredWorkbenchLayout(): boolean {
	const groups = vscode.window.tabGroups.all
	if (groups.length > 1) {
		return true
	}
	const restoredTabs = groups.reduce((count, group) => {
		return count + group.tabs.filter((tab) => !isWelcomeOrEmptyTab(tab)).length
	}, 0)
	return restoredTabs >= RESTORED_FILE_TAB_THRESHOLD
}

/**
 * On a fresh VSCodium/VS Code window, keep Deeptask in the primary (left)
 * sidebar and grow that sidebar so the main chat panel covers about half of
 * the window width. Do not close or open any workbench bar. Skip this when
 * the window restored the previous session layout.
 */
export async function alignDeeptaskPanelToWindowCenter(
	_context?: vscode.ExtensionContext,
): Promise<void> {
	const sessionId = windowSessionId()
	if (alignedWindowSessions.has(sessionId)) {
		return
	}

	if (isRestoredWorkbenchLayout()) {
		alignedWindowSessions.add(sessionId)
		return
	}

	try {
		await new Promise((resolve) => setTimeout(resolve, 400))
		await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
		await vscode.commands.executeCommand("workbench.action.focusSideBar").then(
			() => undefined,
			() => undefined,
		)
		await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
		await new Promise((resolve) => setTimeout(resolve, 150))

		const growCount = sidebarGrowCountForWindowWidth(readWorkbenchWindowWidth())
		for (let i = 0; i < growCount; i++) {
			await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
			await vscode.commands.executeCommand("workbench.action.increaseViewSize").then(
				() => undefined,
				() => undefined,
			)
			await vscode.commands.executeCommand("workbench.action.increaseViewWidth").then(
				() => undefined,
				() => undefined,
			)
		}

		alignedWindowSessions.add(sessionId)
	} catch (error) {
		console.error(
			"[Deeptask] Failed to align the main panel to the window center:",
			error instanceof Error ? error.message : String(error),
		)
	}
}

export function resetDeeptaskPanelAlignmentForTests(): void {
	alignedWindowSessions.clear()
}
