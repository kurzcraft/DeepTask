import { renderHook } from "@testing-library/react"
import type { ProviderSettings } from "@roo-code/types"

import { useProviderModels } from "../useProviderModels"
import { useRouterModels } from "@/components/ui/hooks/useRouterModels"
import { useExtensionState } from "@/context/ExtensionStateContext"

const { mockPostMessage } = vi.hoisted(() => ({
	mockPostMessage: vi.fn(),
}))

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: mockPostMessage,
	},
}))

vi.mock("@/components/ui/hooks/useRouterModels", () => ({
	useRouterModels: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

const mockUseRouterModels = vi.mocked(useRouterModels)
const mockUseExtensionState = vi.mocked(useExtensionState)

describe("useProviderModels", () => {
	beforeEach(() => {
		mockPostMessage.mockReset()
		mockUseRouterModels.mockReset()
		mockUseExtensionState.mockReset()
		mockUseRouterModels.mockReturnValue({
			data: undefined,
			isLoading: true,
			isError: true,
		} as unknown as ReturnType<typeof useRouterModels>)
		mockUseExtensionState.mockReturnValue({
			kilocodeDefaultModel: "default-model",
			dynamicProviderModels: {},
		} as unknown as ReturnType<typeof useExtensionState>)
	})

	it("seeds the configured OpenAI Compatible model and ignores router loading/error", () => {
		const apiConfiguration: ProviderSettings = {
			apiProvider: "openai",
			openAiBaseUrl: "https://api.example.com/v1",
			openAiApiKey: "test-key",
			openAiModelId: "gpt-6-astra",
		}

		const { result } = renderHook(() => useProviderModels(apiConfiguration))

		expect(result.current.provider).toBe("openai")
		expect(result.current.isLoading).toBe(false)
		expect(result.current.isError).toBe(false)
		expect(result.current.providerDefaultModel).toBe("gpt-6-astra")
		expect(result.current.providerModels).toHaveProperty("gpt-6-astra")
		expect(mockUseRouterModels).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({ enabled: false }),
		)
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "requestOpenAiModels",
			values: {
				baseUrl: "https://api.example.com/v1",
				apiKey: "test-key",
				openAiHeaders: {},
			},
		})
	})

	it("merges the remote OpenAI catalog on top of the seeded model", () => {
		mockUseExtensionState.mockReturnValue({
			kilocodeDefaultModel: "default-model",
			dynamicProviderModels: {
				openai: {
					"remote-model": {
						displayName: "Remote Model",
						contextWindow: 128000,
						supportsPromptCache: false,
					},
				},
			},
		} as unknown as ReturnType<typeof useExtensionState>)

		const apiConfiguration: ProviderSettings = {
			apiProvider: "openai-responses",
			openAiBaseUrl: "https://api.example.com/v1",
			openAiApiKey: "test-key",
			openAiModelId: "gpt-6-astra",
		}

		const { result } = renderHook(() => useProviderModels(apiConfiguration))

		expect(result.current.providerModels).toHaveProperty("gpt-6-astra")
		expect(result.current.providerModels).toHaveProperty("remote-model")
		expect(result.current.isLoading).toBe(false)
		expect(result.current.isError).toBe(false)
	})
})
