// kilocode_change - new file
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import { Package } from "../shared/package"

const widenedWindowSessions = new Set<string>()
const DEFAULT_SIDEBAR_WIDTH = 300
const VIEW_WIDTH_STEP = 40
const MIN_WINDOW_WIDTH = 640
const WIDEN_DELAY_MS = 200

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
 * Number of `increaseViewWidth` steps (40 CSS px each) needed to grow the
 * primary sidebar from the default width to about half of the window.
 */
export function sidebarGrowCountForWindowWidth(windowWidth: number): number {
	const width = Math.max(MIN_WINDOW_WIDTH, windowWidth)
	const target = Math.floor(width / 2)
	return Math.max(0, Math.ceil((target - DEFAULT_SIDEBAR_WIDTH) / VIEW_WIDTH_STEP))
}

/**
 * Widen the Deeptask primary sidebar so the main chat panel covers about half
 * of the window width. Runs at most once per window session and is triggered
 * lazily from the first webview message (the panel is guaranteed to be live
 * and rendered then), so no activation-time focus loop can make the panel
 * disappear. Uses only `increaseViewWidth`; never resizes vertically and
 * never closes or opens any workbench bar.
 *
 * Unlike earlier iterations there is NO restored-layout guard: the user
 * explicitly wants the widened chat panel in every window session.
 */
export async function widenDeeptaskChatPanelOnce(): Promise<void> {
	const sessionId = vscode.env.sessionId || "activation"
	if (widenedWindowSessions.has(sessionId)) {
		return
	}
	widenedWindowSessions.add(sessionId)

	try {
		await new Promise((resolve) => setTimeout(resolve, WIDEN_DELAY_MS))
		await vscode.commands
			.executeCommand(`${Package.name}.SidebarProvider.focus`)
			.then(
				() => undefined,
				() => undefined,
			)
		const growCount = sidebarGrowCountForWindowWidth(readWorkbenchWindowWidth())
		for (let i = 0; i < growCount; i++) {
			await vscode.commands.executeCommand("workbench.action.increaseViewWidth").then(
				() => undefined,
				() => undefined,
			)
		}
	} catch (error) {
		console.error(
			"[Deeptask] Failed to widen the main chat panel:",
			error instanceof Error ? error.message : String(error),
		)
	}
}

export function resetDeeptaskPanelWidenForTests(): void {
	widenedWindowSessions.clear()
}
