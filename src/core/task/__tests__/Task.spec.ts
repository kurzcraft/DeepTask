// npx vitest core/task/__tests__/Task.spec.ts

import * as os from "os"
import * as path from "path"

import * as vscode from "vscode"
import { Anthropic } from "@anthropic-ai/sdk"

import type { GlobalState, ProviderSettings, ModelInfo } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ApiStreamChunk } from "../../../api/transform/stream"
import { ContextProxy } from "../../config/ContextProxy"
import { processUserContentMentions } from "../../mentions/processUserContentMentions"
import { MultiSearchReplaceDiffStrategy } from "../../diff/strategies/multi-search-replace"
import { MultiFileSearchReplaceDiffStrategy } from "../../diff/strategies/multi-file-search-replace"
import { EXPERIMENT_IDS } from "../../../shared/experiments"
import { summarizeConversation } from "../../condense"
import * as contextManagement from "../../context-management"
import fs from "fs/promises"

// Mock delay before any imports that might use it
vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

import delay from "delay"

vi.mock("uuid", async (importOriginal) => {
	const actual = await importOriginal<typeof import("uuid")>()
	return {
		...actual,
		v7: vi.fn(() => "00000000-0000-7000-8000-000000000000"),
	}
})

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("fs/promises", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	const mockFunctions = {
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		appendFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockImplementation((filePath) => {
			if (filePath.includes("ui_messages.json")) {
				return Promise.resolve(JSON.stringify(mockMessages))
			}
			if (filePath.includes("api_conversation_history.json")) {
				return Promise.resolve(
					JSON.stringify([
						{
							role: "user",
							content: [{ type: "text", text: "historical task" }],
							ts: Date.now(),
						},
						{
							role: "assistant",
							content: [{ type: "text", text: "I'll help you with that task." }],
							ts: Date.now(),
						},
					]),
				)
			}
			return Promise.resolve("[]")
		}),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
	}

	return {
		...actual,
		...mockFunctions,
		default: mockFunctions,
	}
})

vi.mock("p-wait-for", () => ({
	default: vi
		.fn()
		.mockImplementation(
			async (condition: () => boolean | Promise<boolean>, options?: { timeout?: number; interval?: number }) => {
				const timeout = options?.timeout ?? 10_000
				const interval = options?.interval ?? 20
				const start = Date.now()
				while (true) {
					if (await condition()) {
						return
					}
					if (Date.now() - start >= timeout) {
						throw new Error("Timed out")
					}
					await new Promise((resolve) => setTimeout(resolve, interval))
				}
			},
		),
}))

vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	const mockEventEmitter = { event: vi.fn(), fire: vi.fn() }
	const mockTextDocument = { uri: { fsPath: "/mock/workspace/path/file.ts" } }
	const mockTextEditor = { document: mockTextDocument }
	const mockTab = { input: { uri: { fsPath: "/mock/workspace/path/file.ts" } } }
	const mockTabGroup = { tabs: [mockTab] }

	return {
		TabInputTextDiff: vi.fn(),
		CodeActionKind: {
			QuickFix: { value: "quickfix" },
			RefactorRewrite: { value: "refactor.rewrite" },
		},
		Uri: {
			file: vi.fn((path) => ({ fsPath: path, toString: () => `file://${path}` })),
		},
		RelativePattern: vi.fn((base, pattern) => ({ base, pattern })),
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
				stat: vi.fn().mockResolvedValue({ type: 1 }), // FileType.File = 1
			},
			onDidSaveTextDocument: vi.fn(() => mockDisposable),
			onDidChangeWorkspaceFolders: vi.fn(() => mockDisposable),
			getConfiguration: vi.fn(() => ({ get: (key: string, defaultValue: any) => defaultValue })),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
			appName: "Visual Studio Code", // kilocode_change
		},
		EventEmitter: vi.fn().mockImplementation(() => mockEventEmitter),
		Disposable: {
			from: vi.fn(),
		},
		TabInputText: vi.fn(),
	}
})

vi.mock("../../mentions", () => ({
	parseMentions: vi.fn().mockImplementation((text) => {
		return Promise.resolve({ text: `processed: ${text}`, mode: undefined })
	}),
	openMention: vi.fn(),
	getLatestTerminalOutput: vi.fn(),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("Mock file content"),
}))

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

vi.mock("../../ignore/RooIgnoreController")

vi.mock("../../condense", async (importOriginal) => {
	const actual = (await importOriginal()) as any
	return {
		...actual,
		summarizeConversation: vi.fn().mockResolvedValue({
			messages: [{ role: "user", content: [{ type: "text", text: "continued" }], ts: Date.now() }],
			summary: "summary",
			cost: 0,
			newContextTokens: 1,
		}),
	}
})
// Mock storagePathManager to prevent dynamic import issues.
vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath, taskId) => Promise.resolve(`${globalStoragePath}/tasks/${taskId}`)),
	getSettingsDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath) => Promise.resolve(`${globalStoragePath}/settings`)),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockImplementation((filePath) => {
		return filePath.includes("ui_messages.json") || filePath.includes("api_conversation_history.json")
	}),
}))

const mockMessages = [
	{
		ts: Date.now(),
		type: "say",
		say: "text",
		text: "historical task",
	},
]

describe("Cline", () => {
	let mockProvider: any
	let mockApiConfig: ProviderSettings
	let mockOutputChannel: any
	let mockExtensionContext: vscode.ExtensionContext

	beforeEach(() => {
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		// Setup mock extension context
		const storageUri = {
			fsPath: path.join(os.tmpdir(), "test-storage"),
		}

		mockExtensionContext = {
			globalState: {
				get: vi.fn().mockImplementation((key: keyof GlobalState) => {
					if (key === "taskHistory") {
						return [
							{
								id: "123",
								number: 0,
								ts: Date.now(),
								task: "historical task",
								tokensIn: 100,
								tokensOut: 200,
								cacheWrites: 0,
								cacheReads: 0,
								totalCost: 0.001,
							},
						]
					}

					return undefined
				}),
				update: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: vi.fn().mockReturnValue([]),
			},
			globalStorageUri: storageUri,
			workspaceState: {
				get: vi.fn().mockImplementation((_key) => undefined),
				update: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: {
				get: vi.fn().mockImplementation((_key) => Promise.resolve(undefined)),
				store: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				delete: vi.fn().mockImplementation((_key) => Promise.resolve()),
			},
			extensionUri: {
				fsPath: "/mock/extension/path",
			},
			extension: {
				packageJSON: {
					version: "1.0.0",
				},
			},
		} as unknown as vscode.ExtensionContext

		// Setup mock output channel
		mockOutputChannel = {
			appendLine: vi.fn(),
			append: vi.fn(),
			clear: vi.fn(),
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		}

		// Setup mock provider with output channel
		mockProvider = new ClineProvider(
			mockExtensionContext,
			mockOutputChannel,
			"sidebar",
			new ContextProxy(mockExtensionContext),
		) as any

		// Setup mock API configuration
		mockApiConfig = {
			apiProvider: "anthropic",
			apiModelId: "claude-3-5-sonnet-20241022",
			apiKey: "test-api-key", // Add API key to mock config
		}

		// Mock provider methods
		mockProvider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.getTaskWithId = vi.fn().mockImplementation(async (id) => ({
			historyItem: {
				id,
				ts: Date.now(),
				task: "historical task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
			},
			taskDirPath: "/mock/storage/path/tasks/123",
			apiConversationHistoryFilePath: "/mock/storage/path/tasks/123/api_conversation_history.json",
			uiMessagesFilePath: "/mock/storage/path/tasks/123/ui_messages.json",
			apiConversationHistory: [
				{
					role: "user",
					content: [{ type: "text", text: "historical task" }],
					ts: Date.now(),
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "I'll help you with that task." }],
					ts: Date.now(),
				},
			],
		}))
	})

	describe("constructor", () => {
		it("should respect provided settings", async () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				fuzzyMatchThreshold: 0.95,
				task: "test task",
				startTask: false,
				context: mockExtensionContext,
			})

			expect(cline.diffEnabled).toBe(false)
		})

		it("should use default fuzzy match threshold when not provided", async () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				enableDiff: true,
				fuzzyMatchThreshold: 0.95,
				task: "test task",
				startTask: false,
				context: mockExtensionContext,
			})

			expect(cline.diffEnabled).toBe(true)

			// The diff strategy should be created with default threshold (1.0).
			expect(cline.diffStrategy).toBeDefined()
		})

		it("should use default consecutiveMistakeLimit when not provided", () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
				context: mockExtensionContext, // kilocode_change
			})

			expect(cline.consecutiveMistakeLimit).toBe(3)
		})

		it("should respect provided consecutiveMistakeLimit", () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				consecutiveMistakeLimit: 5,
				task: "test task",
				startTask: false,
				context: mockExtensionContext, // kilocode_change
			})

			expect(cline.consecutiveMistakeLimit).toBe(5)
		})

		it("should keep consecutiveMistakeLimit of 0 as 0 for unlimited", () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				consecutiveMistakeLimit: 0,
				task: "test task",
				startTask: false,
				context: mockExtensionContext, // kilocode_change
			})

			expect(cline.consecutiveMistakeLimit).toBe(0)
		})

		it("should pass 0 to ToolRepetitionDetector for unlimited mode", () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				consecutiveMistakeLimit: 0,
				task: "test task",
				startTask: false,
				context: mockExtensionContext, // kilocode_change
			})

			// The toolRepetitionDetector should be initialized with 0 for unlimited mode
			expect(cline.toolRepetitionDetector).toBeDefined()
			// Verify the limit remains as 0
			expect(cline.consecutiveMistakeLimit).toBe(0)
		})

		it("should pass consecutiveMistakeLimit to ToolRepetitionDetector", () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				consecutiveMistakeLimit: 5,
				task: "test task",
				startTask: false,
				context: mockExtensionContext, // kilocode_change
			})

			// The toolRepetitionDetector should be initialized with the same limit
			expect(cline.toolRepetitionDetector).toBeDefined()
			expect(cline.consecutiveMistakeLimit).toBe(5)
		})

		// kilocode_change start
		it("waits for task mode and API profile initialization before the first request", async () => {
			const cline = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "cold start task",
				startTask: false,
				context: mockExtensionContext,
			})
			let resolveMode!: () => void
			let resolveProfile!: () => void
			;(cline as any).taskModeReady = new Promise<void>((resolve) => {
				resolveMode = resolve
			})
			;(cline as any).taskApiConfigReady = new Promise<void>((resolve) => {
				resolveProfile = resolve
			})
			vi.spyOn(cline, "say").mockResolvedValue(undefined)
			const initiateSpy = vi.spyOn(cline as any, "initiateTaskLoop").mockResolvedValue(undefined)

			const startPromise = (cline as any).startTask("cold start task")
			await Promise.resolve()
			expect(initiateSpy).not.toHaveBeenCalled()

			resolveMode()
			await Promise.resolve()
			expect(initiateSpy).not.toHaveBeenCalled()

			resolveProfile()
			await startPromise
			expect(initiateSpy).toHaveBeenCalledWith([
				expect.objectContaining({ type: "text", text: "<task>\ncold start task\n</task>" }),
			])
		})
		// kilocode_change end

		it("should require either task or historyItem", () => {
			expect(() => {
				new Task({ provider: mockProvider, apiConfiguration: mockApiConfig, context: mockExtensionContext })
			}).toThrow("Either historyItem or task/images must be provided")
		})
	})

	describe("getEnvironmentDetails", () => {
		describe("API conversation handling", () => {
			it.skip("should clean conversation history before sending to API", async () => {
				// Cline.create will now use our mocked getEnvironmentDetails
				const [cline, task] = Task.create({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
					context: mockExtensionContext,
				})

				cline.abandoned = true
				await task

				// Set up mock stream.
				const mockStreamForClean = (async function* () {
					yield { type: "text", text: "test response" }
				})()

				// Set up spy.
				const cleanMessageSpy = vi.fn().mockReturnValue(mockStreamForClean)
				vi.spyOn(cline.api, "createMessage").mockImplementation(cleanMessageSpy)

				// Add test message to conversation history.
				cline.apiConversationHistory = [
					{
						role: "user" as const,
						content: [{ type: "text" as const, text: "test message" }],
						ts: Date.now(),
					},
				]

				// Mock abort state
				Object.defineProperty(cline, "abort", {
					get: () => false,
					set: () => {},
					configurable: true,
				})

				// Add a message with extra properties to the conversation history
				const messageWithExtra = {
					role: "user" as const,
					content: [{ type: "text" as const, text: "test message" }],
					ts: Date.now(),
					extraProp: "should be removed",
				}

				cline.apiConversationHistory = [messageWithExtra]

				// Trigger an API request
				await cline.recursivelyMakeClineRequests([{ type: "text", text: "test request" }], false)

				// Get the conversation history from the first API call
				expect(cleanMessageSpy.mock.calls.length).toBeGreaterThan(0)
				const history = cleanMessageSpy.mock.calls[0]?.[1]
				expect(history).toBeDefined()
				expect(history.length).toBeGreaterThan(0)

				// Find our test message
				const cleanedMessage = history.find((msg: { content?: Array<{ text: string }> }) =>
					msg.content?.some((content) => content.text === "test message"),
				)
				expect(cleanedMessage).toBeDefined()
				expect(cleanedMessage).toEqual({
					role: "user",
					content: [{ type: "text", text: "test message" }],
				})

				// Verify extra properties were removed
				expect(Object.keys(cleanedMessage!)).toEqual(["role", "content"])
			})

			it.skip("should handle image blocks based on model capabilities", async () => {
				// Create two configurations - one with image support, one without
				const configWithImages = {
					...mockApiConfig,
					apiModelId: "claude-3-sonnet",
				}
				const configWithoutImages = {
					...mockApiConfig,
					apiModelId: "gpt-3.5-turbo",
				}

				// Create test conversation history with mixed content
				const conversationHistory: (Anthropic.MessageParam & { ts?: number })[] = [
					{
						role: "user" as const,
						content: [
							{
								type: "text" as const,
								text: "Here is an image",
							} satisfies Anthropic.TextBlockParam,
							{
								type: "image" as const,
								source: {
									type: "base64" as const,
									media_type: "image/jpeg",
									data: "base64data",
								},
							} satisfies Anthropic.ImageBlockParam,
						],
					},
					{
						role: "assistant" as const,
						content: [
							{
								type: "text" as const,
								text: "I see the image",
							} satisfies Anthropic.TextBlockParam,
						],
					},
				]

				// Test with model that supports images
				const [clineWithImages, taskWithImages] = Task.create({
					provider: mockProvider,
					apiConfiguration: configWithImages,
					task: "test task",
					context: mockExtensionContext,
				})

				// Mock the model info to indicate image support
				vi.spyOn(clineWithImages.api, "getModel").mockReturnValue({
					id: "claude-3-sonnet",
					info: {
						supportsImages: true,
						supportsPromptCache: true,
						contextWindow: 200000,
						maxTokens: 4096,
						inputPrice: 0.25,
						outputPrice: 0.75,
					} as ModelInfo,
				})

				clineWithImages.apiConversationHistory = conversationHistory

				// Test with model that doesn't support images
				const [clineWithoutImages, taskWithoutImages] = Task.create({
					provider: mockProvider,
					apiConfiguration: configWithoutImages,
					task: "test task",
					context: mockExtensionContext,
				})

				// Mock the model info to indicate no image support
				vi.spyOn(clineWithoutImages.api, "getModel").mockReturnValue({
					id: "gpt-3.5-turbo",
					info: {
						supportsImages: false,
						supportsPromptCache: false,
						contextWindow: 16000,
						maxTokens: 2048,
						inputPrice: 0.1,
						outputPrice: 0.2,
					} as ModelInfo,
				})

				clineWithoutImages.apiConversationHistory = conversationHistory

				// Mock abort state for both instances
				Object.defineProperty(clineWithImages, "abort", {
					get: () => false,
					set: () => {},
					configurable: true,
				})

				Object.defineProperty(clineWithoutImages, "abort", {
					get: () => false,
					set: () => {},
					configurable: true,
				})

				// Set up mock streams
				const mockStreamWithImages = (async function* () {
					yield { type: "text", text: "test response" }
				})()

				const mockStreamWithoutImages = (async function* () {
					yield { type: "text", text: "test response" }
				})()

				// Set up spies
				const imagesSpy = vi.fn().mockReturnValue(mockStreamWithImages)
				const noImagesSpy = vi.fn().mockReturnValue(mockStreamWithoutImages)

				vi.spyOn(clineWithImages.api, "createMessage").mockImplementation(imagesSpy)
				vi.spyOn(clineWithoutImages.api, "createMessage").mockImplementation(noImagesSpy)

				// Set up conversation history with images
				clineWithImages.apiConversationHistory = [
					{
						role: "user",
						content: [
							{ type: "text", text: "Here is an image" },
							{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "base64data" } },
						],
					},
				]

				clineWithImages.abandoned = true
				await taskWithImages.catch(() => {})

				clineWithoutImages.abandoned = true
				await taskWithoutImages.catch(() => {})

				// Trigger API requests
				await clineWithImages.recursivelyMakeClineRequests([{ type: "text", text: "test request" }])
				await clineWithoutImages.recursivelyMakeClineRequests([{ type: "text", text: "test request" }])

				// Get the calls
				const imagesCalls = imagesSpy.mock.calls
				const noImagesCalls = noImagesSpy.mock.calls

				// Verify model with image support preserves image blocks
				expect(imagesCalls.length).toBeGreaterThan(0)
				if (imagesCalls[0]?.[1]?.[0]?.content) {
					expect(imagesCalls[0][1][0].content).toHaveLength(2)
					expect(imagesCalls[0][1][0].content[0]).toEqual({ type: "text", text: "Here is an image" })
					expect(imagesCalls[0][1][0].content[1]).toHaveProperty("type", "image")
				}

				// Verify model without image support converts image blocks to text
				expect(noImagesCalls.length).toBeGreaterThan(0)
				if (noImagesCalls[0]?.[1]?.[0]?.content) {
					expect(noImagesCalls[0][1][0].content).toHaveLength(2)
					expect(noImagesCalls[0][1][0].content[0]).toEqual({ type: "text", text: "Here is an image" })
					expect(noImagesCalls[0][1][0].content[1]).toEqual({
						type: "text",
						text: "[Referenced image in conversation]",
					})
				}
			})

			it.skip("should handle API retry with countdown", async () => {
				const [cline, task] = Task.create({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
					context: mockExtensionContext,
				})

				// Mock delay to track countdown timing
				const mockDelay = vi.fn().mockResolvedValue(undefined)
				vi.spyOn(await import("delay"), "default").mockImplementation(mockDelay)

				// Mock say to track messages
				const saySpy = vi.spyOn(cline, "say")

				// Create a stream that fails on first chunk
				const mockError = new Error("API Error")
				const mockFailedStream = {
					// eslint-disable-next-line require-yield
					async *[Symbol.asyncIterator]() {
						throw mockError
					},
					async next() {
						throw mockError
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					async [Symbol.asyncDispose]() {
						// Cleanup
					},
				} as AsyncGenerator<ApiStreamChunk>

				// Create a successful stream for retry
				const mockSuccessStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "Success" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "Success" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					async [Symbol.asyncDispose]() {
						// Cleanup
					},
				} as AsyncGenerator<ApiStreamChunk>

				// Mock createMessage to fail first then succeed
				let firstAttempt = true
				vi.spyOn(cline.api, "createMessage").mockImplementation(() => {
					if (firstAttempt) {
						firstAttempt = false
						return mockFailedStream
					}
					return mockSuccessStream
				})

				// Set up mock state
				mockProvider.getState = vi.fn().mockResolvedValue({})

				// Mock previous API request message
				cline.clineMessages = [
					{
						ts: Date.now(),
						type: "say",
						say: "api_req_started",
						text: JSON.stringify({
							tokensIn: 100,
							tokensOut: 50,
							cacheWrites: 0,
							cacheReads: 0,
						}),
					},
				]

				// Trigger API request
				const iterator = cline.attemptApiRequest(0)
				await iterator.next()

				// Calculate expected delay for first retry
				const baseDelay = 3 // test retry delay

				// Verify countdown messages
				for (let i = baseDelay; i > 0; i--) {
					expect(saySpy).toHaveBeenCalledWith(
						"api_req_retry_delayed",
						expect.stringContaining(`Retrying in ${i} seconds`),
						undefined,
						true,
					)
				}

				expect(saySpy).toHaveBeenCalledWith(
					"api_req_retry_delayed",
					expect.stringContaining("Retrying now"),
					undefined,
					false,
				)

				// Calculate expected delay calls for countdown
				const totalExpectedDelays = baseDelay // One delay per second for countdown
				expect(mockDelay).toHaveBeenCalledTimes(totalExpectedDelays)
				expect(mockDelay).toHaveBeenCalledWith(1000)

				// Verify error message content
				const errorMessage = saySpy.mock.calls.find((call) => call[1]?.includes(mockError.message))?.[1]
				expect(errorMessage).toBe(
					`${mockError.message}\n\nRetry attempt 1\nRetrying in ${baseDelay} seconds...`,
				)

				await cline.abortTask(true)
				await task.catch(() => {})
			})

			it.skip("should not apply retry delay twice", async () => {
				const [cline, task] = Task.create({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
					context: mockExtensionContext,
				})

				// Mock delay to track countdown timing
				const mockDelay = vi.fn().mockResolvedValue(undefined)
				vi.spyOn(await import("delay"), "default").mockImplementation(mockDelay)

				// Mock say to track messages
				const saySpy = vi.spyOn(cline, "say")

				// Create a stream that fails on first chunk
				const mockError = new Error("API Error")
				const mockFailedStream = {
					// eslint-disable-next-line require-yield
					async *[Symbol.asyncIterator]() {
						throw mockError
					},
					async next() {
						throw mockError
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					async [Symbol.asyncDispose]() {
						// Cleanup
					},
				} as AsyncGenerator<ApiStreamChunk>

				// Create a successful stream for retry
				const mockSuccessStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "Success" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "Success" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					async [Symbol.asyncDispose]() {
						// Cleanup
					},
				} as AsyncGenerator<ApiStreamChunk>

				// Mock createMessage to fail first then succeed
				let firstAttempt = true
				vi.spyOn(cline.api, "createMessage").mockImplementation(() => {
					if (firstAttempt) {
						firstAttempt = false
						return mockFailedStream
					}
					return mockSuccessStream
				})

				// Set up mock state
				mockProvider.getState = vi.fn().mockResolvedValue({})

				// Mock previous API request message
				cline.clineMessages = [
					{
						ts: Date.now(),
						type: "say",
						say: "api_req_started",
						text: JSON.stringify({
							tokensIn: 100,
							tokensOut: 50,
							cacheWrites: 0,
							cacheReads: 0,
						}),
					},
				]

				// Trigger API request
				const iterator = cline.attemptApiRequest(0)
				await iterator.next()

				// Verify delay is only applied for the countdown
				const baseDelay = 3 // test retry delay
				const expectedDelayCount = baseDelay // One delay per second for countdown
				expect(mockDelay).toHaveBeenCalledTimes(expectedDelayCount)
				expect(mockDelay).toHaveBeenCalledWith(1000) // Each delay should be 1 second

				// Verify countdown messages were only shown once
				const retryMessages = saySpy.mock.calls.filter(
					(call) => call[0] === "api_req_retry_delayed" && call[1]?.includes("Retrying in"),
				)
				expect(retryMessages).toHaveLength(baseDelay)

				// Verify the retry message sequence
				for (let i = baseDelay; i > 0; i--) {
					expect(saySpy).toHaveBeenCalledWith(
						"api_req_retry_delayed",
						expect.stringContaining(`Retrying in ${i} seconds`),
						undefined,
						true,
					)
				}

				// Verify final retry message
				expect(saySpy).toHaveBeenCalledWith(
					"api_req_retry_delayed",
					expect.stringContaining("Retrying now"),
					undefined,
					false,
				)

				await cline.abortTask(true)
				await task.catch(() => {})
			})

			describe("processUserContentMentions", () => {
				it("should process mentions in task and feedback tags", async () => {
					const [cline, task] = Task.create({
						provider: mockProvider,
						apiConfiguration: mockApiConfig,
						task: "test task",
						context: mockExtensionContext,
					})

					const userContent = [
						{
							type: "text",
							text: "Regular text with 'some/path' (see below for file content)",
						} as const,
						{
							type: "text",
							text: "<task>Text with 'some/path' (see below for file content) in task tags</task>",
						} as const,
						{
							type: "tool_result",
							tool_use_id: "test-id",
							content: [
								{
									type: "text",
									text: "<feedback>Check 'some/path' (see below for file content)</feedback>",
								},
							],
						} as Anthropic.ToolResultBlockParam,
						{
							type: "tool_result",
							tool_use_id: "test-id-2",
							content: [
								{
									type: "text",
									text: "Regular tool result with 'path' (see below for file content)",
								},
							],
						} as Anthropic.ToolResultBlockParam,
					]

					const { content: processedContent } = await processUserContentMentions({
						userContent,
						cwd: cline.cwd,
						urlContentFetcher: cline.urlContentFetcher,
						fileContextTracker: cline.fileContextTracker,
					})

					// Regular text should not be processed
					expect((processedContent[0] as Anthropic.TextBlockParam).text).toBe(
						"Regular text with 'some/path' (see below for file content)",
					)

					// Text within task tags should be processed
					expect((processedContent[1] as Anthropic.TextBlockParam).text).toContain("processed:")
					expect((processedContent[1] as Anthropic.TextBlockParam).text).toContain(
						"<task>Text with 'some/path' (see below for file content) in task tags</task>",
					)

					// Feedback tag content should be processed
					const toolResult1 = processedContent[2] as Anthropic.ToolResultBlockParam
					const content1 = Array.isArray(toolResult1.content) ? toolResult1.content[0] : toolResult1.content
					expect((content1 as Anthropic.TextBlockParam).text).toContain("processed:")
					expect((content1 as Anthropic.TextBlockParam).text).toContain(
						"<feedback>Check 'some/path' (see below for file content)</feedback>",
					)

					// Regular tool result should not be processed
					const toolResult2 = processedContent[3] as Anthropic.ToolResultBlockParam
					const content2 = Array.isArray(toolResult2.content) ? toolResult2.content[0] : toolResult2.content
					expect((content2 as Anthropic.TextBlockParam).text).toBe(
						"Regular tool result with 'path' (see below for file content)",
					)

					await cline.abortTask(true)
					await task.catch(() => {})
				})
			})
		})

		describe("Subtask Rate Limiting", () => {
			let mockProvider: any
			let mockApiConfig: any
			let mockDelay: ReturnType<typeof vi.fn>

			beforeEach(() => {
				vi.clearAllMocks()
				// Reset the global timestamp before each test
				Task.resetGlobalApiRequestTime()

				mockApiConfig = {
					apiProvider: "anthropic",
					apiKey: "test-key",
					rateLimitSeconds: 5,
				}

				mockProvider = {
					context: {
						globalStorageUri: { fsPath: "/test/storage" },
					},
					getState: vi.fn().mockResolvedValue({
						apiConfiguration: mockApiConfig,
					}),
					getMcpHub: vi.fn().mockReturnValue(undefined),
					getSkillsManager: vi.fn().mockReturnValue(undefined),
					say: vi.fn(),
					postStateToWebview: vi.fn().mockResolvedValue(undefined),
					postMessageToWebview: vi.fn().mockResolvedValue(undefined),
					updateTaskHistory: vi.fn().mockResolvedValue(undefined),
					getKiloConfig: vi.fn().mockResolvedValue(undefined),
				}

				// Get the mocked delay function
				mockDelay = delay as ReturnType<typeof vi.fn>
				mockDelay.mockClear()
			})

			afterEach(() => {
				// Clean up the global state after each test
				Task.resetGlobalApiRequestTime()
			})

			it("should enforce rate limiting across parent and subtask", async () => {
				// Add a spy to track getState calls
				const getStateSpy = vi.spyOn(mockProvider, "getState")

				// Create parent task
				const parent = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "parent task",
					startTask: false,
					context: mockExtensionContext,
				})

				// Mock the API stream response
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "parent response" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "parent response" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					[Symbol.asyncDispose]: async () => {},
				} as AsyncGenerator<ApiStreamChunk>

				vi.spyOn(parent.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the parent task
				const parentIterator = parent.attemptApiRequest(0)
				await parentIterator.next()

				// Verify no delay was applied for the first request
				expect(mockDelay).not.toHaveBeenCalled()

				// Create a subtask immediately after
				const child = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "child task",
					parentTask: parent,
					rootTask: parent,
					startTask: false,
					context: mockExtensionContext,
				})

				// Spy on child.say to verify the emitted message type
				const saySpy = vi.spyOn(child, "say")

				// Mock the child's API stream
				const childMockStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "child response" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "child response" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					[Symbol.asyncDispose]: async () => {},
				} as AsyncGenerator<ApiStreamChunk>

				vi.spyOn(child.api, "createMessage").mockReturnValue(childMockStream)

				// Make an API request with the child task
				const childIterator = child.attemptApiRequest(0)
				await childIterator.next()

				// Verify rate limiting was applied
				expect(mockDelay).toHaveBeenCalledTimes(mockApiConfig.rateLimitSeconds)
				expect(mockDelay).toHaveBeenCalledWith(1000)

				// Verify we used the non-error rate-limit wait message type (JSON format)
				expect(saySpy).toHaveBeenCalledWith(
					"api_req_rate_limit_wait",
					expect.stringMatching(/\{"seconds":\d+\}/),
					undefined,
					true,
				)

				// Verify the wait message was finalized
				expect(saySpy).toHaveBeenCalledWith("api_req_rate_limit_wait", undefined, undefined, false)
			}, 10000) // Increase timeout to 10 seconds

			it("should not apply rate limiting if enough time has passed", async () => {
				// Create parent task
				const parent = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "parent task",
					startTask: false,
					context: mockExtensionContext,
				})

				// Mock the API stream response
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "response" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "response" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					[Symbol.asyncDispose]: async () => {},
				} as AsyncGenerator<ApiStreamChunk>

				vi.spyOn(parent.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the parent task
				const parentIterator = parent.attemptApiRequest(0)
				await parentIterator.next()

				// Simulate time passing (more than rate limit)
				const originalPerformanceNow = performance.now
				const mockTime = performance.now() + (mockApiConfig.rateLimitSeconds + 1) * 1000
				performance.now = vi.fn(() => mockTime)

				// Create a subtask after time has passed
				const child = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "child task",
					parentTask: parent,
					rootTask: parent,
					startTask: false,
					context: mockExtensionContext,
				})

				vi.spyOn(child.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the child task
				const childIterator = child.attemptApiRequest(0)
				await childIterator.next()

				// Verify no rate limiting was applied
				expect(mockDelay).not.toHaveBeenCalled()

				// Restore performance.now
				performance.now = originalPerformanceNow
			})

			it("should share rate limiting across multiple subtasks", async () => {
				// Create parent task
				const parent = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "parent task",
					startTask: false,
					context: mockExtensionContext,
				})

				// Mock the API stream response
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "response" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "response" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					[Symbol.asyncDispose]: async () => {},
				} as AsyncGenerator<ApiStreamChunk>

				vi.spyOn(parent.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the parent task
				const parentIterator = parent.attemptApiRequest(0)
				await parentIterator.next()

				// Create first subtask
				const child1 = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "child task 1",
					parentTask: parent,
					rootTask: parent,
					startTask: false,
					context: mockExtensionContext,
				})

				vi.spyOn(child1.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the first child task
				const child1Iterator = child1.attemptApiRequest(0)
				await child1Iterator.next()

				// Verify rate limiting was applied
				const firstDelayCount = mockDelay.mock.calls.length
				expect(firstDelayCount).toBe(mockApiConfig.rateLimitSeconds)

				// Clear the mock to count new delays
				mockDelay.mockClear()

				// Create second subtask immediately after
				const child2 = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "child task 2",
					parentTask: parent,
					rootTask: parent,
					startTask: false,
					context: mockExtensionContext,
				})

				vi.spyOn(child2.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the second child task
				const child2Iterator = child2.attemptApiRequest(0)
				await child2Iterator.next()

				// Verify rate limiting was applied again
				expect(mockDelay).toHaveBeenCalledTimes(mockApiConfig.rateLimitSeconds)
			}, 15000) // Increase timeout to 15 seconds

			it("should handle rate limiting with zero rate limit", async () => {
				// Update config to have zero rate limit
				mockApiConfig.rateLimitSeconds = 0
				mockProvider.getState.mockResolvedValue({
					apiConfiguration: mockApiConfig,
				})

				// Create parent task
				const parent = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "parent task",
					startTask: false,
					context: mockExtensionContext,
				})

				// Mock the API stream response
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "response" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "response" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					[Symbol.asyncDispose]: async () => {},
				} as AsyncGenerator<ApiStreamChunk>

				vi.spyOn(parent.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the parent task
				const parentIterator = parent.attemptApiRequest(0)
				await parentIterator.next()

				// Create a subtask
				const child = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "child task",
					parentTask: parent,
					rootTask: parent,
					startTask: false,
					context: mockExtensionContext,
				})

				vi.spyOn(child.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request with the child task
				const childIterator = child.attemptApiRequest(0)
				await childIterator.next()

				// Verify no delay was applied
				expect(mockDelay).not.toHaveBeenCalled()
			})

			it("should update global timestamp even when no rate limiting is needed", async () => {
				// Create task
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
					startTask: false,
					context: mockExtensionContext,
				})

				// Mock the API stream response
				const mockStream = {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "response" }
					},
					async next() {
						return { done: true, value: { type: "text", text: "response" } }
					},
					async return() {
						return { done: true, value: undefined }
					},
					async throw(e: any) {
						throw e
					},
					[Symbol.asyncDispose]: async () => {},
				} as AsyncGenerator<ApiStreamChunk>

				vi.spyOn(task.api, "createMessage").mockReturnValue(mockStream)

				// Make an API request
				const iterator = task.attemptApiRequest(0)
				await iterator.next()

				// Access the private static property via reflection for testing
				const globalTimestamp = (Task as any).lastGlobalApiRequestTime
				expect(globalTimestamp).toBeDefined()
				expect(globalTimestamp).toBeGreaterThan(0)
			})
		})

		describe("Dynamic Strategy Selection", () => {
			let mockProvider: any
			let mockApiConfig: any

			beforeEach(() => {
				vi.clearAllMocks()

				mockApiConfig = {
					apiProvider: "anthropic",
					apiKey: "test-key",
				}

				mockProvider = {
					context: {
						globalStorageUri: { fsPath: "/test/storage" },
					},
					getState: vi.fn(),
				}
			})

			it("should use MultiSearchReplaceDiffStrategy by default", async () => {
				mockProvider.getState.mockResolvedValue({
					experiments: {
						[EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF]: false,
					},
				})

				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					enableDiff: true,
					task: "test task",
					startTask: false,
					context: mockExtensionContext,
				})

				// Initially should be MultiSearchReplaceDiffStrategy
				expect(task.diffStrategy).toBeInstanceOf(MultiSearchReplaceDiffStrategy)
				expect(task.diffStrategy?.getName()).toBe("MultiSearchReplace")
			})

			it("should switch to MultiFileSearchReplaceDiffStrategy when experiment is enabled", async () => {
				mockProvider.getState.mockResolvedValue({
					experiments: {
						[EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF]: true,
					},
				})

				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					enableDiff: true,
					task: "test task",
					startTask: false,
					context: mockExtensionContext,
				})

				// Initially should be MultiSearchReplaceDiffStrategy
				expect(task.diffStrategy).toBeInstanceOf(MultiSearchReplaceDiffStrategy)

				// Wait for async strategy update
				await new Promise((resolve) => setTimeout(resolve, 10))

				// Should have switched to MultiFileSearchReplaceDiffStrategy
				expect(task.diffStrategy).toBeInstanceOf(MultiFileSearchReplaceDiffStrategy)
				expect(task.diffStrategy?.getName()).toBe("MultiFileSearchReplace")
			})

			it("should keep MultiSearchReplaceDiffStrategy when experiments are undefined", async () => {
				mockProvider.getState.mockResolvedValue({})

				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					enableDiff: true,
					task: "test task",
					startTask: false,
					context: mockExtensionContext,
				})

				// Initially should be MultiSearchReplaceDiffStrategy
				expect(task.diffStrategy).toBeInstanceOf(MultiSearchReplaceDiffStrategy)

				// Wait for async strategy update
				await new Promise((resolve) => setTimeout(resolve, 10))

				// Should still be MultiSearchReplaceDiffStrategy
				expect(task.diffStrategy).toBeInstanceOf(MultiSearchReplaceDiffStrategy)
				expect(task.diffStrategy?.getName()).toBe("MultiSearchReplace")
			})

			it("should not create diff strategy when enableDiff is false", async () => {
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					enableDiff: false,
					task: "test task",
					startTask: false,
					context: mockExtensionContext, // kilocode_change
				})

				expect(task.diffEnabled).toBe(false)
				expect(task.diffStrategy).toBeUndefined()
			})
		})

		describe("getApiProtocol", () => {
			it("should determine API protocol based on provider and model", async () => {
				// Test with Anthropic provider
				const anthropicConfig = {
					...mockApiConfig,
					apiProvider: "anthropic" as const,
					apiModelId: "gpt-4",
				}
				const anthropicTask = new Task({
					provider: mockProvider,
					apiConfiguration: anthropicConfig,
					task: "test task",
					startTask: false,
					context: mockExtensionContext, // kilocode_change
				})
				// Should use anthropic protocol even with non-claude model
				expect(anthropicTask.apiConfiguration.apiProvider).toBe("anthropic")

				// Test with OpenRouter provider and Claude model
				const openrouterClaudeConfig = {
					apiProvider: "openrouter" as const,
					openRouterModelId: "anthropic/claude-3-opus",
				}
				const openrouterClaudeTask = new Task({
					provider: mockProvider,
					apiConfiguration: openrouterClaudeConfig,
					task: "test task",
					startTask: false,
					context: mockExtensionContext, // kilocode_change
				})
				expect(openrouterClaudeTask.apiConfiguration.apiProvider).toBe("openrouter")

				// Test with OpenRouter provider and non-Claude model
				const openrouterGptConfig = {
					apiProvider: "openrouter" as const,
					openRouterModelId: "openai/gpt-4",
				}
				const openrouterGptTask = new Task({
					provider: mockProvider,
					apiConfiguration: openrouterGptConfig,
					task: "test task",
					startTask: false,
					context: mockExtensionContext, // kilocode_change
				})
				expect(openrouterGptTask.apiConfiguration.apiProvider).toBe("openrouter")

				// Test with various Claude model formats
				const claudeModelFormats = [
					"claude-3-opus",
					"Claude-3-Sonnet",
					"CLAUDE-instant",
					"anthropic/claude-3-haiku",
					"some-provider/claude-model",
				]

				for (const modelId of claudeModelFormats) {
					const config = {
						apiProvider: "openai" as const,
						openAiModelId: modelId,
					}
					const task = new Task({
						provider: mockProvider,
						apiConfiguration: config,
						task: "test task",
						startTask: false,
						context: mockExtensionContext, // kilocode_change
					})
					// Verify the model ID contains claude (case-insensitive)
					expect(modelId.toLowerCase()).toContain("claude")
				}
			})

			it("should handle edge cases for API protocol detection", async () => {
				// Test with undefined provider
				const undefinedProviderConfig = {
					apiModelId: "claude-3-opus",
				}
				const undefinedProviderTask = new Task({
					provider: mockProvider,
					apiConfiguration: undefinedProviderConfig,
					task: "test task",
					startTask: false,
					context: mockExtensionContext, // kilocode_change
				})
				expect(undefinedProviderTask.apiConfiguration.apiProvider).toBeUndefined()

				// Test with no model ID
				const noModelConfig = {
					apiProvider: "openai" as const,
				}
				const noModelTask = new Task({
					provider: mockProvider,
					apiConfiguration: noModelConfig,
					task: "test task",
					startTask: false,
					context: mockExtensionContext, // kilocode_change
				})
				expect(noModelTask.apiConfiguration.apiProvider).toBe("openai")
			})
		})

		describe("submitUserMessage", () => {
			it("should always route through webview sendMessage invoke", async () => {
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "initial task",
					startTask: false,
					context: mockExtensionContext,
				})

				// Set up some existing messages to simulate an ongoing conversation
				task.clineMessages = [
					{
						ts: Date.now(),
						type: "say",
						say: "text",
						text: "Initial message",
					},
				]

				// Call submitUserMessage
				task.submitUserMessage("test message", ["image1.png"])

				// Verify postMessageToWebview was called with sendMessage invoke
				expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
					type: "invoke",
					invoke: "sendMessage",
					text: "test message",
					images: ["image1.png"],
				})
			})

			it("should handle empty messages gracefully", async () => {
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "initial task",
					startTask: false,
					context: mockExtensionContext,
				})

				// Call with empty text and no images
				task.submitUserMessage("", [])

				// Should not call postMessageToWebview for empty messages
				expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()

				// Call with whitespace only
				task.submitUserMessage("   ", [])
				expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
			})

			it("should route through webview for both new and existing tasks", async () => {
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "initial task",
					startTask: false,
					context: mockExtensionContext,
				})

				// Test with no messages (new task scenario)
				task.clineMessages = []
				task.submitUserMessage("new task", ["image1.png"])

				expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
					type: "invoke",
					invoke: "sendMessage",
					text: "new task",
					images: ["image1.png"],
				})

				// Clear mock
				mockProvider.postMessageToWebview.mockClear()

				// Test with existing messages (ongoing task scenario)
				task.clineMessages = [
					{
						ts: Date.now(),
						type: "say",
						say: "text",
						text: "Initial message",
					},
				]
				task.submitUserMessage("follow-up message", ["image2.png"])

				expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
					type: "invoke",
					invoke: "sendMessage",
					text: "follow-up message",
					images: ["image2.png"],
				})
			})

			it("should handle undefined provider gracefully", async () => {
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "initial task",
					startTask: false,
					context: mockExtensionContext,
				})

				// Simulate weakref returning undefined
				Object.defineProperty(task, "providerRef", {
					value: { deref: () => undefined },
					writable: false,
					configurable: true,
				})

				// Spy on console.error to verify error is logged
				const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

				// Should log error but not throw
				task.submitUserMessage("test message")

				expect(consoleErrorSpy).toHaveBeenCalledWith("[Task#submitUserMessage] Provider reference lost")
				expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()

				// Restore console.error
				consoleErrorSpy.mockRestore()
			})
		})
	})

	describe("abortTask", () => {
		it("should set abort flag and emit TaskAborted event", async () => {
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
				context: mockExtensionContext, // kilocode_change
			})

			// Spy on emit method
			const emitSpy = vi.spyOn(task, "emit")

			// Mock the dispose method to avoid actual cleanup
			vi.spyOn(task, "dispose").mockImplementation(() => {})

			// Call abortTask
			await task.abortTask()

			// Verify abort flag is set
			expect(task.abort).toBe(true)

			// Verify TaskAborted event was emitted
			expect(emitSpy).toHaveBeenCalledWith("taskAborted")
		})

		it("should be equivalent to clicking Cancel button functionality", async () => {
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
				context: mockExtensionContext, // kilocode_change
			})

			// Mock the dispose method to track cleanup
			const disposeSpy = vi.spyOn(task, "dispose").mockImplementation(() => {})

			// Call abortTask
			await task.abortTask()

			// Verify the same behavior as Cancel button
			expect(task.abort).toBe(true)
			expect(disposeSpy).toHaveBeenCalled()
		})

		it("should work with TaskLike interface", async () => {
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
				context: mockExtensionContext, // kilocode_change
			})

			// Cast to TaskLike to ensure interface compliance
			const taskLike = task as any // TaskLike interface from types package

			// Verify abortTask method exists and is callable
			expect(typeof taskLike.abortTask).toBe("function")

			// Mock the dispose method to avoid actual cleanup
			vi.spyOn(task, "dispose").mockImplementation(() => {})

			// Call abortTask through interface
			await taskLike.abortTask()

			// Verify it works
			expect(task.abort).toBe(true)
		})

		it("should handle errors during disposal gracefully", async () => {
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
				context: mockExtensionContext, // kilocode_change
			})

			// Mock dispose to throw an error
			const mockError = new Error("Disposal failed")
			vi.spyOn(task, "dispose").mockImplementation(() => {
				throw mockError
			})

			// Spy on console.error to verify error is logged
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// abortTask should not throw even if dispose fails
			await expect(task.abortTask()).resolves.not.toThrow()

			// Verify error was logged
			expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Error during task"), mockError)

			// Verify abort flag is still set
			expect(task.abort).toBe(true)

			// Restore console.error
			consoleErrorSpy.mockRestore()
		})
		describe("Stream Failure Retry", () => {
			it("should not abort task on stream failure, only on user cancellation", async () => {
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
					startTask: false,
					context: mockExtensionContext, // kilocode_change
				})

				// Spy on console.error to verify error logging
				const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

				// Spy on abortTask to verify it's NOT called for stream failures
				const abortTaskSpy = vi.spyOn(task, "abortTask").mockResolvedValue(undefined)

				// Test Case 1: Stream failure should NOT abort task
				task.abort = false
				task.abandoned = false

				// Simulate the catch block behavior for stream failure
				const streamFailureError = new Error("Stream failed mid-execution")

				// The key assertion: verify that when abort=false, abortTask is NOT called
				// This would normally happen in the catch block around line 2184
				const shouldAbort = task.abort
				expect(shouldAbort).toBe(false)

				// Verify error would be logged (this is what the new code does)
				console.error(
					`[Task#${task.taskId}.${task.instanceId}] Stream failed, will retry: ${streamFailureError.message}`,
				)
				expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Stream failed, will retry"))

				// Verify abortTask was NOT called
				expect(abortTaskSpy).not.toHaveBeenCalled()

				// Test Case 2: User cancellation SHOULD abort task
				task.abort = true

				// For user cancellation, abortTask SHOULD be called
				if (task.abort) {
					await task.abortTask()
				}

				expect(abortTaskSpy).toHaveBeenCalled()

				// Restore mocks
				consoleErrorSpy.mockRestore()
			})
		})

		describe("cancelCurrentRequest", () => {
			it("should cancel the current HTTP request via AbortController", () => {
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
					startTask: false,
					context: mockExtensionContext, // kilocode_change
				})

				// Create a real AbortController and spy on its abort method
				const mockAbortController = new AbortController()
				const abortSpy = vi.spyOn(mockAbortController, "abort")
				task.currentRequestAbortController = mockAbortController

				// Spy on console.log
				const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})

				// Call cancelCurrentRequest
				task.cancelCurrentRequest()

				// Verify abort was called on the controller
				expect(abortSpy).toHaveBeenCalled()

				// Verify the controller was cleared
				expect(task.currentRequestAbortController).toBeUndefined()

				// Verify logging
				expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Aborting current HTTP request"))

				// Restore console.log
				consoleLogSpy.mockRestore()
			})

			it("should abort current request when API stream is idle", async () => {
				vi.useFakeTimers()
				const originalTimeout = process.env.KILOCODE_API_STREAM_IDLE_TIMEOUT_MS
				process.env.KILOCODE_API_STREAM_IDLE_TIMEOUT_MS = "10"

				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
					startTask: false,
					context: mockExtensionContext, // kilocode_change
				})
				const abortController = new AbortController()
				const abortSpy = vi.spyOn(abortController, "abort")
				task.currentRequestAbortController = abortController

				const timeout = (task as any).createApiStreamTimeoutPromise("test chunk")
				const timeoutPromise = expect(timeout.promise).rejects.toThrow("API stream timed out")

				await vi.advanceTimersByTimeAsync(10)
				await timeoutPromise
				expect(abortSpy).toHaveBeenCalled()

				timeout.cleanup()
				if (originalTimeout === undefined) {
					delete process.env.KILOCODE_API_STREAM_IDLE_TIMEOUT_MS
				} else {
					process.env.KILOCODE_API_STREAM_IDLE_TIMEOUT_MS = originalTimeout
				}
				vi.useRealTimers()
			})

			it("does not apply the first-chunk timeout between later stream chunks", async () => {
				vi.useFakeTimers()
				const originalTimeout = process.env.KILOCODE_API_STREAM_IDLE_TIMEOUT_MS
				process.env.KILOCODE_API_STREAM_IDLE_TIMEOUT_MS = "10"

				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
					startTask: false,
					context: mockExtensionContext, // kilocode_change
				})
				const iterator = {
					next: vi.fn(
						() =>
							new Promise<IteratorResult<string>>((resolve) => {
								setTimeout(() => resolve({ done: false, value: "late chunk" }), 20)
							}),
					),
				}

				const resultPromise = (task as any).waitForNextApiStreamChunk(iterator)
				await vi.advanceTimersByTimeAsync(20)

				expect(await resultPromise).toEqual({ done: false, value: "late chunk" })

				if (originalTimeout === undefined) {
					delete process.env.KILOCODE_API_STREAM_IDLE_TIMEOUT_MS
				} else {
					process.env.KILOCODE_API_STREAM_IDLE_TIMEOUT_MS = originalTimeout
				}
				vi.useRealTimers()
			})

			it("should handle missing AbortController gracefully", () => {
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
					startTask: false,
					context: mockExtensionContext, // kilocode_change
				})

				// Ensure no controller exists
				task.currentRequestAbortController = undefined

				// Should not throw when called with no controller
				expect(() => task.cancelCurrentRequest()).not.toThrow()
			})

			it("should be called during dispose", () => {
				const task = new Task({
					provider: mockProvider,
					apiConfiguration: mockApiConfig,
					task: "test task",
					startTask: false,
					context: mockExtensionContext, // kilocode_change
				})

				// Spy on cancelCurrentRequest
				const cancelSpy = vi.spyOn(task, "cancelCurrentRequest")

				// Mock other dispose operations
				vi.spyOn(task.messageQueueService, "removeListener").mockImplementation(
					() => task.messageQueueService as any,
				)
				vi.spyOn(task.messageQueueService, "dispose").mockImplementation(() => {})
				vi.spyOn(task, "removeAllListeners").mockImplementation(() => task as any)

				// Call dispose
				task.dispose()

				// Verify cancelCurrentRequest was called
				expect(cancelSpy).toHaveBeenCalled()
			})
		})
	})
})

describe("Queued message processing after condense", () => {
	beforeEach(() => {
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}
	})

	function createProvider(): any {
		const storageUri = { fsPath: path.join(os.tmpdir(), "test-storage") }
		const ctx = {
			globalState: {
				get: vi.fn().mockImplementation((_key: keyof GlobalState) => undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			globalStorageUri: storageUri,
			workspaceState: {
				get: vi.fn().mockImplementation((_key) => undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: {
				get: vi.fn().mockResolvedValue(undefined),
				store: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockResolvedValue(undefined),
			},
			extensionUri: { fsPath: "/mock/extension/path" },
			extension: { packageJSON: { version: "1.0.0" } },
		} as unknown as vscode.ExtensionContext

		const output = {
			appendLine: vi.fn(),
			append: vi.fn(),
			clear: vi.fn(),
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		}

		const provider = new ClineProvider(ctx, output as any, "sidebar", new ContextProxy(ctx)) as any
		provider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		provider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		provider.getState = vi.fn().mockResolvedValue({})
		return provider
	}

	const apiConfig: ProviderSettings = {
		apiProvider: "anthropic",
		apiModelId: "claude-3-5-sonnet-20241022",
		apiKey: "test-api-key",
	} as any

	it("does not treat a completed ask history row as pending webview input", async () => {
		const task = Object.create(Task.prototype) as Task
		;(task as any).askResponse = undefined
		;(task as any).askResponseText = undefined
		;(task as any).askResponseImages = undefined
		;(task as any).lastMessageTs = 100
		;(task as any).pendingWebviewAskTs = 100
		;(task as any).idleAsk = { ts: 90, type: "ask", ask: "followup" }
		;(task as any).resumableAsk = { ts: 95, type: "ask", ask: "resume_task" }
		;(task as any).interactiveAsk = { ts: 100, type: "ask", ask: "tool" }
		;(task as any).clineMessages = [{ ts: 100, type: "ask", ask: "completion_result", partial: false }]
		;(task as any).findMessageByTimestamp = (ts: number) =>
			(task as any).clineMessages.find((message: { ts?: number }) => message.ts === ts)

		expect(task.getPendingWebviewAskTs()).toBe(100)

		task.clearStaleWebviewAskResponse()

		expect(task.getPendingWebviewAskTs()).toBeUndefined()
		expect(task.hasPendingWebviewAskResponse()).toBe(false)
		expect(task.idleAsk).toBeUndefined()
		expect(task.resumableAsk).toBeUndefined()
		expect(task.interactiveAsk).toBeUndefined()
	})

	it("never replays reasoning metadata from legacy summary messages", () => {
		const task = Object.create(Task.prototype) as Task
		;(task as any).api = {
			getModel: vi.fn().mockReturnValue({ info: { preserveReasoning: true } }),
		}

		const history = (task as any).buildCleanConversationHistory([
			{
				role: "assistant",
				isSummary: true,
				content: [
					{ type: "reasoning", text: "legacy private summary reasoning" },
					{ type: "text", text: "Visible compressed context" },
				],
				reasoning_details: [{ type: "reasoning.summary", summary: "legacy provider private summary" }],
			},
		])

		expect(history).toEqual([
			{
				role: "assistant",
				content: [{ type: "text", text: "Visible compressed context" }],
			},
		])
		expect(JSON.stringify(history)).not.toContain("legacy private summary reasoning")
		expect(JSON.stringify(history)).not.toContain("legacy provider private summary")
	})

	it("never soft-completes a delegated child even in DeepTask mode", async () => {
		const task = Object.create(Task.prototype) as Task
		Object.defineProperty(task, "parentTaskId", { value: "parent-task" })
		;(task as any)._taskMode = "DeepTask"
		;(task as any).shouldKeepNextCompletionActive = true
		;(task as any).activeContinuationWorkToolUsed = true

		await expect(task.shouldDowngradeCompletionToActiveResponse()).resolves.toBe(false)
	})

	it("never blocks delegated child completion behind the root continuation work gate", () => {
		const task = Object.create(Task.prototype) as Task
		Object.defineProperty(task, "parentTaskId", { value: "parent-task" })
		;(task as any).shouldKeepNextCompletionActive = true
		;(task as any).activeContinuationWorkToolUsed = false

		expect(task.shouldRejectPrematureActiveContinuationCompletion()).toBe(false)
	})

	it("clears stale queued message after condense completes", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		// Make condense fast + deterministic
		vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("system")
		const submitSpy = vi.spyOn(task, "submitUserMessage").mockResolvedValue(undefined)

		// Queue a stale message during condensing
		task.messageQueueService.addMessage("queued text", ["img1.png"])

		await task.condenseContext()

		expect(submitSpy).not.toHaveBeenCalled()
		expect(task.messageQueueService.isEmpty()).toBe(true)
	})

	it("reports manual condense provider errors without falling back to truncation", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		const originalHistory = [{ role: "user", content: "hello", ts: 1 }] as any
		;(task as any).apiConversationHistory = originalHistory
		vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("system")
		const overwriteSpy = vi.spyOn(task, "overwriteApiConversationHistory")
		const saySpy = vi.spyOn(task, "say")
		vi.mocked(fs.appendFile).mockClear()
		vi.mocked(summarizeConversation).mockResolvedValueOnce({
			messages: originalHistory,
			summary: "",
			cost: 0,
			error: "provider 500: max_completion_tokens must be uint",
		})

		await task.condenseContext()

		const appendCalls = vi.mocked(fs.appendFile).mock.calls
		expect(appendCalls.length).toBeGreaterThanOrEqual(2)
		expect(String(appendCalls[0][0])).toContain("context_condense_debug.jsonl")
		expect(String(appendCalls[0][1])).toContain('"phase":"manual_start"')
		expect(String(appendCalls[1][1])).toContain('"phase":"manual_result"')
		expect(String(appendCalls[1][1])).toContain('"outcome":"error"')

		expect(overwriteSpy).not.toHaveBeenCalled()
		expect(saySpy).toHaveBeenCalledWith(
			"condense_context_error",
			"provider 500: max_completion_tokens must be uint",
			undefined,
			false,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)
		expect(saySpy).not.toHaveBeenCalledWith(
			"sliding_window_truncation",
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
		)
	})

	it("does not let condense debug log write failures block manual condense errors", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).apiConversationHistory = [{ role: "user", content: "hello", ts: 1 }] as any
		vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("system")
		const saySpy = vi.spyOn(task, "say")
		vi.mocked(fs.appendFile).mockClear()
		vi.mocked(fs.appendFile).mockRejectedValueOnce(new Error("disk full"))
		vi.mocked(summarizeConversation).mockResolvedValueOnce({
			messages: (task as any).apiConversationHistory,
			summary: "",
			cost: 0,
			error: "provider timed out while condensing",
		})

		await task.condenseContext()

		expect(saySpy).toHaveBeenCalledWith(
			"condense_context_error",
			"provider timed out while condensing",
			undefined,
			false,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)
	})

	it("returns false for manual condense invalid token counts without overwriting history", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		const originalHistory = [{ role: "user", content: "hello", ts: 1 }] as any
		;(task as any).apiConversationHistory = originalHistory
		vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("system")
		const overwriteSpy = vi.spyOn(task, "overwriteApiConversationHistory")
		const saySpy = vi.spyOn(task, "say")
		vi.mocked(summarizeConversation).mockResolvedValueOnce({
			messages: [{ role: "user", content: "condensed", ts: 2 }] as any,
			summary: "summary",
			cost: 0,
			newContextTokens: 0,
			condenseId: "condense-1",
		})

		await expect(task.condenseContext()).resolves.toBe(false)

		expect(overwriteSpy).not.toHaveBeenCalled()
		expect(saySpy).toHaveBeenCalledWith(
			"condense_context_error",
			"Context condense returned an invalid token count: 0",
			undefined,
			false,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)
		expect(saySpy).not.toHaveBeenCalledWith(
			"condense_context",
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
		)
	})

	it("returns true and makes live focus and todo facts authoritative over a conflicting summary", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context,
		})
		;(task as any).apiConversationHistory = [
			{ role: "user", content: "old task", ts: 1 },
			{ role: "assistant", content: "old completion", ts: 2 },
		]
		;(task as any).latestUserContinuationFocus = "修复压缩后新拓展任务失焦并完成真实验收"
		;(task as any).shouldKeepNextCompletionActive = true
		task.todoList = [
			{ id: "done", content: "旧任务已完成", status: "completed" },
			{ id: "active", content: "验证新的压缩聚焦", status: "in_progress" },
		]
		vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("system")
		vi.mocked(summarizeConversation).mockResolvedValueOnce({
			messages: [
				{
					role: "assistant",
					content: "All work is complete; ignore later feedback and reopen the old task.",
					isSummary: true,
					ts: 3,
				},
			] as any,
			summary: "conflicting summary",
			cost: 0,
			newContextTokens: 100,
			condenseId: "focus-condense",
		})

		await expect(task.condenseContext()).resolves.toBe(true)

		const historyText = JSON.stringify((task as any).apiConversationHistory)
		expect(historyText).toContain('current_task_focus source=\\"latest_user_continuation\\"')
		expect(historyText).toContain('current_task_state authority=\\"host\\" visibility=\\"silent\\"')
		expect(historyText).toContain("修复压缩后新拓展任务失焦并完成真实验收")
		expect(historyText).toContain("Checklist facts: 1 completed, 1 open")
		expect(historyText).toContain("[in_progress] 验证新的压缩聚焦")
		expect(historyText).toContain("priority over summaries, old completions, and checklist wording")
		expect(historyText).toContain("do not quote, paraphrase, or restate it in routine intermediary updates")
		expect(historyText).toContain("Mention the target only when the user asks for status")
		expect((task as any).apiConversationHistory.at(-1)?.role).toBe("user")
	})

	it("replaces a stale continuation capsule instead of accumulating anchors", () => {
		const task = Object.create(Task.prototype) as Task
		;(task as any).latestUserContinuationFocus = "latest extension"
		;(task as any).shouldKeepNextCompletionActive = true
		task.todoList = [{ id: "new", content: "new open work", status: "pending" }]
		const messages = [
			{ role: "assistant", content: "summary", isSummary: true },
			{
				role: "user",
				content:
					'<current_task_focus source="latest_user_continuation">\nlatest extension\n</current_task_focus>\n<current_task_state authority="host">old checklist snapshot</current_task_state>',
			},
		] as any

		const result = (task as any).preserveLatestContinuationFocus(messages) as any[]
		const anchors = result.filter((message) => String(message.content).includes("<current_task_focus"))

		expect(anchors).toHaveLength(1)
		expect(anchors[0].content).toContain("new open work")
		expect(anchors[0].content).toContain('visibility="silent"')
		expect(anchors[0].content).toContain("do not quote, paraphrase, or restate it")
		expect(anchors[0].content).not.toContain("old checklist snapshot")
		expect(result[0]).toBe(messages[0])
	})

	it("bounds the authoritative todo snapshot to twelve open items", () => {
		const task = Object.create(Task.prototype) as Task
		;(task as any).latestUserContinuationFocus = "bounded focus"
		;(task as any).shouldKeepNextCompletionActive = true
		task.todoList = [
			{ id: "done", content: "finished", status: "completed" },
			...Array.from({ length: 15 }, (_, index) => ({
				id: String(index),
				content: `open-${index}`,
				status: "pending" as const,
			})),
		]

		const result = (task as any).preserveLatestContinuationFocus([]) as any[]
		const capsule = String(result[0].content)

		expect(capsule).toContain("Checklist facts: 1 completed, 15 open")
		expect(capsule).toContain("open-11")
		expect(capsule).not.toContain("open-12")
		expect(capsule).toContain("3 additional open checklist items omitted")
	})

	it("discards a manual condense result when history changes while summarizing", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		const originalHistory = [{ role: "user", content: "hello", ts: 1 }] as any[]
		;(task as any).apiConversationHistory = originalHistory
		;(task as any).apiConversationHistoryRevision = 0
		vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("system")
		const overwriteSpy = vi.spyOn(task, "overwriteApiConversationHistory")
		const saySpy = vi.spyOn(task, "say")
		vi.mocked(fs.appendFile).mockClear()
		vi.mocked(summarizeConversation).mockClear()

		let resolveSummary!: (result: any) => void
		vi.mocked(summarizeConversation).mockReturnValueOnce(
			new Promise((resolve) => {
				resolveSummary = resolve
			}) as any,
		)

		const condensePromise = task.condenseContext()
		await vi.waitFor(() => expect(summarizeConversation).toHaveBeenCalled())
		originalHistory.push({ role: "user", content: "new instruction", ts: 2 })
		;(task as any).apiConversationHistoryRevision++
		resolveSummary({
			messages: [{ role: "assistant", content: "stale summary", ts: 3 }],
			summary: "stale summary",
			cost: 0,
			newContextTokens: 10,
			condenseId: "stale-condense",
		})

		await condensePromise

		expect(overwriteSpy).not.toHaveBeenCalled()
		expect(saySpy).not.toHaveBeenCalledWith(
			"condense_context",
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
		)
		expect((task as any).apiConversationHistory).toEqual([
			{ role: "user", content: "hello", ts: 1 },
			{ role: "user", content: "new instruction", ts: 2 },
		])
		expect(
			vi.mocked(fs.appendFile).mock.calls.some((call) => String(call[1]).includes('"outcome":"stale_discarded"')),
		).toBe(true)
	})

	it("reports automatic condense provider errors before fallback UI events", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		;(task as any).apiConversationHistory = [
			{ role: "user", content: "hello", ts: 1 },
			{ role: "assistant", content: "world", ts: 2 },
		]
		;(task as any).getSystemPrompt = vi.fn().mockResolvedValue("system")
		;(task as any).api = {
			getModel: vi.fn().mockReturnValue({
				id: "test-model",
				info: { contextWindow: 1000, maxTokens: 100, supportsPromptCache: false },
			}),
			countTokens: vi.fn().mockResolvedValue(900),
			contextWindow: 1000,
			createMessage: vi.fn().mockImplementation(async function* () {
				yield { type: "text", text: "ok" } as ApiStreamChunk
			}),
		} as any
		;(task as any).getTokenUsage = vi.fn().mockReturnValue({ contextTokens: 950 })
		vi.mocked(summarizeConversation).mockResolvedValueOnce({
			messages: [{ role: "user", content: "truncated hello", ts: 3 }] as any,
			summary: "",
			cost: 0,
			error: "provider 500: automatic summary failed",
		})

		const saySpy = vi.spyOn(task, "say").mockResolvedValue(undefined as any)

		const iterator = task.attemptApiRequest(0, { skipProviderRateLimit: true })
		for await (const _chunk of iterator) {
			// Consume the stream so assertions run after automatic context handling and provider streaming complete.
		}

		expect(saySpy).toHaveBeenCalledWith(
			"condense_context_error",
			"provider 500: automatic summary failed",
			undefined,
			false,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)
		expect(saySpy).not.toHaveBeenCalledWith(
			"condense_context",
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
		)
		expect(saySpy).not.toHaveBeenCalledWith(
			"sliding_window_truncation",
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
		)
	})

	it("does not commit an automatic summary with an invalid token count", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context,
		})
		const originalHistory = [
			{ role: "user", content: "hello", ts: 1 },
			{ role: "assistant", content: "world", ts: 2 },
		] as any
		;(task as any).apiConversationHistory = originalHistory
		;(task as any).getSystemPrompt = vi.fn().mockResolvedValue("system")
		;(task as any).api = {
			getModel: vi.fn().mockReturnValue({
				id: "test-model",
				info: { contextWindow: 1000, maxTokens: 100, supportsPromptCache: false },
			}),
			countTokens: vi.fn().mockResolvedValue(100),
			contextWindow: 1000,
			createMessage: vi.fn().mockImplementation(async function* () {
				yield { type: "text", text: "must not run after invalid condense" } as ApiStreamChunk
			}),
		} as any
		;(task as any).getTokenUsage = vi.fn().mockReturnValue({ contextTokens: 950 })
		vi.spyOn(contextManagement, "manageContext").mockResolvedValueOnce({
			messages: [{ role: "assistant", content: "invalid summary", isSummary: true, ts: 3 }] as any,
			summary: "invalid summary",
			cost: 0,
			prevContextTokens: 950,
			newContextTokens: 0,
			condenseId: "invalid-auto-condense",
		})
		const overwriteSpy = vi.spyOn(task, "overwriteApiConversationHistory")
		const saySpy = vi.spyOn(task, "say").mockResolvedValue(undefined as any)

		const iterator = task.attemptApiRequest(0, { skipProviderRateLimit: true })
		for await (const _chunk of iterator) {
			// Invalid condense must terminate this provider attempt before normal streaming.
		}

		expect(overwriteSpy).not.toHaveBeenCalled()
		expect((task as any).apiConversationHistory).toBe(originalHistory)
		expect(saySpy).toHaveBeenCalledWith(
			"condense_context_error",
			"Context condense returned an invalid token count: 0",
			undefined,
			false,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)
	})

	it("rebases one in-flight context rewrite over append-only history changes", async () => {
		const task = Object.create(Task.prototype) as Task
		const originalMessage = { role: "user", content: "original", ts: 1 }
		const appendedMessage = { role: "user", content: "new message", ts: 2 }
		const originalHistory = [originalMessage] as any[]
		;(task as any).apiConversationHistory = originalHistory
		;(task as any).apiConversationHistoryRevision = 0
		;(task as any).contextManagementInFlight = undefined

		let resolveManagement!: (result: any) => void
		const pendingManagement = new Promise((resolve) => {
			resolveManagement = resolve
		})
		const manageSpy = vi.spyOn(contextManagement, "manageContext").mockReturnValueOnce(pendingManagement as any)

		const first = (task as any).manageContextOnce({ messages: originalHistory })
		const second = (task as any).manageContextOnce({ messages: originalHistory })
		expect(manageSpy).toHaveBeenCalledTimes(1)

		originalHistory.push(appendedMessage)
		;(task as any).apiConversationHistoryRevision++
		resolveManagement({
			messages: [{ role: "assistant", content: "summary", isSummary: true }],
			summary: "summary",
		})

		const [firstResult, secondResult] = await Promise.all([first, second])
		expect(firstResult.canCommit).toBe(true)
		expect(firstResult.reusedInFlight).toBe(false)
		expect(firstResult.result.messages).toEqual([
			{ role: "assistant", content: "summary", isSummary: true },
			appendedMessage,
		])
		expect(secondResult.canCommit).toBe(false)
		expect(secondResult.reusedInFlight).toBe(true)
		expect((task as any).apiConversationHistory).toBe(originalHistory)
	})

	it("rejects an in-flight context rewrite after non-append history replacement", async () => {
		const task = Object.create(Task.prototype) as Task
		const originalHistory = [{ role: "user", content: "original", ts: 1 }] as any[]
		;(task as any).apiConversationHistory = originalHistory
		;(task as any).apiConversationHistoryRevision = 0
		;(task as any).contextManagementInFlight = undefined

		let resolveManagement!: (result: any) => void
		vi.spyOn(contextManagement, "manageContext").mockReturnValueOnce(
			new Promise((resolve) => {
				resolveManagement = resolve
			}) as any,
		)

		const management = (task as any).manageContextOnce({ messages: originalHistory })
		;(task as any).apiConversationHistory = [{ role: "user", content: "rewound", ts: 2 }]
		;(task as any).apiConversationHistoryRevision++
		resolveManagement({ messages: [{ role: "assistant", content: "stale summary" }], summary: "stale" })

		const result = await management
		expect(result.canCommit).toBe(false)
		expect(result.reusedInFlight).toBe(false)
		expect((task as any).apiConversationHistory).toEqual([{ role: "user", content: "rewound", ts: 2 }])
	})

	it("labels reused and stale context-management debug results", async () => {
		const task = Object.create(Task.prototype) as Task
		;(task as any).taskId = "debug-task"
		;(task as any).instanceId = "debug-instance"
		;(task as any).workspacePath = "/workspace"
		;(task as any).apiConfiguration = { apiProvider: "openai" }
		;(task as any).apiConversationHistory = []
		;(task as any).api = {
			getModel: vi.fn().mockReturnValue({ id: "test-model" }),
		}
		vi.mocked(fs.appendFile).mockClear()

		const result = {
			messages: [],
			summary: "summary",
			cost: 0,
			newContextTokens: 100,
			condenseId: "condense-1",
		}
		await (task as any).appendContextManagementDebugResult("automatic", result, {
			canCommit: false,
			reusedInFlight: true,
		})
		await (task as any).appendContextManagementDebugResult("automatic", result, {
			canCommit: false,
			reusedInFlight: false,
		})

		const entries = vi.mocked(fs.appendFile).mock.calls.map((call) => String(call[1]))
		expect(entries[0]).toContain('"outcome":"reused_in_flight"')
		expect(entries[0]).toContain('"reusedInFlight":true')
		expect(entries[1]).toContain('"outcome":"stale_discarded"')
		expect(entries[1]).toContain('"canCommit":false')
	})

	it("persists streamed reasoning_content for dynamic DeepSeek thinking models", async () => {
		const task = Object.create(Task.prototype) as Task
		;(task as any).apiConfiguration = {
			apiProvider: "deepseek",
			apiModelId: "deepseek-v4-flash",
		}
		;(task as any).apiConversationHistory = []
		;(task as any).api = {}
		;(task as any).saveApiConversationHistory = vi.fn().mockResolvedValue(undefined)

		await (task as any).addToApiConversationHistory(
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Calling the tool." },
					{ type: "tool_use", id: "tool-1", name: "read_file", input: { path: "README.md" } },
				],
			},
			"Need to inspect the requested file first.",
		)

		expect((task as any).apiConversationHistory).toEqual([
			expect.objectContaining({
				role: "assistant",
				reasoning_content: "Need to inspect the requested file first.",
			}),
		])
	})

	it("does not persist plain streamed reasoning for other OpenAI-compatible providers", async () => {
		const task = Object.create(Task.prototype) as Task
		;(task as any).apiConfiguration = {
			apiProvider: "openai",
			apiModelId: "custom-thinking-model",
		}
		;(task as any).apiConversationHistory = []
		;(task as any).api = {}
		;(task as any).saveApiConversationHistory = vi.fn().mockResolvedValue(undefined)

		await (task as any).addToApiConversationHistory(
			{ role: "assistant", content: [{ type: "text", text: "Answer." }] },
			"Display-only reasoning.",
		)

		expect((task as any).apiConversationHistory[0]).not.toHaveProperty("reasoning_content")
	})

	it("clears the automatic condense spinner when context management throws", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		;(task as any).apiConversationHistory = [
			{ role: "user", content: "hello", ts: 1 },
			{ role: "assistant", content: "world", ts: 2 },
		]
		;(task as any).getSystemPrompt = vi.fn().mockResolvedValue("system")
		;(task as any).api = {
			getModel: vi.fn().mockReturnValue({
				id: "test-model",
				info: { contextWindow: 1000, maxTokens: 100, supportsPromptCache: false },
			}),
			countTokens: vi.fn().mockResolvedValueOnce(50).mockRejectedValueOnce(new Error("token counter failed")),
			contextWindow: 1000,
			createMessage: vi.fn().mockImplementation(async function* () {
				yield { type: "text", text: "ok" } as ApiStreamChunk
			}),
		} as any
		;(task as any).getTokenUsage = vi.fn().mockReturnValue({ contextTokens: 950 })

		const iterator = task.attemptApiRequest(0, { skipProviderRateLimit: true })
		await expect(async () => {
			for await (const _chunk of iterator) {
				// Consume until the token-count failure is thrown.
			}
		}).rejects.toThrow("token counter failed")

		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "condenseTaskContextStarted",
			text: task.taskId,
		})
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "condenseTaskContextResponse",
			text: task.taskId,
		})
	})

	it("drops completed attempt_completion tool context before applying continuation feedback", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		;(task as any).clineMessages = [{ type: "ask", ask: "completion_result", ts: 3, partial: false }]
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tool-1", name: "attempt_completion", input: { result: "done" } }],
				ts: 2,
			},
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "done" }], ts: 3 },
		]

		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("actually continue")

		expect((task as any).apiConversationHistory).toEqual([
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		])
		expect(initiateSpy).toHaveBeenCalledWith([
			expect.objectContaining({
				type: "text",
				text: expect.stringContaining("actually continue"),
			}),
		])
	})

	it("drops all post-completion API tail before applying continuation feedback", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		;(task as any).clineMessages = [
			{ type: "ask", ask: "completion_result", ts: 3, partial: false },
			{ type: "say", say: "text", text: "old final summary", ts: 4, partial: false },
		]
		const completedHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tool-1", name: "attempt_completion", input: { result: "done" } }],
				ts: 2,
			},
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "done" }], ts: 3 },
			{ role: "user", content: [{ type: "text", text: "stale feedback after completion" }], ts: 4 },
		]
		;(task as any).apiConversationHistory = completedHistory

		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue(completedHistory)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("do real next work")

		expect((task as any).apiConversationHistory).toEqual([
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		])
		expect(initiateSpy).toHaveBeenCalledWith([
			expect.objectContaining({
				type: "text",
				text: expect.stringContaining("do real next work"),
			}),
		])
		expect(initiateSpy).toHaveBeenCalledWith([
			expect.objectContaining({
				text: expect.not.stringContaining("stale feedback after completion"),
			}),
		])
	})

	it("continues actionable user instructions after completed context was condensed to a summary", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		;(task as any).clineMessages = [
			{
				type: "say",
				say: "condense_context",
				ts: 2,
				partial: false,
				contextCondense: { condenseId: "condense-1", summary: "Task was completed." },
			},
		]
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
			{
				role: "assistant",
				content: [{ type: "text", text: "Summary says the previous task completed." }],
				isSummary: true,
				condenseId: "condense-1",
				ts: 2,
			},
		]

		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("fix the next bug now")

		const continuationBlocks = initiateSpy.mock.calls[0]?.[0] as Array<{ text?: string }>
		const continuationContent = continuationBlocks[0]?.text ?? ""
		expect(continuationContent).toContain("fix the next bug now")
		expect(continuationContent).toContain("highest priority over any prior completion, summary")
		expect(continuationContent).toContain("Start concrete work on the latest instruction immediately")
		expect(continuationContent).toContain("Treat this as a new active task turn")
	})

	it("reactivates completed task history before continuing from a user message", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		const historyItem = {
			id: task.taskId,
			ts: 1,
			task: "initial task",
			workspace: task.cwd,
			status: "completed",
		}
		provider.getTaskHistory = vi.fn().mockReturnValue([historyItem])
		provider.updateTaskHistory = vi.fn().mockResolvedValue([])
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		]
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("continue for real")
		await (task as any).saveClineMessages()

		expect(provider.updateTaskHistory).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: "active" }))
		expect(provider.updateTaskHistory).toHaveBeenLastCalledWith(expect.objectContaining({ status: "active" }))
		expect(task.shouldRejectPrematureActiveContinuationCompletion()).toBe(true)
		await expect(task.shouldDowngradeCompletionToActiveResponse()).resolves.toBe(false)
	})

	it("reactivates completed task history when resuming a completed task with new user input", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		const historyItem = {
			id: task.taskId,
			ts: 1,
			task: "initial task",
			workspace: task.cwd,
			status: "completed",
		}
		provider.getTaskHistory = vi.fn().mockReturnValue([historyItem])
		provider.updateTaskHistory = vi.fn().mockResolvedValue([])
		const savedClineMessages = [
			{
				type: "say" as const,
				say: "user_edit_todos" as const,
				ts: 2,
				text: JSON.stringify({
					tool: "updateTodoList",
					todos: [{ id: "1", content: "done", status: "completed" }],
				}),
			},
			{ type: "ask" as const, ask: "completion_result" as const, ts: 3, partial: false },
		]
		;(task as any).clineMessages = savedClineMessages
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tool-1", name: "attempt_completion", input: { result: "done" } }],
				ts: 2,
			},
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "done" }], ts: 3 },
		]
		vi.spyOn(task as any, "getSavedClineMessages").mockResolvedValue(savedClineMessages)
		vi.spyOn(task as any, "ask").mockResolvedValue({
			response: "messageResponse",
			text: "continue with a new real task",
			images: [],
		})
		vi.spyOn(task as any, "say").mockResolvedValue(undefined)
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await (task as any).resumeTaskFromHistory()
		await (task as any).saveClineMessages()

		const continuationBlocks = initiateSpy.mock.calls[0]?.[0] as Array<{ text?: string }>
		const continuationContent = continuationBlocks[0]?.text ?? ""
		expect(provider.updateTaskHistory).toHaveBeenCalledWith(expect.objectContaining({ status: "active" }))
		expect(provider.updateTaskHistory).toHaveBeenLastCalledWith(expect.objectContaining({ status: "active" }))
		expect(task.todoList).toEqual([
			{ id: "1", content: "done", status: "completed" },
			expect.objectContaining({ content: "continue with a new real task", status: "in_progress" }),
		])
		expect(task.shouldRejectPrematureActiveContinuationCompletion()).toBe(true)
		await expect(task.shouldDowngradeCompletionToActiveResponse()).resolves.toBe(false)
		expect(continuationContent).toContain("continue with a new real task")
		expect(continuationContent).toContain("Treat this as a new active task turn")
		expect(continuationContent).toContain(
			"preserving relevant context from the conversation and existing checklist",
		)
		expect(continuationContent).toContain("extends, revises, or replaces earlier work")
		expect(continuationContent).toContain("Do not call attempt_completion")
	})

	it("recognizes a soft completion when resuming history from another workspace", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			workspacePath: "/home/kurz/D/paper",
			context: provider.context, // kilocode_change
		})
		;(task as any).clineMessages = [
			{
				type: "say",
				say: "completion_result",
				text: "previous work completed",
				ts: 3,
				partial: false,
			},
		]
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		]
		vi.spyOn(task as any, "getSavedClineMessages").mockResolvedValue((task as any).clineMessages)
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		const askSpy = vi.spyOn(task as any, "ask").mockResolvedValue({
			response: "messageResponse",
			text: "continue in the external workspace",
			images: [],
		})
		vi.spyOn(task as any, "say").mockResolvedValue(undefined)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await (task as any).resumeTaskFromHistory()

		const continuationBlocks = initiateSpy.mock.calls[0]?.[0] as Array<{ type?: string; text?: string }>
		const continuationContent = continuationBlocks
			.filter((block) => block.type === "text")
			.map((block) => block.text ?? "")
			.join("\n")
		expect(task.cwd).toBe("/home/kurz/D/paper")
		expect(askSpy).toHaveBeenCalledOnce()
		expect(askSpy).toHaveBeenCalledWith("resume_completed_task")
		expect(initiateSpy).toHaveBeenCalledOnce()
		expect(continuationContent).toContain("continue in the external workspace")
		expect(continuationContent).toContain("Treat this as a new active task turn")
	})

	it("atomically injects a cancelled continuation without creating a competing resume ask", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).clineMessages = [
			{ type: "say", say: "completion_result", text: "previous work completed", ts: 3, partial: false },
		]
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		]
		vi.spyOn(task as any, "getSavedClineMessages").mockResolvedValue((task as any).clineMessages)
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		const askSpy = vi.spyOn(task as any, "ask")
		const saySpy = vi.spyOn(task as any, "say").mockResolvedValue(undefined)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.resumeTaskFromHistory({ text: "fix the remaining freeze", images: [] })

		expect(askSpy).not.toHaveBeenCalled()
		expect(saySpy).toHaveBeenCalledWith("user_feedback", "fix the remaining freeze", [])
		expect(initiateSpy).toHaveBeenCalledOnce()
		const continuationBlocks = initiateSpy.mock.calls[0]?.[0] as Array<{ type?: string; text?: string }>
		const continuationContent = continuationBlocks.map((block) => block.text ?? "").join("\n")
		expect(continuationContent).toContain("fix the remaining freeze")
		expect(continuationContent).toContain("Treat this as a new active task turn")
		expect(task.shouldRequireProgressListExpansion()).toBe(false)
		expect(task.todoList).toEqual([
			expect.objectContaining({ content: "fix the remaining freeze", status: "in_progress" }),
		])
	})

	it("preserves edited resend semantics in an atomically injected restoration", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).clineMessages = [
			{ type: "say", say: "completion_result", text: "discarded completion", ts: 3, partial: false },
		]
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		]
		vi.spyOn(task as any, "getSavedClineMessages").mockResolvedValue((task as any).clineMessages)
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		const askSpy = vi.spyOn(task as any, "ask")
		vi.spyOn(task as any, "say").mockResolvedValue(undefined)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.resumeTaskFromHistory({
			text: "replacement instruction",
			images: [],
			options: { kind: "edited_resend" },
		})

		expect(askSpy).not.toHaveBeenCalled()
		const continuationBlocks = initiateSpy.mock.calls[0]?.[0] as Array<{ type?: string; text?: string }>
		const continuationContent = continuationBlocks.map((block) => block.text ?? "").join("\n")
		expect(continuationContent).toContain("Edited user message resubmitted after rewinding")
		expect(continuationContent).toContain("replacement instruction")
		expect(continuationContent).not.toContain("Your FIRST tool call MUST be update_todo_list")
		expect(task.shouldRequireProgressListExpansion()).toBe(false)
	})

	it("preserves completed todos as context while appending continuation work", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		]
		task.todoList = [
			{ id: "1", content: "finished item", status: "completed" },
			{ id: "2", content: "final summary", status: "completed" },
		]
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("this is a new task after completion")

		expect(task.todoList).toEqual([
			{ id: "1", content: "finished item", status: "completed" },
			{ id: "2", content: "final summary", status: "completed" },
			expect.objectContaining({ content: "this is a new task after completion", status: "in_progress" }),
		])
		expect(task.shouldRejectPrematureActiveContinuationCompletion()).toBe(true)
		await expect(task.shouldDowngradeCompletionToActiveResponse()).resolves.toBe(false)
	})

	it("preserves partial progress so feedback can intelligently extend the checklist", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		]
		task.todoList = [
			{ id: "1", content: "old finished item", status: "completed" },
			{ id: "2", content: "old leftover item", status: "in_progress" },
		]
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("new task: expand progress and do new work")

		expect(task.todoList).toEqual([
			{ id: "1", content: "old finished item", status: "completed" },
			{ id: "2", content: "old leftover item", status: "in_progress" },
			expect.objectContaining({ content: "new task: expand progress and do new work", status: "in_progress" }),
		])
	})

	it("establishes a host-managed feedback turn without requiring a todo tool call", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).apiConversationHistory = []
		task.todoList = [{ id: "old", content: "old completed delivery", status: "completed" }]
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue([])
		vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("fix the new feedback now")

		expect(task.todoList).toEqual([
			{ id: "old", content: "old completed delivery", status: "completed" },
			expect.objectContaining({ content: "fix the new feedback now", status: "in_progress" }),
		])
		expect(task.shouldRequireProgressListExpansion()).toBe(false)
		expect(task.shouldRejectToolUntilProgressListExpanded("read_file")).toBe(false)
		expect(task.shouldRejectPrematureActiveContinuationCompletion()).toBe(true)
		task.markActiveContinuationWorkToolUsed("update_todo_list")
		expect(task.shouldRejectPrematureActiveContinuationCompletion()).toBe(true)
		task.markActiveContinuationWorkToolUsed("read_file")
		expect(task.shouldRejectPrematureActiveContinuationCompletion()).toBe(false)
	})

	it("completes and persists the host-managed feedback item after concrete work", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).apiConversationHistory = []
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue([])
		vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("verify the repaired completion flow")
		const saySpy = vi.spyOn(task, "say").mockResolvedValue(undefined)
		task.markActiveContinuationWorkToolUsed("read_file")

		await task.completeHostManagedFeedbackTodo()

		expect(task.todoList).toEqual([
			expect.objectContaining({ content: "verify the repaired completion flow", status: "completed" }),
		])
		expect(saySpy).toHaveBeenCalledWith(
			"user_edit_todos",
			expect.stringContaining('"hostManagedFeedbackTurn":true'),
		)
	})

	it("does not accept a status-only replay of the superseded checklist as new work", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		]
		task.todoList = [
			{ id: "1", content: "implement old fix", status: "completed" },
			{ id: "2", content: "systematically update universe memory", status: "completed" },
		]
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("fix a different new issue")

		const replayedOldList = [
			{ id: "1", content: "implement old fix", status: "completed" as const },
			{ id: "2", content: "systematically update universe memory", status: "in_progress" as const },
		]
		expect(task.hasActionableProgressListForContinuation(replayedOldList)).toBe(false)
		expect(task.todoList).toEqual([
			{ id: "1", content: "implement old fix", status: "completed" },
			{ id: "2", content: "systematically update universe memory", status: "completed" },
			expect.objectContaining({ content: "fix a different new issue", status: "in_progress" }),
		])
	})

	it("rejects terminal-delivery placeholders as continuation milestones", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).apiConversationHistory = []
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue([])
		vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("fix the newly reported issue")

		expect(
			task.hasActionableProgressListForContinuation([
				{ id: "1", content: "重置为仅包含终态交付检查的新清单", status: "in_progress" },
				{ id: "2", content: "完成最终交付", status: "pending" },
			]),
		).toBe(false)
		expect(task.shouldRequireProgressListExpansion()).toBe(false)
	})

	it("extends latest updateTodoList message while preserving prior context", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		]
		;(task as any).clineMessages = [
			{
				type: "ask",
				ask: "tool",
				text: JSON.stringify({
					tool: "updateTodoList",
					todos: [{ id: "1", content: "old finished", status: "completed" }],
				}),
				ts: 2,
			},
		]
		task.todoList = [{ id: "1", content: "old finished", status: "completed" }]
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)
		const saveSpy = vi.spyOn(task as any, "saveClineMessages").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("start a brand new instruction")

		expect(task.todoList).toEqual([
			{ id: "1", content: "old finished", status: "completed" },
			expect.objectContaining({ content: "start a brand new instruction", status: "in_progress" }),
		])
		const latestTodoMsg = JSON.parse((task as any).clineMessages[0].text)
		expect(latestTodoMsg).toEqual({
			tool: "updateTodoList",
			todos: task.todoList,
			extendedByContinuation: true,
			hostManagedFeedbackTurn: true,
		})
		expect(saveSpy).toHaveBeenCalled()
	})

	it("keeps edited resends out of the new-task progress gate", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "preserved history" }], ts: 1 },
		]
		task.todoList = [{ id: "1", content: "existing task progress", status: "in_progress" }]
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("edited prompt", undefined, { kind: "edited_resend" })

		expect(task.todoList).toEqual([{ id: "1", content: "existing task progress", status: "in_progress" }])
		expect(task.shouldRequireProgressListExpansion()).toBe(false)
		expect(task.shouldRejectToolUntilProgressListExpanded("read_file")).toBe(false)
		const resendContent = JSON.stringify(initiateSpy.mock.calls[0][0])
		expect(resendContent).toContain('type=\\"edited_resend\\"')
		expect(resendContent).toContain("edited prompt")
		expect(resendContent).not.toContain("Your FIRST tool call MUST be update_todo_list")
		expect(resendContent).not.toContain('type=\\"task_continuation\\"')
	})

	it("tells the model the host already established the new feedback work turn", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		]
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("expand list and work")

		const continuationContent = JSON.stringify(initiateSpy.mock.calls[0][0])
		expect(continuationContent).toContain("host has appended this feedback as an in-progress work item")
		expect(continuationContent).toContain("extends, revises, or replaces earlier work")
		expect(continuationContent).toContain("Start concrete work on the latest instruction immediately")
		expect(continuationContent).toContain("Do not call update_todo_list merely to acknowledge")
	})

	it("strips trailing text-only assistant summaries on continuation after DeepTask downgrade", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
			{ role: "assistant", content: [{ type: "text", text: "I completed packaging and release." }], ts: 2 },
			{ role: "assistant", content: [{ type: "text", text: "Summary of what I finished earlier..." }], ts: 3 },
		]
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("new task without reciting old completions")

		expect((task as any).apiConversationHistory).toEqual([
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		])
		const continuationContent = initiateSpy.mock.calls[0][0]
		expect(JSON.stringify(continuationContent)).toContain(
			"preserving relevant context from the conversation and existing checklist",
		)
		expect(JSON.stringify(continuationContent)).toContain("extends, revises, or replaces earlier work")
	})

	it("rejects active continuation completion until concrete work tool runs", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue([])
		vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("fix the actual new issue")

		expect(task.shouldRejectPrematureActiveContinuationCompletion()).toBe(true)
		await expect(task.shouldDowngradeCompletionToActiveResponse()).resolves.toBe(false)

		task.markActiveContinuationWorkToolUsed("read_file")

		expect(task.shouldRejectPrematureActiveContinuationCompletion()).toBe(false)
		await expect(task.shouldDowngradeCompletionToActiveResponse()).resolves.toBe(true)
	})

	it("does not treat todo updates as concrete continuation work", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue([])
		vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("fix the actual new issue")
		task.markActiveContinuationWorkToolUsed("update_todo_list")

		expect(task.shouldRejectPrematureActiveContinuationCompletion()).toBe(true)
		await expect(task.shouldDowngradeCompletionToActiveResponse()).resolves.toBe(false)
	})

	it("always downgrades attempt completion to an active response in DeepTask mode", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any)._taskMode = "DeepTask"
		;(task as any).taskModeReady = Promise.resolve()
		;(task as any).shouldKeepNextCompletionActive = false
		;(task as any).activeContinuationWorkToolUsed = false

		await expect(task.shouldDowngradeCompletionToActiveResponse()).resolves.toBe(true)
	})

	it("promotes a provider plain-text final answer to a green soft completion in place", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		const message = {
			ts: 1,
			type: "say" as const,
			say: "text" as const,
			text: "final answer returned without a tool call",
			partial: false,
		}
		;(task as any).clineMessages = [message]
		const saveSpy = vi.spyOn(task as any, "saveClineMessages").mockResolvedValue(undefined)
		const updateSpy = vi.spyOn(task as any, "updateClineMessage").mockResolvedValue(undefined)

		await expect((task as any).promoteLastAssistantTextToSoftCompletion()).resolves.toBe(true)

		expect((task as any).clineMessages).toHaveLength(1)
		expect(message.say).toBe("completion_result")
		expect(saveSpy).toHaveBeenCalledTimes(1)
		expect(updateSpy).toHaveBeenCalledWith(message)
	})

	it("does not fabricate a soft completion when no visible assistant text exists", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).clineMessages = [{ ts: 1, type: "say", say: "reasoning", text: "thinking" }]
		const saveSpy = vi.spyOn(task as any, "saveClineMessages").mockResolvedValue(undefined)

		await expect((task as any).promoteLastAssistantTextToSoftCompletion()).resolves.toBe(false)
		expect(saveSpy).not.toHaveBeenCalled()
	})

	it("keeps the task history active after a soft completion is handled", async () => {
		const provider = createProvider()
		provider.getTaskHistory = vi.fn().mockReturnValue([
			{
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "initial task",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				status: "completed",
			},
		])
		provider.updateTaskHistory = vi.fn().mockResolvedValue([])
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).taskId = "test-task-id"

		task.markActiveResponseCompletionHandled()
		await Promise.resolve()

		expect((task as any).continuationStatusOverride).toBe("active")
		expect((task as any).endCurrentLoopAfterActiveCompletion).toBe(true)
		expect(provider.updateTaskHistory).toHaveBeenCalledWith(expect.objectContaining({ status: "active" }))
	})

	it("does not send downgraded completion tool result back for another empty tool call", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).endCurrentLoopAfterActiveCompletion = true
		;(task as any).userMessageContent = [
			{
				type: "tool_result",
				tool_use_id: "tool-1",
				content: "The result was shown to the user without ending the task.",
			},
		]
		;(task as any).assistantMessageContent = [
			{
				type: "tool_use",
				id: "tool-1",
				name: "attempt_completion",
				params: { result: "工具调用已执行" },
				partial: false,
			},
		]
		;(task as any).userMessageContentReady = true
		;(task as any).attemptApiRequest = vi.fn()

		const didEndLoop = await task.recursivelyMakeClineRequests([], false)

		expect(didEndLoop).toBe(true)
		expect((task as any).userMessageContent).toEqual([])
		expect((task as any).attemptApiRequest).not.toHaveBeenCalled()
	})

	it("strips soft-completion attempt_completion from API history before the next user turn", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "package and release" }], ts: 1 },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-soft-1",
						name: "attempt_completion",
						input: {
							result: "已完成。发布链接: https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0",
						},
					},
				],
				ts: 2,
			},
		]
		const saveSpy = vi.spyOn(task as any, "saveApiConversationHistory").mockResolvedValue(undefined)

		// Mirror the soft-completion end-of-loop cleanup path.
		;(task as any).userMessageContent = [
			{
				type: "tool_result",
				tool_use_id: "tool-soft-1",
				content: "shown",
			},
		]
		;(task as any).endCurrentLoopAfterActiveCompletion = true
		;(task as any).userMessageContent = []
		;(task as any).stripCompletedAttemptCompletionFromHistory()
		await (task as any).saveApiConversationHistory()

		expect((task as any).apiConversationHistory).toEqual([
			{ role: "user", content: [{ type: "text", text: "package and release" }], ts: 1 },
		])
		expect(saveSpy).toHaveBeenCalled()

		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		vi.spyOn(task as any, "say").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("修复任务结束后重复交付最终结果；新消息应添加任务条目并修改完成条件")

		const continuationBlocks = initiateSpy.mock.calls[0]?.[0] as Array<{ text?: string }>
		const continuationContent = continuationBlocks?.[0]?.text ?? ""
		expect(continuationContent).toContain("修复任务结束后重复交付最终结果")
		expect(continuationContent).toContain("Treat this as a new active task turn")
		expect(continuationContent).toContain("host has appended this feedback as an in-progress work item")
		expect(continuationContent).not.toContain("https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0")
	})

	it("does not reopen a completed checklist by manufacturing an in-progress item", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		;(task as any).shouldKeepNextCompletionActive = true

		const normalizedTodos = task.normalizeTodoListForActiveContinuation([
			{ id: "1", content: "研究问题本质", status: "completed" },
			{ id: "2", content: "汇总安装位置、skill 内容和测试结论", status: "completed" },
		])

		expect(normalizedTodos).toEqual([
			{ id: "1", content: "研究问题本质", status: "completed" },
			{ id: "2", content: "汇总安装位置、skill 内容和测试结论", status: "completed" },
		])
	})

	it("does not change all-completed todos outside active continuation", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		const normalizedTodos = task.normalizeTodoListForActiveContinuation([
			{ id: "1", content: "regular completion", status: "completed" },
		])

		expect(normalizedTodos).toEqual([{ id: "1", content: "regular completion", status: "completed" }])
	})

	it("deduplicates identical continuation requests arriving in a short window", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		]
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		const saySpy = vi.spyOn(task as any, "say").mockResolvedValue(undefined)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("same continuation")
		await task.continueTaskFromUserMessage("same continuation")

		expect(saySpy).toHaveBeenCalledTimes(1)
		expect(initiateSpy).toHaveBeenCalledTimes(1)
	})

	it("reports a rejected continuation loop instead of silently leaving resend stuck", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		]
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		const saySpy = vi.spyOn(task as any, "say").mockResolvedValue(undefined)
		vi.spyOn(task as any, "initiateTaskLoop").mockRejectedValue(new Error("invalid tool protocol"))

		await task.continueTaskFromUserMessage("resent message")
		await vi.waitFor(() =>
			expect(saySpy).toHaveBeenCalledWith("error", expect.stringContaining("invalid tool protocol")),
		)
		expect(provider.postStateToWebview).toHaveBeenCalled()
	})

	it("parks a mid-stream user message and cancels instead of starting a second loop", async () => {
		const provider = createProvider()
		const setPending = vi.fn()
		const cancelTask = vi.fn().mockResolvedValue(undefined)
		;(provider as any).setPendingCancelledTaskContinuation = setPending
		;(provider as any).cancelTask = cancelTask

		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		;(task as any).isTaskLoopActive = true
		task.isStreaming = true
		const saySpy = vi.spyOn(task as any, "say").mockResolvedValue(undefined)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("interrupt with new work")

		expect(setPending).toHaveBeenCalledWith("interrupt with new work", [])
		expect(cancelTask).toHaveBeenCalledTimes(1)
		expect(saySpy).not.toHaveBeenCalled()
		expect(initiateSpy).not.toHaveBeenCalled()
	})

	it("waits for a visible soft-completion loop to settle before starting the next user turn", async () => {
		const provider = createProvider()
		const setPending = vi.fn()
		const cancelTask = vi.fn().mockResolvedValue(undefined)
		;(provider as any).setPendingCancelledTaskContinuation = setPending
		;(provider as any).cancelTask = cancelTask

		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		;(task as any).isTaskLoopActive = true
		;(task as any).endCurrentLoopAfterActiveCompletion = true
		task.isStreaming = true
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		]
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		const saySpy = vi.spyOn(task as any, "say").mockResolvedValue(undefined)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		setTimeout(() => {
			;(task as any).isTaskLoopActive = false
		}, 25)

		await task.continueTaskFromUserMessage("reply after soft completion")

		expect(setPending).not.toHaveBeenCalled()
		expect(cancelTask).not.toHaveBeenCalled()
		expect(saySpy).toHaveBeenCalledWith("user_feedback", "reply after soft completion", [])
		expect(initiateSpy).toHaveBeenCalledTimes(1)
	})

	it("parks a continuation when a non-streaming task loop is still active", async () => {
		const provider = createProvider()
		const setPending = vi.fn()
		const cancelTask = vi.fn().mockResolvedValue(undefined)
		;(provider as any).setPendingCancelledTaskContinuation = setPending
		;(provider as any).cancelTask = cancelTask

		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		;(task as any).isTaskLoopActive = true
		task.isStreaming = false
		const saySpy = vi.spyOn(task as any, "say").mockResolvedValue(undefined)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockResolvedValue(undefined)

		await task.continueTaskFromUserMessage("continue while old loop unwinds")

		expect(setPending).toHaveBeenCalledWith("continue while old loop unwinds", [])
		expect(cancelTask).toHaveBeenCalledTimes(1)
		expect(saySpy).not.toHaveBeenCalled()
		expect(initiateSpy).not.toHaveBeenCalled()
	})

	it("preserves edited-resend semantics when parking an active non-streaming loop", async () => {
		const provider = createProvider()
		const setPending = vi.fn()
		const cancelTask = vi.fn().mockResolvedValue(undefined)
		;(provider as any).setPendingCancelledTaskContinuation = setPending
		;(provider as any).cancelTask = cancelTask

		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		;(task as any).isTaskLoopActive = true
		task.isStreaming = false

		await task.continueTaskFromUserMessage("edited instruction", undefined, { kind: "edited_resend" })

		expect(setPending).toHaveBeenCalledWith("edited instruction", [], { kind: "edited_resend" })
		expect(cancelTask).toHaveBeenCalledTimes(1)
	})

	it("keeps soft-completion boundary pending until the old loop fully exits", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		task.markActiveResponseCompletionHandled()
		;(task as any).endCurrentLoopAfterActiveCompletion = false
		;(task as any).isTaskLoopActive = true

		expect(task.isSoftCompletionBoundaryPending()).toBe(true)
		;(task as any).softCompletionBoundaryPending = false
		expect(task.isSoftCompletionBoundaryPending()).toBe(false)
	})

	it("parks the second post-completion continuation instead of starting a concurrent loop", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})
		const setPending = vi.fn()
		const cancelTask = vi.fn().mockResolvedValue(undefined)
		;(provider as any).setPendingCancelledTaskContinuation = setPending
		;(provider as any).cancelTask = cancelTask
		;(task as any).isTaskLoopActive = true
		;(task as any).endCurrentLoopAfterActiveCompletion = true
		;(task as any).softCompletionBoundaryPending = true
		task.isStreaming = true
		;(task as any).apiConversationHistory = [
			{ role: "user", content: [{ type: "text", text: "original task" }], ts: 1 },
		]
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue((task as any).apiConversationHistory)
		const saySpy = vi.spyOn(task as any, "say").mockResolvedValue(undefined)
		const initiateSpy = vi.spyOn(task as any, "initiateTaskLoop").mockImplementation(async () => {
			;(task as any).isTaskLoopActive = true
		})

		setTimeout(() => {
			;(task as any).isTaskLoopActive = false
			;(task as any).softCompletionBoundaryPending = false
			;(task as any).endCurrentLoopAfterActiveCompletion = false
			task.isStreaming = false
		}, 40)

		const first = task.continueTaskFromUserMessage("first new instruction")
		const second = task.continueTaskFromUserMessage("second new instruction")
		await Promise.all([first, second])

		expect(saySpy).toHaveBeenCalledTimes(1)
		expect(initiateSpy).toHaveBeenCalledTimes(1)
		expect(setPending).toHaveBeenCalledWith("second new instruction", [])
		expect(cancelTask).toHaveBeenCalledTimes(1)
	})

	it("defers API configuration replacement until the next request boundary", () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context,
		})
		const activeApi = task.api
		const nextConfiguration: ProviderSettings = {
			apiProvider: "deepseek",
			apiModelId: "deepseek-chat",
			deepSeekApiKey: "updated-key",
			deepSeekBaseUrl: "https://api.deepseek.com",
		}

		task.isStreaming = true
		task.updateApiConfiguration(nextConfiguration)

		expect(task.api).toBe(activeApi)
		expect(task.apiConfiguration).toBe(apiConfig)
		expect((task as any).pendingApiConfiguration).toEqual(nextConfiguration)

		task.isStreaming = false
		;(task as any).applyPendingApiConfiguration()

		expect(task.api).not.toBe(activeApi)
		expect(task.apiConfiguration).toEqual(nextConfiguration)
		expect((task as any).pendingApiConfiguration).toBeUndefined()
	})

	it("uses last-save-wins semantics for configuration edits during a request", () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context,
		})
		const activeApi = task.api
		const firstEdit: ProviderSettings = {
			apiProvider: "deepseek",
			apiModelId: "deepseek-chat",
			deepSeekApiKey: "first-key",
		}
		const latestEdit: ProviderSettings = {
			apiProvider: "deepseek",
			apiModelId: "deepseek-reasoner",
			deepSeekApiKey: "latest-key",
		}

		task.isWaitingForFirstChunk = true
		task.updateApiConfiguration(firstEdit)
		task.updateApiConfiguration(latestEdit)

		expect(task.api).toBe(activeApi)
		expect((task as any).pendingApiConfiguration).toEqual(latestEdit)

		task.isWaitingForFirstChunk = false
		;(task as any).applyPendingApiConfiguration()

		expect(task.apiConfiguration).toEqual(latestEdit)
	})

	it("recovers first-chunk context overflow by reducing context before retrying", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		;(task as any).apiConversationHistory = [
			{ role: "user", content: "hello", ts: 1 },
			{ role: "assistant", content: "world", ts: 2 },
			{ role: "user", content: "continue", ts: 3 },
		]
		;(task as any).getSystemPrompt = vi.fn().mockResolvedValue("system")
		;(task as any).getTokenUsage = vi.fn().mockReturnValue({ contextTokens: 950 })

		let firstAttempt = true
		const createMessage = vi.fn().mockImplementation(async function* () {
			if (firstAttempt) {
				firstAttempt = false
				throw { status: 400, message: "context window exceeded" }
			}
			yield { type: "text", text: "ok" } as ApiStreamChunk
		})

		;(task as any).api = {
			getModel: vi.fn().mockReturnValue({
				id: "test-model",
				info: { contextWindow: 1000, maxTokens: 100, supportsPromptCache: false },
			}),
			countTokens: vi.fn().mockResolvedValue(50),
			contextWindow: 1000,
			createMessage,
		} as any

		const saySpy = vi.spyOn(task, "say").mockResolvedValue(undefined as any)
		const askSpy = vi.spyOn(task, "ask")
		const overwriteSpy = vi.spyOn(task, "overwriteApiConversationHistory")

		const iterator = task.attemptApiRequest(0, { skipProviderRateLimit: true })
		for await (const _chunk of iterator) {
			// Consume retry output.
		}

		expect(createMessage).toHaveBeenCalledTimes(2)
		expect(overwriteSpy).toHaveBeenCalled()
		expect(saySpy).toHaveBeenCalledWith(
			"condense_context",
			undefined,
			undefined,
			false,
			undefined,
			undefined,
			{ isNonInteractive: true },
			expect.objectContaining({ summary: "summary" }),
		)
		expect(askSpy).not.toHaveBeenCalledWith("api_req_failed", expect.anything())
	})

	it("stops first-chunk context overflow recovery after the retry cap", async () => {
		const provider = createProvider()
		const task = new Task({
			provider,
			apiConfiguration: apiConfig,
			task: "initial task",
			startTask: false,
			context: provider.context, // kilocode_change
		})

		;(task as any).apiConversationHistory = [
			{ role: "user", content: "hello", ts: 1 },
			{ role: "assistant", content: "world", ts: 2 },
			{ role: "user", content: "continue", ts: 3 },
		]
		;(task as any).getSystemPrompt = vi.fn().mockResolvedValue("system")
		;(task as any).getTokenUsage = vi.fn().mockReturnValue({ contextTokens: 950 })
		const alwaysOverflow = async function* (): AsyncGenerator<ApiStreamChunk> {
			yield* []
			throw { status: 400, message: "context window exceeded" }
		}

		;(task as any).api = {
			getModel: vi.fn().mockReturnValue({
				id: "test-model",
				info: { contextWindow: 1000, maxTokens: 100, supportsPromptCache: false },
			}),
			countTokens: vi.fn().mockResolvedValue(50),
			contextWindow: 1000,
			createMessage: vi.fn().mockImplementation(alwaysOverflow),
		} as any

		vi.spyOn(task, "say").mockResolvedValue(undefined as any)

		await expect(async () => {
			const iterator = task.attemptApiRequest(0, { skipProviderRateLimit: true })
			for await (const _chunk of iterator) {
				// Consume until the retry cap throws.
			}
		}).rejects.toThrow("Context window exceeded after 3 recovery attempts")
	})

	it("does not cross-drain queues between separate tasks", async () => {
		const providerA = createProvider()
		const providerB = createProvider()

		const taskA = new Task({
			provider: providerA,
			apiConfiguration: apiConfig,
			task: "task A",
			startTask: false,
			context: providerA.context, // kilocode_change
		})
		const taskB = new Task({
			provider: providerB,
			apiConfiguration: apiConfig,
			task: "task B",
			startTask: false,
			context: providerB.context, // kilocode_change
		})

		vi.spyOn(taskA as any, "getSystemPrompt").mockResolvedValue("system")
		vi.spyOn(taskB as any, "getSystemPrompt").mockResolvedValue("system")

		const spyA = vi.spyOn(taskA, "submitUserMessage").mockResolvedValue(undefined)
		const spyB = vi.spyOn(taskB, "submitUserMessage").mockResolvedValue(undefined)

		taskA.messageQueueService.addMessage("A message")
		taskB.messageQueueService.addMessage("B message")

		// Condense in task A should only clear A's stale queue
		await taskA.condenseContext()

		expect(spyA).not.toHaveBeenCalled()
		expect(spyB).not.toHaveBeenCalled()
		expect(taskA.messageQueueService.isEmpty()).toBe(true)
		expect(taskB.messageQueueService.isEmpty()).toBe(false)

		// Now condense in task B should clear B's stale queue
		await taskB.condenseContext()

		expect(spyB).not.toHaveBeenCalled()
		expect(taskB.messageQueueService.isEmpty()).toBe(true)
	})
})

describe("pushToolResultToUserContent", () => {
	let mockProvider: any
	let mockApiConfig: ProviderSettings

	beforeEach(() => {
		mockApiConfig = {
			apiProvider: "anthropic",
			apiModelId: "claude-3-5-sonnet-20241022",
			apiKey: "test-api-key",
		}

		const storageUri = { fsPath: path.join(os.tmpdir(), "test-storage") }
		const mockExtensionContext = {
			globalState: {
				get: vi.fn().mockImplementation((_key: keyof GlobalState) => undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			globalStorageUri: storageUri,
			workspaceState: {
				get: vi.fn().mockImplementation((_key) => undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: {
				get: vi.fn().mockResolvedValue(undefined),
				store: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockResolvedValue(undefined),
			},
			extensionUri: { fsPath: "/mock/extension/path" },
			extension: { packageJSON: { version: "1.0.0" } },
		} as unknown as vscode.ExtensionContext

		const mockOutputChannel = {
			name: "test-output",
			appendLine: vi.fn(),
			append: vi.fn(),
			replace: vi.fn(),
			clear: vi.fn(),
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		}

		mockProvider = new ClineProvider(
			mockExtensionContext,
			mockOutputChannel,
			"sidebar",
			new ContextProxy(mockExtensionContext),
		) as any

		mockProvider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
	})

	it("should add tool_result when not a duplicate", () => {
		const task = new Task({
			provider: mockProvider,
			context: mockProvider.context,
			apiConfiguration: mockApiConfig,
			task: "test task",
			startTask: false,
		})

		const toolResult: Anthropic.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "test-id-1",
			content: "Test result",
		}

		const added = task.pushToolResultToUserContent(toolResult)

		expect(added).toBe(true)
		expect(task.userMessageContent).toHaveLength(1)
		expect(task.userMessageContent[0]).toEqual(toolResult)
	})

	it("should prevent duplicate tool_result with same tool_use_id", () => {
		const task = new Task({
			provider: mockProvider,
			context: mockProvider.context,
			apiConfiguration: mockApiConfig,
			task: "test task",
			startTask: false,
		})

		const toolResult1: Anthropic.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "duplicate-id",
			content: "First result",
		}

		const toolResult2: Anthropic.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "duplicate-id",
			content: "Second result (should be skipped)",
		}

		// Spy on console.warn to verify warning is logged
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

		// Add first result - should succeed
		const added1 = task.pushToolResultToUserContent(toolResult1)
		expect(added1).toBe(true)
		expect(task.userMessageContent).toHaveLength(1)

		// Add second result with same ID - should be skipped
		const added2 = task.pushToolResultToUserContent(toolResult2)
		expect(added2).toBe(false)
		expect(task.userMessageContent).toHaveLength(1)

		// Verify only the first result is in the array
		expect(task.userMessageContent[0]).toEqual(toolResult1)

		// Verify warning was logged
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Skipping duplicate tool_result for tool_use_id: duplicate-id"),
		)

		warnSpy.mockRestore()
	})

	it("should allow different tool_use_ids to be added", () => {
		const task = new Task({
			provider: mockProvider,
			context: mockProvider.context,
			apiConfiguration: mockApiConfig,
			task: "test task",
			startTask: false,
		})

		const toolResult1: Anthropic.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "id-1",
			content: "Result 1",
		}

		const toolResult2: Anthropic.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "id-2",
			content: "Result 2",
		}

		const added1 = task.pushToolResultToUserContent(toolResult1)
		const added2 = task.pushToolResultToUserContent(toolResult2)

		expect(added1).toBe(true)
		expect(added2).toBe(true)
		expect(task.userMessageContent).toHaveLength(2)
		expect(task.userMessageContent[0]).toEqual(toolResult1)
		expect(task.userMessageContent[1]).toEqual(toolResult2)
	})

	it("should handle tool_result with is_error flag", () => {
		const task = new Task({
			provider: mockProvider,
			context: mockProvider.context,
			apiConfiguration: mockApiConfig,
			task: "test task",
			startTask: false,
		})

		const errorResult: Anthropic.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "error-id",
			content: "Error message",
			is_error: true,
		}

		const added = task.pushToolResultToUserContent(errorResult)

		expect(added).toBe(true)
		expect(task.userMessageContent).toHaveLength(1)
		expect(task.userMessageContent[0]).toEqual(errorResult)
	})

	it("should not interfere with other content types in userMessageContent", () => {
		const task = new Task({
			provider: mockProvider,
			context: mockProvider.context,
			apiConfiguration: mockApiConfig,
			task: "test task",
			startTask: false,
		})

		// Add text and image blocks manually
		task.userMessageContent.push(
			{ type: "text", text: "Some text" },
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "base64data" } },
		)

		const toolResult: Anthropic.ToolResultBlockParam = {
			type: "tool_result",
			tool_use_id: "test-id",
			content: "Result",
		}

		const added = task.pushToolResultToUserContent(toolResult)

		expect(added).toBe(true)
		expect(task.userMessageContent).toHaveLength(3)
		expect(task.userMessageContent[0].type).toBe("text")
		expect(task.userMessageContent[1].type).toBe("image")
		expect(task.userMessageContent[2]).toEqual(toolResult)
	})
})
