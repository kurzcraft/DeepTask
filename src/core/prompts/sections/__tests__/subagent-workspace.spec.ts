// kilocode_change - new file
import { SUBAGENT_DEPENDENCY_REUSE_INSTRUCTIONS } from "../subagent-workspace"
import { getDispatchSubagentsDescription } from "../../tools/parallel"
import nativeDispatch from "../../tools/native-tools/dispatch-subagents"

describe("subagent dependency reuse policy", () => {
	it("keeps native and XML dispatch instructions identical", () => {
		expect(getDispatchSubagentsDescription(true)).toContain(SUBAGENT_DEPENDENCY_REUSE_INSTRUCTIONS)
		expect(nativeDispatch.function.description).toContain(SUBAGENT_DEPENDENCY_REUSE_INSTRUCTIONS)
		expect(getDispatchSubagentsDescription(false)).toBeUndefined()
	})
	it("requires compatibility, isolated writes, and local fallback", () => {
		for (const text of [
			"manifest/lockfile",
			"assigned workspace",
			"not the main checkout",
			"Never install, prune or rebuild",
			"workspace-local environment",
			"not a guarantee",
		]) {
			expect(SUBAGENT_DEPENDENCY_REUSE_INSTRUCTIONS).toContain(text)
		}
	})
})
