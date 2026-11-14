// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/ChatView.followup-no-mode-switch.spec.tsx

import React from "react"
import { render, waitFor, fireEvent } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import ChatView, { ChatViewProps } from "../ChatView"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => [vi.fn()]),
}))

vi.mock("../BrowserSessionRow", () => ({
	default: () => null,
}))

vi.mock("../ChatRow", () => ({
	default: function MockChatRow({
		message,
		onSuggestionClick,
	}: {
		message: { ask?: string; text?: string }
		onSuggestionClick?: (suggestion: { answer: string; mode?: string }, event?: React.MouseEvent) => void
	}) {
		let suggestions: Array<{ answer: string; mode?: string }> = []
		if (message?.ask === "followup") {
			try {
				suggestions = JSON.parse(message.text || "{}").suggest || []
			} catch {
				suggestions = []
			}
		}

		return (
			<div data-testid="chat-row">
				{suggestions.map((suggestion, index) => (
					<button
						key={`${suggestion.answer}-${index}`}
						data-testid={`followup-suggest-${index}`}
						onClick={(event) => onSuggestionClick?.(suggestion, event)}>
						{suggestion.answer}
					</button>
				))}
			</div>
		)
	},
}))

vi.mock("../AutoApproveMenu", () => ({
	default: () => null,
}))

vi.mock("../../common/VersionIndicator", () => ({
	default: () => null,
}))

vi.mock("@src/components/modals/Announcement", () => ({
	default: () => null,
}))

vi.mock("@src/components/welcome/RooCloudCTA", () => ({
	default: () => null,
}))

vi.mock("@src/components/welcome/RooTips", () => ({
	default: () => null,
}))

vi.mock("@src/components/welcome/RooHero", () => ({
	default: () => null,
}))

vi.mock("../common/TelemetryBanner", () => ({
	default: () => null,
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en" },
	}),
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en" },
	}),
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
	Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
}))

vi.mock("react-virtuoso", () => ({
	Virtuoso: React.forwardRef(function MockVirtuoso(
		{
			data,
			itemContent,
			className,
		}: {
			data: Array<{ ts: number }>
			itemContent: (index: number, item: { ts: number }) => React.ReactNode
			className?: string
		},
		_ref: React.ForwardedRef<unknown>,
	) {
		const isChatList = className?.includes("scrollable") ?? false
		return (
			<div data-testid={isChatList ? "chat-virtuoso-item-list" : "virtuoso-item-list"}>
				{data.map((item, index) => (
					<div key={item.ts} data-testid={`virtuoso-item-${index}`}>
						{itemContent(index, item)}
					</div>
				))}
			</div>
		)
	}),
}))

vi.mock("../ChatTextArea", () => {
	const ChatTextAreaComponent = React.forwardRef(function MockChatTextArea(
		_props: unknown,
		ref: React.ForwardedRef<{ focus: () => void }>,
	) {
		React.useImperativeHandle(ref, () => ({
			focus: vi.fn(),
		}))
		return <div data-testid="chat-textarea" />
	})

	return {
		default: ChatTextAreaComponent,
		ChatTextArea: ChatTextAreaComponent,
	}
})

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
		<button onClick={onClick}>{children}</button>
	),
	VSCodeLink: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
}))

const mockPostMessage = (state: Record<string, unknown>) => {
	window.postMessage(
		{
			type: "state",
			state: {
				version: "1.0.0",
				clineMessages: [],
				taskHistory: [],
				shouldShowAnnouncement: false,
				allowedCommands: [],
				alwaysAllowExecute: false,
				cloudIsAuthenticated: false,
				telemetrySetting: "enabled",
				mode: "evolve-17",
				customModes: [],
				...state,
			},
		},
		"*",
	)
}

const defaultProps: ChatViewProps = {
	isHidden: false,
	showAnnouncement: false,
	hideAnnouncement: () => {},
}

const queryClient = new QueryClient()

const renderChatView = (props: Partial<ChatViewProps> = {}) => {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatView {...defaultProps} {...props} />
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("ChatView - follow-up suggestion never switches mode or provider", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does not post type=mode when a suggestion carries a native mode slug", async () => {
		const { getByTestId } = renderChatView()

		mockPostMessage({
			mode: "evolve-17",
			currentApiConfigName: "beikun-grok",
			clineMessages: [
				{ type: "say", say: "task", ts: 1, text: "Active task" },
				{
					type: "ask",
					ask: "followup",
					ts: 2,
					text: JSON.stringify({
						question: "Would you like me to implement this feature?",
						suggest: [
							{ answer: "Yes, implement it now", mode: "code" },
							{ answer: "No, just plan it out", mode: "architect" },
						],
					}),
				},
			],
		})

		const architectChoice = await waitFor(() => getByTestId("followup-suggest-1"))
		;(vscode.postMessage as ReturnType<typeof vi.fn>).mockClear()
		fireEvent.click(architectChoice)

		const posted = (vscode.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])
		expect(posted.some((message) => message?.type === "mode")).toBe(false)
		expect(posted.some((message) => message?.type === "loadApiConfiguration")).toBe(false)
		expect(posted).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "askResponse",
					askResponse: "messageResponse",
					text: "No, just plan it out",
				}),
			]),
		)
	})
})
