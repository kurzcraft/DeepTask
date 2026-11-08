// kilocode_change - new file
import { describe, expect, it, vi } from "vitest"

vi.mock("vscode", () => ({
	window: {},
	workspace: {},
}))

vi.mock("../../../../utils/globalContext", () => ({
	ensureSettingsDirectoryExists: vi.fn(async () => "/tmp/deeptask-modes-section-test"),
}))

vi.mock("../../../../shared/modes", () => ({
	getAllModesWithPrompts: vi.fn(),
}))

import { getAllModesWithPrompts } from "../../../../shared/modes"
import { getModesSection } from "../modes"

describe("getModesSection", () => {
	it("omits historical evolve copies and points at the evolution log", async () => {
		vi.mocked(getAllModesWithPrompts).mockResolvedValue([
			{
				slug: "code",
				name: "Code",
				roleDefinition: "You are a software engineer.",
				whenToUse: "Write and modify code.",
				groups: ["read", "edit"],
			},
			{
				slug: "evolve-16",
				name: "Evolve-16",
				roleDefinition: "Historical evolve copy.",
				whenToUse: "Old evolve copy.",
				groups: ["read", "edit"],
			},
			{
				slug: "evolve-17",
				name: "Evolve-17",
				roleDefinition: "Newest evolve copy.",
				whenToUse: "Default self-improving mode.",
				groups: ["read", "edit"],
			},
		] as any)

		const section = await getModesSection({} as any, true)

		expect(section).toContain('"Code" (code)')
		expect(section).toContain('"Evolve-17" (evolve-17)')
		expect(section).not.toContain("evolve-16")
		expect(section).toContain("~/.deeptask/PROMPT_EVOLUTION_LOG.md")
	})
})
