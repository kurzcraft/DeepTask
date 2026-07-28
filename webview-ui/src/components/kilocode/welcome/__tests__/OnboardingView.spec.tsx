// kilocode_change - new file
// pnpm test src/components/kilocode/welcome/__tests__/OnboardingView.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"
import OnboardingView from "../OnboardingView"

vi.mock("../../common/Logo", () => ({
	default: () => <div data-testid="deeptask-logo">Deeptask Logo</div>,
}))

describe("OnboardingView", () => {
	const onConfigureProvider = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders Deeptask onboarding", () => {
		render(<OnboardingView onConfigureProvider={onConfigureProvider} />)

		expect(screen.getByTestId("deeptask-logo")).toBeInTheDocument()
		expect(screen.getByText("kilocode:onboarding.title")).toBeInTheDocument()
	})

	it("only presents the user-configured provider option", () => {
		render(<OnboardingView onConfigureProvider={onConfigureProvider} />)

		expect(screen.getByText("kilocode:onboarding.byok.title")).toBeInTheDocument()
		expect(screen.getByText("kilocode:onboarding.byok.description")).toBeInTheDocument()
		expect(screen.queryByText("kilocode:onboarding.freeModels.title")).not.toBeInTheDocument()
		expect(screen.queryByText("kilocode:onboarding.premiumModels.title")).not.toBeInTheDocument()
	})

	it("opens provider configuration", () => {
		render(<OnboardingView onConfigureProvider={onConfigureProvider} />)

		fireEvent.click(screen.getByText("kilocode:onboarding.byok.title").closest("button")!)

		expect(onConfigureProvider).toHaveBeenCalledTimes(1)
	})
})
