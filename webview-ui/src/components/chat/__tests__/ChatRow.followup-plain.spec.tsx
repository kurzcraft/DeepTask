import React from "react"

import { render, screen } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("../Markdown", () => ({
	Markdown: ({ markdown, plain }: { markdown?: string; plain?: boolean }) => (
		<div data-testid="followup-markdown" data-plain={plain ? "true" : "false"}>
			{markdown}
		</div>
	),
}))

const queryClient = new QueryClient()

const followupMessage = {
	type: "ask" as const,
	ask: "followup" as const,
	ts: Date.now(),
	partial: false,
	text: JSON.stringify({
		question: "Would you like me to implement this feature?",
		suggest: [{ answer: "Yes, implement it now" }, { answer: "No, just plan it out" }],
	}),
}

function renderFollowup(isLast: boolean) {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatRowContent
					message={followupMessage}
					isExpanded={false}
					isLast={isLast}
					isStreaming={false}
					onToggleExpand={() => {}}
					onSuggestionClick={() => {}}
					onBatchFileResponse={() => {}}
					onFollowUpUnmount={() => {}}
					isFollowUpAnswered={!isLast}
				/>
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("ChatRow - historical followup uses plain markdown", () => {
	it("renders historical followup questions as plain text", () => {
		renderFollowup(false)
		const markdown = screen.getByTestId("followup-markdown")
		expect(markdown).toHaveAttribute("data-plain", "true")
		expect(markdown).toHaveTextContent("Would you like me to implement this feature?")
	})

	it("keeps the latest followup question on the markdown renderer", () => {
		renderFollowup(true)
		const markdown = screen.getByTestId("followup-markdown")
		expect(markdown).toHaveAttribute("data-plain", "false")
		expect(markdown).toHaveTextContent("Would you like me to implement this feature?")
	})
})
