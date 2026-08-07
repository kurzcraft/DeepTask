import type OpenAI from "openai"

import { getNativeTools } from "../index"
import { createSwitchProviderProfileTool } from "../switch_provider_profile"

type FunctionTool = OpenAI.Chat.ChatCompletionTool & { type: "function" }

const getFunctionDef = (tool: OpenAI.Chat.ChatCompletionTool) => (tool as FunctionTool).function

describe("createSwitchProviderProfileTool", () => {
	it("exposes request-scoped profiles and keeps model selection optional", () => {
		const tool = createSwitchProviderProfileTool({
			profiles: [
				{ name: "DeepSeek", modelId: "deepseek-v4-pro" },
				{ name: "User-created", modelId: "custom-model" },
			],
		})
		const definition = getFunctionDef(tool)
		const schema = definition.parameters as {
			properties: {
				profile_name: { enum?: string[] }
				model_id: { type: string[]; description: string }
			}
			required: string[]
		}

		expect(schema.properties.profile_name.enum).toEqual(["DeepSeek", "User-created"])
		expect(schema.properties.model_id.type).toEqual(["string", "null"])
		expect(schema.required).toEqual(["profile_name", "model_id", "reason"])
		expect(definition.description).toContain("DeepSeek: deepseek-v4-pro")
		expect(definition.description).toContain("User-created: custom-model")
		expect(definition.description).toContain("always set model_id to null")
		expect(definition.description).toContain("Never guess a model ID")
		expect(schema.properties.model_id.description).toContain("never guess or copy one from another profile")
	})

	it("omits the tool definition when provider-profile switching is disabled", () => {
		const toolNames = getNativeTools({ providerProfileSwitchEnabled: false }).map(
			(tool) => getFunctionDef(tool).name,
		)

		expect(toolNames).not.toContain("switch_provider_profile")
	})

	it("includes the tool definition by default", () => {
		const toolNames = getNativeTools().map((tool) => getFunctionDef(tool).name)

		expect(toolNames).toContain("switch_provider_profile")
	})
})
