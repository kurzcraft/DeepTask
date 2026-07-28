import { type GroqModelId, groqDefaultModelId, groqModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class GroqHandler extends BaseOpenAiCompatibleProvider<GroqModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Groq",
			baseURL: "https://api.groq.com/openai/v1",
			apiKey: options.groqApiKey,
			defaultProviderModelId: groqDefaultModelId,
			providerModels: groqModels,
			defaultTemperature: 0.5,
		})
	}

	override getModel() {
		const id = this.options.apiModelId || groqDefaultModelId
		const knownInfo = groqModels[id as GroqModelId]
		const staticInfo = knownInfo ?? { ...groqModels[groqDefaultModelId], contextWindow: 256_000 }
		const userInfo = this.options.apiModelInfoModelId === id ? this.options.apiModelInfo : undefined
		return { id, info: { ...staticInfo, ...userInfo } }
	}
}
