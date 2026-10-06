// kilocode_change - new file
import type { ComponentProps, ReactNode } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"

import type { ProviderSettings } from "@roo-code/types"

import { DynamicVendorModelSettings } from "../DynamicVendorModelSettings"

const { refetchMock, useRouterModelsMock } = vi.hoisted(() => ({
	refetchMock: vi.fn(),
	useRouterModelsMock: vi.fn(),
}))

vi.mock("@src/components/ui/hooks/useRouterModels", () => ({
	useRouterModels: useRouterModelsMock,
}))

vi.mock("../../ModelPicker", () => ({
	ModelPicker: ({ models, setApiConfigurationField }: any) => (
		<div>
			{Object.keys(models).map((modelId) => (
				<button
					key={modelId}
					data-testid={`vendor-model-option-${modelId}`}
					onClick={() => setApiConfigurationField("apiModelId", modelId)}>
					{modelId}
				</button>
			))}
		</div>
	),
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ children, ...props }: ComponentProps<"input"> & { children?: ReactNode }) => (
		<div>
			{children}
			<input data-testid="context-window-input" {...props} />
		</div>
	),
}))

const staticModels = {
	"default-model": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
	},
}

const renderSettings = (
	apiConfiguration: ProviderSettings,
	setApiConfigurationField = vi.fn(),
	apiKey = "unsaved-subscription-key",
) => {
	render(
		<DynamicVendorModelSettings
			provider="deepseek"
			defaultModelId="default-model"
			staticModels={staticModels}
			apiKey={apiKey}
			baseUrl="https://subscription.example/v1"
			apiConfiguration={apiConfiguration}
			setApiConfigurationField={setApiConfigurationField}
		/>,
	)
	return setApiConfigurationField
}

describe("DynamicVendorModelSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		useRouterModelsMock.mockReturnValue({
			data: undefined,
			refetch: refetchMock,
			isFetching: false,
			isError: false,
		})
	})

	afterEach(() => {
		vi.runOnlyPendingTimers()
		vi.useRealTimers()
	})

	it("renders detected models as selectable options alongside bundled models", () => {
		useRouterModelsMock.mockReturnValue({
			data: {
				deepseek: {
					"subscription-coding-model": {
						contextWindow: 262_144,
						supportsPromptCache: false,
					},
				},
			},
			refetch: refetchMock,
			isFetching: false,
			isError: false,
		})
		const setApiConfigurationField = renderSettings({ apiProvider: "deepseek" })

		expect(screen.getByTestId("vendor-model-option-default-model")).toBeInTheDocument()
		fireEvent.click(screen.getByTestId("vendor-model-option-subscription-coding-model"))

		expect(setApiConfigurationField).toHaveBeenCalledWith("apiModelId", "subscription-coding-model")
		expect(screen.getByTestId("vendor-model-status")).toHaveTextContent(
			"settings:providers.sapAiCore.modelsCount",
		)
	})

	it("runs anonymous discovery on mount and upgrades to authenticated after the key debounce", () => {
		renderSettings({ apiProvider: "deepseek", apiModelId: "default-model" })

		// kilocode_change (defect T, 9.2.8): no enabled gate — discovery fires
		// immediately on mount (anonymous /models), key still empty pre-debounce.
		expect(useRouterModelsMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ deepSeekApiKey: "" }),
			{ provider: "deepseek" },
		)

		act(() => vi.advanceTimersByTime(500))

		expect(useRouterModelsMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				deepSeekApiKey: "unsaved-subscription-key",
				deepSeekBaseUrl: "https://subscription.example/v1",
			}),
			{ provider: "deepseek" },
		)
	})

	it("automatically binds detected context metadata to the selected model", () => {
		useRouterModelsMock.mockReturnValue({
			data: {
				deepseek: {
					"subscription-coding-model": {
						maxTokens: 32_768,
						contextWindow: 262_144,
						supportsImages: false,
						supportsPromptCache: false,
					},
				},
			},
			refetch: refetchMock,
			isFetching: false,
			isError: false,
		})
		const setApiConfigurationField = renderSettings({
			apiProvider: "deepseek",
			apiModelId: "subscription-coding-model",
		})

		act(() => vi.advanceTimersByTime(500))

		expect(screen.getByTestId("context-window-input")).toHaveValue("262144")
		expect(setApiConfigurationField).toHaveBeenCalledWith(
			"apiModelInfo",
			expect.objectContaining({ contextWindow: 262_144, maxTokens: 32_768 }),
			false,
		)
		expect(setApiConfigurationField).toHaveBeenCalledWith("apiModelInfoSource", "detected", false)
	})

	it("automatically fills the 256000 safety context when discovery has no metadata", () => {
		const setApiConfigurationField = renderSettings({
			apiProvider: "deepseek",
			apiModelId: "unlisted-subscription-model",
		})

		act(() => vi.advanceTimersByTime(500))

		expect(screen.getByTestId("context-window-input")).toHaveValue("256000")
		expect(setApiConfigurationField).toHaveBeenCalledWith(
			"apiModelInfo",
			{ contextWindow: 256_000 },
			false,
		)
	})

	it("keeps a manual context override above later detected metadata", () => {
		useRouterModelsMock.mockReturnValue({
			data: {
				deepseek: {
					"subscription-coding-model": {
						contextWindow: 262_144,
						supportsPromptCache: false,
					},
				},
			},
			refetch: refetchMock,
			isFetching: false,
			isError: false,
		})
		const setApiConfigurationField = renderSettings({
			apiProvider: "deepseek",
			apiModelId: "subscription-coding-model",
			apiModelInfoModelId: "subscription-coding-model",
			apiModelInfo: { contextWindow: 300_000 },
			apiModelInfoSource: "manual",
		})

		act(() => vi.advanceTimersByTime(500))

		expect(screen.getByTestId("context-window-input")).toHaveValue("300000")
		expect(setApiConfigurationField).not.toHaveBeenCalled()
	})

	it("shows discovery failure when an authenticated refresh returns no remote models", () => {
		useRouterModelsMock.mockReturnValue({
			data: { deepseek: {} },
			refetch: refetchMock,
			isFetching: false,
			isError: false,
		})
		renderSettings({ apiProvider: "deepseek" })

		act(() => vi.advanceTimersByTime(500))

		expect(screen.getByTestId("vendor-model-status")).toHaveTextContent(
			"settings:providers.sapAiCore.noModelsFound",
		)
	})

	// kilocode_change (defect U, 9.2.8): default model auto-tracks the newest
	// detected release; a manual user pick is respected; no downgrades.
	it("auto-applies the newest detected model when the stored id is unset or the static default", () => {
		useRouterModelsMock.mockReturnValue({
			data: {
				deepseek: {
					"deepseek-chat": { contextWindow: 128_000 },
					"deepseek-v4.1-flash": { contextWindow: 1_000_000 },
					"deepseek-v4.2": { contextWindow: 1_000_000 },
				},
			},
			refetch: refetchMock,
			isFetching: false,
			isError: false,
		})
		const setApiConfigurationField = renderSettings({ apiProvider: "deepseek" })

		act(() => vi.advanceTimersByTime(500))

		// v4.2 (segments 4.2) beats v4.1-flash (4.1) and the digit-less alias.
		expect(setApiConfigurationField).toHaveBeenCalledWith("apiModelId", "deepseek-v4.2", false)
	})

	it("never auto-downgrades away from a user-pinned model", () => {
		useRouterModelsMock.mockReturnValue({
			data: {
				deepseek: {
					"deepseek-v4.1-flash": { contextWindow: 1_000_000 },
				},
			},
			refetch: refetchMock,
			isFetching: false,
			isError: false,
		})
		const setApiConfigurationField = renderSettings({
			apiProvider: "deepseek",
			apiModelId: "deepseek-reasoner-r2", // user's manual choice, newer by version
		})

		act(() => vi.advanceTimersByTime(500))

		expect(setApiConfigurationField).not.toHaveBeenCalledWith("apiModelId", expect.anything(), expect.anything())
	})
})
