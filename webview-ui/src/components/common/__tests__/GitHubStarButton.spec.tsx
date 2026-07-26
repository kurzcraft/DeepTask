// kilocode_change - new file
import { fireEvent, render, screen } from "@/utils/test-utils"

import { vscode } from "@/utils/vscode"

import { DEEPTASK_GITHUB_URL, GitHubStarButton } from "../GitHubStarButton"

vi.mock("@/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

describe("GitHubStarButton", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders a prominent and accessible GitHub Star action", () => {
		render(<GitHubStarButton />)

		const button = screen.getByRole("button", { name: "Star Deeptask on GitHub" })
		expect(button).toBeInTheDocument()
		expect(button).toHaveTextContent("Star Deeptask on GitHub")
		expect(button).toHaveAttribute("title", "Open Deeptask on GitHub and click Star")
	})

	it("opens the canonical Deeptask repository through the extension host", () => {
		render(<GitHubStarButton />)

		fireEvent.click(screen.getByTestId("github-star-button"))

		expect(vscode.postMessage).toHaveBeenCalledTimes(1)
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "openExternal",
			url: DEEPTASK_GITHUB_URL,
		})
	})
})
