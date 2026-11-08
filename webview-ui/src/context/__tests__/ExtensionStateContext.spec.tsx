import { render, screen, act } from "@/utils/test-utils"

import {
	type ProviderSettings,
	type ExperimentId,
	type ExtensionState,
	openRouterDefaultModelId, // kilocode_change
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
} from "@roo-code/types"

import { ExtensionStateContextProvider, useExtensionState, mergeExtensionState } from "../ExtensionStateContext"

const TestComponent = () => {
	const {
		allowedCommands,
		setAllowedCommands,
		soundEnabled,
		showRooIgnoredFiles,
		setShowRooIgnoredFiles,
		autoApprovalEnabled,
		alwaysAllowReadOnly,
		alwaysAllowWrite,
		clineMessages,
	} = useExtensionState()
	return (
		<div>
			<div data-testid="allowed-commands">{JSON.stringify(allowedCommands)}</div>
			<div data-testid="sound-enabled">{JSON.stringify(soundEnabled)}</div>
			<div data-testid="show-rooignored-files">{JSON.stringify(showRooIgnoredFiles)}</div>
			<div data-testid="auto-approval-enabled">{JSON.stringify(autoApprovalEnabled)}</div>
			<div data-testid="always-allow-read-only">{JSON.stringify(alwaysAllowReadOnly)}</div>
			<div data-testid="always-allow-write">{JSON.stringify(alwaysAllowWrite)}</div>
			<div data-testid="cline-messages">{JSON.stringify(clineMessages)}</div>
			<button data-testid="update-button" onClick={() => setAllowedCommands(["npm install", "git status"])}>
				Update Commands
			</button>
			<button data-testid="toggle-rooignore-button" onClick={() => setShowRooIgnoredFiles(!showRooIgnoredFiles)}>
				Update Commands
			</button>
		</div>
	)
}

const ApiConfigTestComponent = () => {
	const { apiConfiguration, setApiConfiguration } = useExtensionState()

	return (
		<div>
			<div data-testid="api-configuration">{JSON.stringify(apiConfiguration)}</div>
			<button
				data-testid="update-api-config-button"
				onClick={() => setApiConfiguration({ apiModelId: "new-model", apiProvider: "anthropic" })}>
				Update API Config
			</button>
			<button data-testid="partial-update-button" onClick={() => setApiConfiguration({ modelTemperature: 0.7 })}>
				Partial Update
			</button>
		</div>
	)
}

describe("ExtensionStateContext", () => {
	it("initializes with empty allowedCommands array", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		expect(JSON.parse(screen.getByTestId("allowed-commands").textContent!)).toEqual([])
	})

	it("initializes with soundEnabled set to false", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		expect(JSON.parse(screen.getByTestId("sound-enabled").textContent!)).toBe(false)
	})

	it("initializes with showRooIgnoredFiles set to true", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		expect(JSON.parse(screen.getByTestId("show-rooignored-files").textContent!)).toBe(true)
	})

	it("initializes with autoApprovalEnabled set to true", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		expect(JSON.parse(screen.getByTestId("auto-approval-enabled").textContent!)).toBe(true)
	})

	it("initializes with alwaysAllowReadOnly set to true", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		expect(JSON.parse(screen.getByTestId("always-allow-read-only").textContent!)).toBe(true)
	})

	it("initializes with alwaysAllowWrite set to true", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		expect(JSON.parse(screen.getByTestId("always-allow-write").textContent!)).toBe(true)
	})

	it("updates showRooIgnoredFiles through setShowRooIgnoredFiles", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		act(() => {
			screen.getByTestId("toggle-rooignore-button").click()
		})

		expect(JSON.parse(screen.getByTestId("show-rooignored-files").textContent!)).toBe(false)
	})

	it("updates allowedCommands through setAllowedCommands", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		act(() => {
			screen.getByTestId("update-button").click()
		})

		expect(JSON.parse(screen.getByTestId("allowed-commands").textContent!)).toEqual(["npm install", "git status"])
	})

	it("throws error when used outside provider", () => {
		// Suppress console.error for this test since we expect an error
		const consoleSpy = vi.spyOn(console, "error")
		consoleSpy.mockImplementation(() => {})

		expect(() => {
			render(<TestComponent />)
		}).toThrow("useExtensionState must be used within an ExtensionStateContextProvider")

		consoleSpy.mockRestore()
	})

	it("updates apiConfiguration through setApiConfiguration", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiConfigTestComponent />
			</ExtensionStateContextProvider>,
		)

		const initialContent = screen.getByTestId("api-configuration").textContent!
		expect(initialContent).toBeDefined()

		act(() => {
			screen.getByTestId("update-api-config-button").click()
		})

		const updatedContent = screen.getByTestId("api-configuration").textContent!
		const updatedConfig = JSON.parse(updatedContent || "{}")

		expect(updatedConfig).toEqual(
			expect.objectContaining({
				apiModelId: "new-model",
				apiProvider: "anthropic",
			}),
		)
	})

	it("correctly merges partial updates to apiConfiguration", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiConfigTestComponent />
			</ExtensionStateContextProvider>,
		)

		// First set the initial configuration
		act(() => {
			screen.getByTestId("update-api-config-button").click()
		})

		// Verify initial update
		const initialContent = screen.getByTestId("api-configuration").textContent!
		const initialConfig = JSON.parse(initialContent || "{}")
		expect(initialConfig).toEqual(
			expect.objectContaining({
				apiModelId: "new-model",
				apiProvider: "anthropic",
			}),
		)

		// Now perform a partial update
		act(() => {
			screen.getByTestId("partial-update-button").click()
		})

		// Verify that the partial update was merged with the existing configuration
		const updatedContent = screen.getByTestId("api-configuration").textContent!
		const updatedConfig = JSON.parse(updatedContent || "{}")
		expect(updatedConfig).toEqual(
			expect.objectContaining({
				apiModelId: "new-model", // Should retain this from previous update
				apiProvider: "anthropic", // Should retain this from previous update
				modelTemperature: 0.7, // Should add this from partial update
			}),
		)
	})

	it("keeps the transcript when an incremental state post omits clineMessages", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "state",
						state: {
							apiConfiguration: { apiProvider: "anthropic" },
							clineMessages: [{ ts: 1, type: "say", say: "text", text: "keep-me" }],
						},
					},
				}),
			)
		})

		expect(JSON.parse(screen.getByTestId("cline-messages").textContent!)).toEqual([
			{ ts: 1, type: "say", say: "text", text: "keep-me" },
		])

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "state",
						state: {
							apiConfiguration: { apiProvider: "anthropic" },
							soundEnabled: true,
						},
					},
				}),
			)
		})

		expect(JSON.parse(screen.getByTestId("cline-messages").textContent!)).toEqual([
			{ ts: 1, type: "say", say: "text", text: "keep-me" },
		])
		expect(JSON.parse(screen.getByTestId("sound-enabled").textContent!)).toBe(true)
	})

	it("replaces the transcript when the host posts an empty clineMessages array", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "state",
						state: {
							apiConfiguration: { apiProvider: "anthropic" },
							clineMessages: [{ ts: 1, type: "say", say: "text", text: "keep-me" }],
						},
					},
				}),
			)
		})

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "state",
						state: {
							apiConfiguration: { apiProvider: "anthropic" },
							clineMessages: [],
						},
					},
				}),
			)
		})

		expect(JSON.parse(screen.getByTestId("cline-messages").textContent!)).toEqual([])
	})

	it("re-strips images when messageUpdated replaces an older row in place", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		const images = ["data:image/png;base64," + "A".repeat(64)]
		const rows = Array.from({ length: 30 }, (_, i) => ({
			ts: 50_000 + i,
			type: "say" as const,
			say: "text" as const,
			text: `img-${i}`,
			images,
		}))

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "state",
						state: {
							apiConfiguration: { apiProvider: "anthropic" },
							clineMessages: rows,
						},
					},
				}),
			)
		})

		const afterState = JSON.parse(screen.getByTestId("cline-messages").textContent!) as Array<{
			ts: number
			webviewImagesStripped?: boolean
			images?: unknown
		}>
		const stripped = afterState.filter((message) => message.webviewImagesStripped === true)
		expect(stripped.length).toBeGreaterThan(0)
		const targetTs = stripped[0]!.ts

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "messageUpdated",
						clineMessage: {
							ts: targetTs,
							type: "say",
							say: "text",
							text: "updated-old-image-row",
							images,
						},
					},
				}),
			)
		})

		const afterUpdate = JSON.parse(screen.getByTestId("cline-messages").textContent!) as Array<{
			ts: number
			text?: string
			webviewImagesStripped?: boolean
			images?: unknown
		}>
		const row = afterUpdate.find((message) => message.ts === targetTs)
		expect(row?.text).toBe("updated-old-image-row")
		expect(row?.images).toBeUndefined()
		expect(row?.webviewImagesStripped).toBe(true)
		expect(afterUpdate.filter((message) => message.images !== undefined).length).toBeLessThanOrEqual(24)
	})

	it("keeps resident images when messageUpdated omits an unchanged blob", () => {
		render(
			<ExtensionStateContextProvider>
				<TestComponent />
			</ExtensionStateContextProvider>,
		)

		const images = ["data:image/png;base64," + "A".repeat(64)]
		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "state",
						state: {
							apiConfiguration: { apiProvider: "anthropic" },
							clineMessages: [
								{
									ts: 1,
									type: "say",
									say: "user_feedback",
									text: "look",
									images,
								},
							],
						},
					},
				}),
			)
		})

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "messageUpdated",
						clineMessage: {
							ts: 1,
							type: "say",
							say: "user_feedback",
							text: "look-updated",
							webviewImagesOmitted: true,
						},
					},
				}),
			)
		})

		const afterUpdate = JSON.parse(screen.getByTestId("cline-messages").textContent!) as Array<{
			ts: number
			text?: string
			images?: unknown
			webviewImagesOmitted?: boolean
		}>
		expect(afterUpdate).toHaveLength(1)
		expect(afterUpdate[0]?.text).toBe("look-updated")
		expect(afterUpdate[0]?.images).toEqual(images)
		expect(afterUpdate[0]?.webviewImagesOmitted).toBeUndefined()
	})
})

describe("mergeExtensionState", () => {
	it("should correctly merge extension states", () => {
		const baseState: ExtensionState = {
			version: "",
			mcpEnabled: false,
			enableMcpServerCreation: false,
			clineMessages: [],
			taskHistoryFullLength: 0, // kilocode_change
			taskHistoryVersion: 0, // kilocode_change
			shouldShowAnnouncement: false,
			enableCheckpoints: true,
			writeDelayMs: 1000,
			mode: "default",
			experiments: {} as Record<ExperimentId, boolean>,
			customModes: [],
			maxOpenTabsContext: 20,
			maxWorkspaceFiles: 100,
			apiConfiguration: { providerId: "openrouter" } as ProviderSettings,
			telemetrySetting: "unset",
			showRooIgnoredFiles: true,
			enableSubfolderRules: false,
			renderContext: "sidebar",
			maxReadFileLine: 500,
			showAutoApproveMenu: false,
			cloudUserInfo: null,
			organizationAllowList: { allowAll: true, providers: {} },
			autoCondenseContext: true,
			autoCondenseContextPercent: 100,
			cloudIsAuthenticated: false,
			sharingEnabled: false,
			publicSharingEnabled: false,
			profileThresholds: {},
			hasOpenedModeSelector: false, // Add the new required property
			maxImageFileSize: 5,
			maxTotalImageSize: 20,
			kilocodeDefaultModel: openRouterDefaultModelId,
			remoteControlEnabled: false,
			taskSyncEnabled: false,
			featureRoomoteControlEnabled: false,
			isBrowserSessionActive: false,
			checkpointTimeout: DEFAULT_CHECKPOINT_TIMEOUT_SECONDS, // Add the checkpoint timeout property
		}

		const prevState: ExtensionState = {
			...baseState,
			apiConfiguration: { modelMaxTokens: 1234, modelMaxThinkingTokens: 123 },
			experiments: {} as Record<ExperimentId, boolean>,
			checkpointTimeout: DEFAULT_CHECKPOINT_TIMEOUT_SECONDS - 5,
		}

		const newState: ExtensionState = {
			...baseState,
			apiConfiguration: { modelMaxThinkingTokens: 456, modelTemperature: 0.3 },
			experiments: {
				powerSteering: true,
				multiFileApplyDiff: true,
				preventFocusDisruption: false,
				morphFastApply: false, // kilocode_change
				speechToText: false, // kilocode_change
				newTaskRequireTodos: false,
				imageGeneration: false,
				runSlashCommand: false,
				nativeToolCalling: false,
				multipleNativeToolCalls: false,
				customTools: false,
			} as Record<ExperimentId, boolean>,
			checkpointTimeout: DEFAULT_CHECKPOINT_TIMEOUT_SECONDS + 5,
		}

		const result = mergeExtensionState(prevState, newState)

		expect(result.apiConfiguration).toEqual({
			modelMaxThinkingTokens: 456,
			modelTemperature: 0.3,
		})

		expect(result.experiments).toEqual({
			powerSteering: true,
			multiFileApplyDiff: true,
			preventFocusDisruption: false,
			morphFastApply: false, // kilocode_change
			speechToText: false, // kilocode_change
			newTaskRequireTodos: false,
			imageGeneration: false,
			runSlashCommand: false,
			nativeToolCalling: false,
			multipleNativeToolCalls: false,
			customTools: false,
		})
	})
})
