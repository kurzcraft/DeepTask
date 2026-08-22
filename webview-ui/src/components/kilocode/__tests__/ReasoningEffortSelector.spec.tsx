import { render, screen, fireEvent, within } from "@/utils/test-utils"
import { ReasoningEffortSelector } from "../chat/ReasoningEffortSelector"
import { vscode } from "@/utils/vscode"
import type { ModelInfo, ProviderSettings } from "@roo-code/types"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

const baseApiConfiguration: ProviderSettings = {
	apiProvider: "lmstudio",
	lmStudioModelId: "local-model",
}

describe("ReasoningEffortSelector", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	const renderSelector = (overrides?: {
		apiConfiguration?: Partial<ProviderSettings>
		modelInfo?: ModelInfo
		currentApiConfigName?: string
	}) =>
		render(
			<ReasoningEffortSelector
				currentApiConfigName={overrides?.currentApiConfigName ?? "default"}
				apiConfiguration={{ ...baseApiConfiguration, ...overrides?.apiConfiguration }}
				modelInfo={overrides?.modelInfo}
			/>,
		)

	const openDropdown = async () => {
		fireEvent.click(screen.getByTestId("dropdown-trigger"))
		return within(await screen.findByRole("dialog"))
	}

	const openAndSelect = async (optionText: string) => {
		const popover = await openDropdown()
		fireEvent.click(popover.getByText(optionText))
	}

	test("renders off plus all effort levels when the model capability is unknown", async () => {
		renderSelector()

		const popover = await openDropdown()
		expect(popover.getByText("settings:providers.reasoningEffort.off")).toBeInTheDocument()

		for (const level of ["low", "medium", "high", "xhigh"]) {
			expect(popover.getByText(`settings:providers.reasoningEffort.${level}`)).toBeInTheDocument()
		}
	})

	test("shows exactly the capability array values plus off", async () => {
		renderSelector({
			modelInfo: {
				contextWindow: 100_000,
				supportsPromptCache: true,
				supportsReasoningEffort: ["low", "medium", "high"],
			},
		})

		const popover = await openDropdown()
		expect(popover.getByText("settings:providers.reasoningEffort.off")).toBeInTheDocument()
		expect(popover.getByText("settings:providers.reasoningEffort.low")).toBeInTheDocument()
		expect(popover.getByText("settings:providers.reasoningEffort.medium")).toBeInTheDocument()
		expect(popover.getByText("settings:providers.reasoningEffort.high")).toBeInTheDocument()
		expect(popover.queryByText("settings:providers.reasoningEffort.xhigh")).not.toBeInTheDocument()
	})

	test("omits off when the model requires reasoning effort", async () => {
		renderSelector({
			modelInfo: {
				contextWindow: 100_000,
				supportsPromptCache: true,
				supportsReasoningEffort: ["low", "medium", "high"],
				requiredReasoningEffort: true,
				reasoningEffort: "medium",
			},
		})

		const popover = await openDropdown()
		expect(popover.getByText("settings:providers.reasoningEffort.medium")).toBeInTheDocument()
		expect(popover.queryByText("settings:providers.reasoningEffort.off")).not.toBeInTheDocument()
	})

	test("sends upsertApiConfiguration enabling reasoning when a level is selected", async () => {
		renderSelector()

		await openAndSelect("settings:providers.reasoningEffort.high")

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "upsertApiConfiguration",
			text: "default",
			apiConfiguration: {
				...baseApiConfiguration,
				enableReasoningEffort: true,
				reasoningEffort: "high",
			},
		})
	})

	test("sends upsertApiConfiguration disabling reasoning when off is selected", async () => {
		renderSelector({ apiConfiguration: { reasoningEffort: "high" } })

		await openAndSelect("settings:providers.reasoningEffort.off")

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "upsertApiConfiguration",
			text: "default",
			apiConfiguration: {
				...baseApiConfiguration,
				reasoningEffort: "disable",
				enableReasoningEffort: false,
			},
		})
	})

	test("does not resend when the selection is unchanged", async () => {
		renderSelector({ apiConfiguration: { reasoningEffort: "high", enableReasoningEffort: true } })

		await openAndSelect("settings:providers.reasoningEffort.high")

		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	test("renders nothing for autocomplete profiles and virtual quota fallback", () => {
		const { container: autocompleteContainer } = renderSelector({
			apiConfiguration: { profileType: "autocomplete" },
		})
		expect(autocompleteContainer).toBeEmptyDOMElement()

		const { container: fallbackContainer } = renderSelector({
			apiConfiguration: { apiProvider: "virtual-quota-fallback" },
		})
		expect(fallbackContainer).toBeEmptyDOMElement()
	})
})
