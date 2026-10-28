// kilocode_change - new file
import * as vscode from "vscode"

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

import { TelemetryService } from "@roo-code/telemetry"

import { ContextProxy } from "../../config/ContextProxy"
import { ClineProvider } from "../ClineProvider"

vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue(""),
	unlink: vi.fn().mockResolvedValue(undefined),
	rmdir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../../utils/storage", () => ({
	getSettingsDirectoryPath: vi.fn().mockResolvedValue("/test/settings/path"),
	getTaskDirectoryPath: vi.fn().mockResolvedValue("/test/task/path"),
	getGlobalStoragePath: vi.fn().mockResolvedValue("/test/storage/path"),
}))

vi.mock("p-wait-for", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	OutputChannel: vi.fn(),
	WebviewView: vi.fn(),
	Uri: {
		joinPath: vi.fn(),
		file: vi.fn(),
	},
	commands: {
		executeCommand: vi.fn().mockResolvedValue(undefined),
	},
	window: {
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
		createTextEditorDecorationType: vi.fn(() => ({
			key: "mock-decoration",
			dispose: vi.fn(),
		})),
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue([]),
			update: vi.fn(),
		}),
		onDidChangeConfiguration: vi.fn().mockImplementation(() => ({
			dispose: vi.fn(),
		})),
	},
	env: {
		uriScheme: "vscode",
		language: "en",
		appName: "Visual Studio Code",
		uiKind: 1,
		machineId: "test-machine",
	},
	UIKind: {
		Desktop: 1,
		Web: 2,
		1: "Desktop",
		2: "Web",
	},
	ExtensionMode: {
		Production: 1,
		Development: 2,
		Test: 3,
	},
	version: "1.85.0",
}))

vi.mock("../../../utils/tts", () => ({
	setTtsEnabled: vi.fn(),
	setTtsSpeed: vi.fn(),
}))

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn(),
}))

vi.mock("../../../integrations/workspace/WorkspaceTracker", () => ({
	default: vi.fn().mockImplementation(() => ({
		initializeFilePaths: vi.fn(),
		dispose: vi.fn(),
	})),
}))

vi.mock("../../task/Task", () => ({
	Task: vi.fn(),
}))

vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(true),
		get instance() {
			return {
				isAuthenticated: vi.fn().mockReturnValue(false),
				isCloudAgent: true,
				off: vi.fn(),
			}
		},
	},
	BridgeOrchestrator: {
		isEnabled: vi.fn().mockReturnValue(false),
	},
	getRooCodeApiUrl: vi.fn().mockReturnValue("https://app.roocode.com"),
}))

vi.mock("../../../shared/kilocode/cli-sessions/core/SessionManager", () => ({
	SessionManager: {
		init: vi.fn().mockReturnValue({
			startTimer: vi.fn(),
			setPath: vi.fn(),
			setWorkspaceDirectory: vi.fn(),
			destroy: vi.fn().mockResolvedValue(undefined),
		}),
	},
}))

describe("ClineProvider postStateToWebview coalesce", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel

	beforeEach(() => {
		vi.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		const globalState: Record<string, unknown> = {
			mode: "code",
			currentApiConfigName: "test-config",
		}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi.fn().mockImplementation((key: string, value: unknown) => {
					globalState[key] = value
				}),
				keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
			},
			workspaceState: {
				get: vi.fn().mockResolvedValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: {
				get: vi.fn(),
				store: vi.fn(),
				delete: vi.fn(),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))
		;(provider as any).customModesManager = {
			updateCustomMode: vi.fn(),
			getCustomModes: vi.fn().mockResolvedValue([]),
			dispose: vi.fn(),
		}
		;(provider as any)._parallelManager = {
			broadcast: vi.fn().mockResolvedValue(undefined),
		}
		;(provider as any)._parallelInit = Promise.resolve()
	})

	afterEach(async () => {
		await provider.dispose()
	})

	it("awaits the real postMessage and preserves clineMessages", async () => {
		const posted: unknown[] = []
		vi.spyOn(provider, "getStateToPostToWebview").mockResolvedValue({
			clineMessages: [{ ts: 1, type: "say", say: "text", text: "hello" }],
		} as any)
		vi.spyOn(provider, "postMessageToWebview").mockImplementation(async (message) => {
			await delay(15)
			posted.push(message)
		})

		await provider.postStateToWebview()

		expect(posted).toEqual([
			{
				type: "state",
				state: { clineMessages: [{ ts: 1, type: "say", say: "text", text: "hello" }] },
			},
		])
	})

	it("rebuilds the trailing snapshot after concurrent mutations instead of holding the queued state", async () => {
		const snapshots: string[] = []
		let current = "first"
		let releaseFirst!: () => void
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve
		})
		let builds = 0

		vi.spyOn(provider, "getStateToPostToWebview").mockImplementation(async () => {
			builds += 1
			const captured = current
			if (builds === 1) {
				await firstGate
			}
			return { clineMessages: [{ ts: builds, type: "say", say: "text", text: captured }] } as any
		})
		vi.spyOn(provider, "postMessageToWebview").mockImplementation(async (message) => {
			if (message.type === "state") {
				snapshots.push((message.state as any).clineMessages[0].text)
			}
			await delay(5)
		})

		const first = provider.postStateToWebview()
		await delay(5)
		current = "second"
		const second = provider.postStateToWebview()
		current = "latest"
		const third = provider.postStateToWebview()
		releaseFirst()
		await Promise.all([first, second, third])

		expect(snapshots).toEqual(["first", "latest"])
		expect(builds).toBe(2)
	})

	it("keeps at most one in-flight send while coalescing concurrent callers", async () => {
		let inFlight = 0
		let maxInFlight = 0
		let sends = 0
		let releaseFirst!: () => void
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve
		})

		vi.spyOn(provider, "getStateToPostToWebview").mockResolvedValue({ clineMessages: [] } as any)
		vi.spyOn(provider, "postMessageToWebview").mockImplementation(async (message) => {
			if (message.type !== "state") {
				return
			}
			inFlight += 1
			maxInFlight = Math.max(maxInFlight, inFlight)
			sends += 1
			if (sends === 1) {
				await firstGate
			} else {
				await delay(10)
			}
			inFlight -= 1
		})

		const first = provider.postStateToWebview()
		await delay(5)
		const callers = [
			first,
			provider.postStateToWebview(),
			provider.postStateToWebview(),
			provider.postStateToWebview(),
		]
		releaseFirst()
		await Promise.all(callers)

		expect(maxInFlight).toBe(1)
		expect(sends).toBe(2)
	})

	it("propagates send errors without permanently blocking a later retry", async () => {
		let shouldFail = true
		vi.spyOn(provider, "getStateToPostToWebview").mockResolvedValue({ clineMessages: [] } as any)
		vi.spyOn(provider, "postMessageToWebview").mockImplementation(async () => {
			await delay(8)
			if (shouldFail) {
				throw new Error("webview post failed")
			}
		})

		await expect(provider.postStateToWebview()).rejects.toThrow("webview post failed")
		shouldFail = false
		await expect(provider.postStateToWebview()).resolves.toBeUndefined()
	})

	it("redirects to the account tab when MDM requires cloud auth", async () => {
		const posted: Array<{ type: string; action?: string }> = []
		;(provider as any).mdmService = {
			requiresCloudAuth: () => true,
			isCompliant: () => ({ compliant: false }),
		}
		vi.spyOn(provider, "getStateToPostToWebview").mockResolvedValue({ clineMessages: [] } as any)
		vi.spyOn(provider, "postMessageToWebview").mockImplementation(async (message) => {
			posted.push({ type: message.type, action: (message as any).action })
			await delay(5)
		})
		await delay(20)
		posted.length = 0

		await provider.postStateToWebview()

		expect(posted).toEqual([
			{ type: "state", action: undefined },
			{ type: "action", action: "cloudButtonClicked" },
		])
	})

	it("schedules a real parallel broadcast after the coalesced state send", async () => {
		const broadcast = vi.fn().mockResolvedValue(undefined)
		;(provider as any)._parallelManager = { broadcast }
		;(provider as any)._parallelInit = Promise.resolve()
		vi.spyOn(provider, "getStateToPostToWebview").mockResolvedValue({ clineMessages: [] } as any)
		vi.spyOn(provider, "postMessageToWebview").mockResolvedValue(undefined)
		await delay(20)
		broadcast.mockClear()

		await provider.postStateToWebview()
		await delay(10)

		expect(broadcast).toHaveBeenCalledTimes(1)
	})
})
