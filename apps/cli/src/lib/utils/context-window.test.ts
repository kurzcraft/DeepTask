import type { ProviderSettings } from "@roo-code/types"

import { DEFAULT_CONTEXT_WINDOW, getContextWindow } from "./context-window.js"

describe("getContextWindow", () => {
  it("uses the 256000 safety fallback when model data is unavailable", () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(256_000)
    expect(getContextWindow(null, null)).toBe(256_000)
    expect(getContextWindow({}, { apiProvider: "deepseek" } as ProviderSettings)).toBe(256_000)
  })

  it("uses detected metadata for the selected model", () => {
    const routerModels = {
      deepseek: {
        "detected-model": {
          contextWindow: 320_000,
          maxTokens: 32_000,
          supportsImages: false,
          supportsPromptCache: false,
        },
      },
    }
    const apiConfiguration = {
      apiProvider: "deepseek",
      apiModelId: "detected-model",
    } as ProviderSettings

    expect(getContextWindow(routerModels, apiConfiguration)).toBe(320_000)
  })
})
