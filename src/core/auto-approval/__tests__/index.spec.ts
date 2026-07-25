// kilocode_change - new file
import type { ExtensionState } from "@roo-code/types"

import { checkAutoApproval } from "../index"

describe("checkAutoApproval", () => {
	it("approves commands when allowedCommands contains wildcard even if alwaysAllowExecute is disabled", async () => {
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

		expect(result).toEqual({ decision: "approve" })
	})

	it("keeps denylist precedence when wildcard command auto-approval is enabled", async () => {
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

		expect(result).toEqual({ decision: "deny" })
	})
})
