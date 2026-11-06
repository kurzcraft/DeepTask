// npx vitest core/condense/__tests__/provider-condense-input.spec.ts

import { buildProviderCondenseInput } from "../index"
import type { ApiMessage } from "../../task-persistence/apiMessages"
import Anthropic from "@anthropic-ai/sdk"

function toolResultUser(index: number, chars: number): ApiMessage {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: `toolu_${index}`,
				content: `evidence-${index}-${"x".repeat(chars)}`,
			} as Anthropic.ToolResultBlockParam,
		],
		ts: index,
	}
}

describe("buildProviderCondenseInput", () => {
	it("bounds the automatic-condense request and always keeps the first message and newest real user instruction", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Initial task: fix condense progress loss", ts: 1 },
			...Array.from({ length: 120 }, (_, index) => toolResultUser(index + 2, 900)),
			...Array.from({ length: 60 }, (_, index) => ({
				role: "assistant" as const,
				content: `assistant evidence ${index} ${"y".repeat(1_500)}`,
				ts: 200 + index,
			})),
			{ role: "user", content: "Newest instruction: verify pre-condense progress survives", ts: 999 },
		]

		const bounded = buildProviderCondenseInput(messages)
		const totalChars = bounded.reduce((total, message) => total + String(message.content).length, 0)

		// 48k char budget (PROVIDER_CONDENSE_INPUT_MAX_CHARS) + per-message joins
		expect(totalChars).toBeLessThanOrEqual(48_000 + 200 * bounded.length)
		const serialized = JSON.stringify(bounded)
		expect(serialized).toContain("Initial task: fix condense progress loss")
		expect(serialized).toContain("Newest instruction: verify pre-condense progress survives")
		// Newest-first fill: the newest tool evidence survives, the oldest is dropped
		expect(serialized).toContain("evidence-121-")
		expect(serialized).not.toContain("evidence-3-")
	})

	it("compacts each message with the provider per-message cap instead of dumping raw transcripts", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Initial task", ts: 1 },
			{
				role: "assistant",
				content: `huge raw transcript ${"z".repeat(20_000)}`,
				ts: 2,
			},
			{ role: "user", content: "Newest instruction", ts: 3 },
		]

		const bounded = buildProviderCondenseInput(messages)
		const huge = bounded.find((message) => String(message.content).includes("huge raw transcript"))
		expect(huge).toBeDefined()
		// PROVIDER_CONDENSE_MESSAGE_MAX_CHARS = 1_200
		expect(String(huge?.content).length).toBeLessThanOrEqual(1_200)
	})

	it("preserves original message order in the bounded request", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "first", ts: 1 },
			{ role: "assistant", content: "middle", ts: 2 },
			{ role: "user", content: "last instruction", ts: 3 },
		]

		const bounded = buildProviderCondenseInput(messages)
		expect(bounded.map((message) => message.role)).toEqual(["user", "assistant", "user"])
		expect(bounded.map((message) => String(message.content))).toEqual(["first", "middle", "last instruction"])
	})

	it("returns an empty array for empty input", () => {
		expect(buildProviderCondenseInput([])).toEqual([])
	})
})
