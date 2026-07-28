import { buildDocLink } from "../docLinks"

const USER_GUIDE_URL = "https://github.com/kurzcraft/DeepTask/blob/main/docs/deeptask/guides/USER_GUIDE.md"

describe("buildDocLink", () => {
	it("routes documentation links to the published Deeptask user guide", () => {
		expect(buildDocLink("features/skills", "settings")).toBe(USER_GUIDE_URL)
	})

	it("preserves section anchors without generating an invalid repository docs route", () => {
		const url = buildDocLink("troubleshooting/shell-integration/#terminal-limit", "error")

		expect(url).toBe(`${USER_GUIDE_URL}#terminal-limit`)
		expect(url).not.toContain("github.com/kurzcraft/DeepTask/docs/")
	})
})
