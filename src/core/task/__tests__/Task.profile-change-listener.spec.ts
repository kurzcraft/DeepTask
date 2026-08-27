// npx vitest run core/task/__tests__/Task.profile-change-listener.spec.ts

import * as vscode from "vscode"

import type { ProviderSettings } from "@roo-code/types"
import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn().mockReturnValue(true),
		createInstance: vi.fn(),
		get instance() {
			return {
				captureTaskCreated: vi.fn(),
				captureTaskRestarted: vi.fn(),
				captureModeSwitch: vi.fn(),
				captureConversationMessage: vi.fn(),
				captureLlmCompletion: vi.fn(),
				captureConsecutiveMistakeError: vi.fn(),
				captureCodeActionUsed: vi.fn(),
				setProvider: vi.fn(),
			}
		},
	},
}))

vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	const mockEventEmitter = { event: vi.fn(), fire: vi.fn() }
	const mockTextDocument = { uri: { fsPath: "/mock/workspace/path/file.ts" } }
	const mockTextEditor = { document: mockTextDocument }
	const mockTab = { input: { uri: { fsPath: "/mock/workspace/path/file.ts" } } }
	const mockTabGroup = { tabs: [mockTab] }

	return {
		RelativePattern: vi.fn().mockImplementation((base: unknown, pattern: string) => ({ base, pattern })),
		TabInputTextDiff: vi.fn(),
		CodeActionKind: {
			QuickFix: { value: "quickfix" },
			RefactorRewrite: { value: "refactor.rewrite" },
		},
		window: {
			createTextEditorDecorationType: vi.fn().mockReturnValue({
				dispose: vi.fn(),
			}),
			visibleTextEditors: [mockTextEditor],
			tabGroups: {
				all: [mockTabGroup],
				close: vi.fn(),
				onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
			},
			showErrorMessage: vi.fn(),
		},
		workspace: {
			getConfiguration: vi.fn(() => ({ get: (_k: string, d: any) => d })),
			workspaceFolders: [
				{
					uri: { fsPath: "/mock/workspace/path" },
					name: "mock-workspace",
					index: 0,
				},
			],
			createFileSystemWatcher: vi.fn(() => ({
				onDidCreate: vi.fn(() => mockDisposable),
				onDidDelete: vi.fn(() => mockDisposable),
				onDidChange: vi.fn(() => mockDisposable),
				dispose: vi.fn(),
			})),
			fs: {
				stat: vi.fn().mockResolvedValue({ type: 1 }),
			},
			onDidSaveTextDocument: vi.fn(() => mockDisposable),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: vi.fn().mockImplementation(() => mockEventEmitter),
		Disposable: {
			from: vi.fn(),
		},
		TabInputText: vi.fn(),
		version: "1.85.0",
	}
})

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

vi.mock("../../ignore/RooIgnoreController")

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

const makeApiConfig = (model: string): ProviderSettings =>
	({
		apiProvider: "anthropic",
		apiModelId: model,
		apiKey: "test-api-key",
	}) as any

const setupProvider = (currentTask?: unknown) => {
	let listener: ((...args: unknown[]) => void) | undefined
	const mockProvider = {
		context: {
			globalStorageUri: { fsPath: "/test/storage" },
		},
		getState: vi.fn().mockResolvedValue({ apiConfiguration: makeApiConfig("new-profile-model") }),
		log: vi.fn(),
		on: vi.fn((event: string, cb: () => void) => {
			if (event === "providerProfileChanged") {
				listener = cb
			}
		}),
		off: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		updateTaskHistory: vi.fn().mockResolvedValue(undefined),
		...(currentTask === undefined ? {} : { getCurrentTask: vi.fn(() => currentTask) }),
	} as unknown as ClineProvider
	return { mockProvider, getListener: () => listener }
}

describe("Task - provider profile change listener focus guard", () => {
	it("background (non-focused) task ignores global provider profile switches", async () => {
		const { mockProvider, getListener } = setupProvider({ taskId: "another-task" })

		const task = new Task({
			context: mockProvider.context as any, // kilocode_change
			provider: mockProvider,
			apiConfiguration: makeApiConfig("old-profile-model"),
			task: "background task",
			startTask: false,
		})

		const updateSpy = vi.spyOn(task, "updateApiConfiguration").mockImplementation(() => {})

		const listener = getListener()
		expect(listener).toBeDefined()
		await listener!()

		// Background task must not follow the globally-activated profile.
		expect(updateSpy).not.toHaveBeenCalled()
		expect(task.apiConfiguration?.apiModelId).toBe("old-profile-model")
	})

	it("focused task follows global provider profile switches", async () => {
		// For the focused case, getCurrentTask must return this exact task.
		let focusedTask: unknown = { taskId: "placeholder" }
		const { mockProvider, getListener } = setupProvider(undefined)
		;(mockProvider as any).getCurrentTask = vi.fn(() => focusedTask)

		const task = new Task({
			context: mockProvider.context as any, // kilocode_change
			provider: mockProvider,
			apiConfiguration: makeApiConfig("old-profile-model"),
			task: "focused task",
			startTask: false,
		})
		focusedTask = task

		const updateSpy = vi.spyOn(task, "updateApiConfiguration").mockImplementation(() => {})

		const listener = getListener()
		expect(listener).toBeDefined()
		await listener!()

		// The focused task keeps following global profile switches.
		expect(updateSpy).toHaveBeenCalledWith(
			expect.objectContaining({ apiModelId: "new-profile-model" }),
		)
	})

	it("falls back to legacy follow-global behavior when provider has no getCurrentTask", async () => {
		const { mockProvider, getListener } = setupProvider()

		const task = new Task({
			context: mockProvider.context as any, // kilocode_change
			provider: mockProvider,
			apiConfiguration: makeApiConfig("old-profile-model"),
			task: "legacy mock task",
			startTask: false,
		})

		const updateSpy = vi.spyOn(task, "updateApiConfiguration").mockImplementation(() => {})

		const listener = getListener()
		expect(listener).toBeDefined()
		await listener!()

		// Legacy mocks without getCurrentTask keep the old behavior.
		expect(updateSpy).toHaveBeenCalledWith(
			expect.objectContaining({ apiModelId: "new-profile-model" }),
		)
	})
})
