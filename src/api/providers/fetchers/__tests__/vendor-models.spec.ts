// kilocode_change - new file
import axios from "axios"

import { getVendorModels } from "../vendor-models"

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
  },
}))

describe("getVendorModels", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("fetches the current DeepSeek directory with bearer authentication", async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }],
      },
    })

    const models = await getVendorModels("deepseek", " secret-key ")

    expect(axios.get).toHaveBeenCalledWith("https://api.deepseek.com/models", {
      headers: { Authorization: "Bearer secret-key" },
      timeout: 10_000,
    })
    expect(Object.keys(models)).toEqual(["deepseek-v4-pro", "deepseek-v4-flash"])
    expect(models["deepseek-v4-pro"]).toEqual(
      expect.objectContaining({
        contextWindow: 128_000,
        maxTokens: 8192,
        supportsNativeTools: true,
        defaultToolProtocol: "native",
      }),
    )
  })

  it("uses vendor metadata while preserving safe defaults", async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: [
        {
          id: "mistral-new",
          max_context_length: 262_144,
          capabilities: { vision: true, function_calling: true },
        },
      ],
    })

    const models = await getVendorModels("mistral", "key")

    expect(axios.get).toHaveBeenCalledWith("https://api.mistral.ai/v1/models", expect.any(Object))
    expect(models["mistral-new"]).toEqual(
      expect.objectContaining({
        contextWindow: 262_144,
        supportsImages: true,
        supportsNativeTools: true,
        supportsPromptCache: false,
      }),
    )
  })

  it("normalizes a custom DeepSeek base URL", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { data: [] } })

    await getVendorModels("deepseek", "key", " https://relay.example/v1/ ")

    expect(axios.get).toHaveBeenCalledWith("https://relay.example/v1/models", expect.any(Object))
  })

  it("rejects missing credentials without making a network request", async () => {
    await expect(getVendorModels("groq", "  ")).rejects.toThrow("groq API key is required")
    expect(axios.get).not.toHaveBeenCalled()
  })
})
