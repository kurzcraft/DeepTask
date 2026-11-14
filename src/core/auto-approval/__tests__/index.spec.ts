// kilocode_change - new file
import type { ExtensionState } from "@roo-code/types"

import { checkAutoApproval } from "../index"

describe("checkAutoApproval", () => {
	it("asks for approval when Execute is disabled even if allowedCommands contains wildcard", async () => {
		const result = await checkAutoApproval({
			state: {
				autoApprovalEnabled: true,
				alwaysAllowExecute: false,
				allowedCommands: ["*"],
				deniedCommands: [],
			} as unknown as ExtensionState,
			ask: "command",
			text: "echo test",
		})

		expect(result).toEqual({ decision: "ask" })
	})

	it("returns command decisions to manual approval when Execute is disabled", async () => {
		const result = await checkAutoApproval({
			state: {
				autoApprovalEnabled: true,
				alwaysAllowExecute: false,
				allowedCommands: ["*"],
				deniedCommands: ["rm"],
			} as unknown as ExtensionState,
			ask: "command",
			text: "rm file.txt",
		})

		expect(result).toEqual({ decision: "ask" })
	})

	it("approves wildcard commands when Execute is enabled", async () => {
		const result = await checkAutoApproval({
			state: {
				autoApprovalEnabled: true,
				alwaysAllowExecute: true,
				allowedCommands: ["*"],
				deniedCommands: [],
			} as unknown as ExtensionState,
			ask: "command",
			text: "echo test",
		})

		expect(result).toEqual({ decision: "approve" })
	})

	it("keeps denylist precedence when wildcard command auto-approval is enabled", async () => {
		const result = await checkAutoApproval({
			state: {
				autoApprovalEnabled: true,
				alwaysAllowExecute: true,
				allowedCommands: ["*"],
				deniedCommands: ["rm"],
			} as unknown as ExtensionState,
			ask: "command",
			text: "rm file.txt",
		})

		expect(result).toEqual({ decision: "deny" })
	})

	it("approves provider profile switches when their dedicated toggle is enabled", async () => {
		const result = await checkAutoApproval({
			state: {
				autoApprovalEnabled: true,
				alwaysAllowProviderProfileSwitch: true,
			} as unknown as ExtensionState,
			ask: "tool",
			text: JSON.stringify({ tool: "switchProviderProfile", profileName: "deepseek", modelId: null }),
		})

		expect(result).toEqual({ decision: "approve" })
	})

	it("asks before provider profile switches when their dedicated toggle is disabled", async () => {
		const result = await checkAutoApproval({
			state: {
				autoApprovalEnabled: true,
				alwaysAllowProviderProfileSwitch: false,
			} as unknown as ExtensionState,
			ask: "tool",
			text: JSON.stringify({ tool: "switchProviderProfile", profileName: "deepseek", modelId: null }),
		})

		expect(result).toEqual({ decision: "ask" })
	})

	it("approves manage_provider_profile actions (set_reasoning/update/create/rename) with the provider-profile toggle", async () => {
		const result = await checkAutoApproval({
			state: {
				autoApprovalEnabled: true,
				alwaysAllowProviderProfileSwitch: true,
			} as unknown as ExtensionState,
			ask: "tool",
			text: JSON.stringify({
				tool: "manageProviderProfile",
				action: "set_reasoning",
				profile: "deepseek",
				reasoningEffort: "medium",
			}),
		})

		expect(result).toEqual({ decision: "approve" })
	})

	it("asks before manage_provider_profile actions when the provider-profile toggle is disabled", async () => {
		const result = await checkAutoApproval({
			state: {
				autoApprovalEnabled: true,
				alwaysAllowProviderProfileSwitch: false,
			} as unknown as ExtensionState,
			ask: "tool",
			text: JSON.stringify({
				tool: "manageProviderProfile",
				action: "set_reasoning",
				profile: "deepseek",
				reasoningEffort: "medium",
			}),
		})

		expect(result).toEqual({ decision: "ask" })
	})

	it("auto-approves follow-up answers without switching mode or provider", async () => {
		const result = await checkAutoApproval({
			state: {
				autoApprovalEnabled: true,
				alwaysAllowFollowupQuestions: true,
				followupAutoApproveTimeoutMs: 1_000,
			} as unknown as ExtensionState,
			ask: "followup",
			text: JSON.stringify({
				question: "Would you like me to implement this feature?",
				suggest: [
					{ answer: "Yes, implement it now", mode: "code" },
					{ answer: "No, just plan it out", mode: "architect" },
				],
			}),
		})

		expect(result.decision).toBe("timeout")
		if (result.decision !== "timeout") {
			throw new Error("expected follow-up auto-approval timeout")
		}
		expect(result.timeout).toBe(1_000)
		expect(result.fn()).toEqual({
			askResponse: "messageResponse",
			text: "Yes, implement it now",
		})
	})
})
