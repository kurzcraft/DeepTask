import { getSwitchProviderProfileDescription } from "../switch-provider-profile"

describe("getSwitchProviderProfileDescription", () => {
	it("lists live profile names and models for XML tool use", () => {
		const description = getSwitchProviderProfileDescription([
			{
				id: "deepseek-id",
				name: "DeepSeek",
				apiProvider: "deepseek",
				modelId: "deepseek-v4-pro",
			},
			{
				id: "custom-id",
				name: "User-created",
				apiProvider: "openai",
				modelId: "custom-model",
			},
		])

		expect(description).toContain("- DeepSeek: deepseek-v4-pro")
		expect(description).toContain("- User-created: custom-model")
		expect(description).toContain("omit model_id so the target profile keeps its saved model")
		expect(description).toContain("Never guess a model ID")
		expect(description).not.toContain("<model_id>Optional model ID here</model_id>")
		expect(description).not.toContain("apiKey")
		expect(description).not.toContain("baseUrl")
	})
})
