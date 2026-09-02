// npx vitest run src/components/chat/__tests__/ChatView.watchdog-controls.spec.tsx

import React from "react"
import { render, fireEvent, act } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import ChatView, { ChatViewProps, DEAD_LETTER_GRACE_MS } from "../ChatView"

// Mock vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock use-sound hook
vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => {
		return [vi.fn()]
	}),
}))

// Mock components
vi.mock("../BrowserSessionRow", () => ({
	default: () => null,
}))

vi.mock("../ChatRow", () => ({
	default: () => null,
}))

vi.mock("../AutoApproveMenu", () => ({
	default: () => null,
}))

vi.mock("../common/VersionIndicator", () => ({
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

// Mock i18n at the exact hook ChatView uses.
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

vi.mock("../ChatTextArea", () => {
	const ChatTextAreaComponent = React.forwardRef(function MockChatTextArea(
		_props: any,
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

// Mock VSCode components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, onClick, ...rest }: any) => (
		<button data-testid={(rest as any)["data-testid"] || "vscode-button"} onClick={onClick}>
			{children}
		</button>
	),
	VSCodeLink: ({ children, href }: any) => <a href={href}>{children}</a>,
}))

// Mock window.postMessage to trigger state hydration
const mockPostMessage = (state: any) => {
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
				mode: "code",
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

// Micro-task drain so React commits + reducer updates settle between steps.
// Must use fake-timer-aware flushing: a bare setTimeout(0) promise would never
// resolve under vi.useFakeTimers().
const settle = () => act(async () => {
	await vi.advanceTimersByTimeAsync(0)
})

describe("ChatView - control watchdog fallback row", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("renders watchdog row in the dead-letter window after a primary click into silence", async () => {
		renderChatView()

		// Stage 1: pending resume_task ask renders the normal Resume/Terminate row.
		mockPostMessage({
			clineMessages: [
				{ type: "say", ts: 100, say: "task", text: "Fix the bug" },
				{ type: "ask", ts: 200, ask: "resume_task", text: "task completed" },
			],
		})
		await settle()

		// Normal action row visible, watchdog hidden.
		expect(document.querySelector('[data-testid="watchdog-controls"]')).toBeNull()
		const normalButtons = Array.from(document.querySelectorAll('button[data-testid="vscode-button"]'))
		expect(normalButtons.length).toBeGreaterThan(0)

		// Stage 2: click Resume. The host would remove the ask; simulate the
		// dead-letter case by replacing messages with a settled trailing
		// command_output (ask deleted, no live execution, no streaming).
		await act(async () => {
			fireEvent.click(normalButtons[0])
		})
		mockPostMessage({
			clineMessages: [
				{ type: "say", ts: 100, say: "task", text: "Fix the bug" },
				{ type: "say", ts: 300, say: "command_output", text: "still running...", partial: false },
			],
		})
		await settle()

		// Before the grace window elapses, the watchdog must stay hidden.
		expect(document.querySelector('[data-testid="watchdog-controls"]')).toBeNull()

		// Advance past the grace period: host stayed silent (no new messages,
		// no controls) -> dead letter confirmed -> fallback row renders.
		await act(async () => {
			vi.advanceTimersByTime(DEAD_LETTER_GRACE_MS + 100)
		})
		await settle()

		const watchdog = document.querySelector('[data-testid="watchdog-controls"]')
		expect(watchdog).not.toBeNull()
	})

	it("does not render the watchdog when regular controls are visible", async () => {
		renderChatView()

		mockPostMessage({
			clineMessages: [
				{ type: "say", ts: 100, say: "task", text: "Fix the bug" },
				{ type: "ask", ts: 200, ask: "resume_task", text: "task completed" },
			],
		})
		await settle()

		const watchdog = document.querySelector('[data-testid="watchdog-controls"]')
		expect(watchdog).toBeNull()
	})

	it("does not render the watchdog on an idle settled completion (soft completion)", async () => {
		renderChatView()

		mockPostMessage({
			clineMessages: [
				{ type: "say", ts: 100, say: "task", text: "Fix the bug" },
				{ type: "say", ts: 200, say: "completion_result", text: "done" },
			],
		})
		await settle()

		// Soft completion: even after the full grace window nothing may appear.
		await act(async () => {
			vi.advanceTimersByTime(DEAD_LETTER_GRACE_MS * 2)
		})
		await settle()

		const watchdog = document.querySelector('[data-testid="watchdog-controls"]')
		expect(watchdog).toBeNull()
	})

	it("watchdog Proceed posts terminalOperation continue and Cancel posts cancelTask", async () => {
		renderChatView()

		mockPostMessage({
			clineMessages: [
				{ type: "say", ts: 100, say: "task", text: "Fix the bug" },
				{ type: "ask", ts: 200, ask: "resume_task", text: "task completed" },
			],
		})
		await settle()

		// Click Resume then dead-letter: ask removed, settled command_output
		// tail (no live execution), host silent.
		const normalButtons = Array.from(document.querySelectorAll('button[data-testid="vscode-button"]'))
		expect(normalButtons.length).toBeGreaterThan(0)
		await act(async () => {
			fireEvent.click(normalButtons[0])
		})
		mockPostMessage({
			clineMessages: [
				{ type: "say", ts: 100, say: "task", text: "Fix the bug" },
				{ type: "say", ts: 300, say: "command_output", text: "still running...", partial: false },
			],
		})
		await settle()
		await act(async () => {
			vi.advanceTimersByTime(DEAD_LETTER_GRACE_MS + 100)
		})
		await settle()

		const watchdog = document.querySelector('[data-testid="watchdog-controls"]')
		expect(watchdog).not.toBeNull()

		const buttons = watchdog!.querySelectorAll("button")
		expect(buttons.length).toBeGreaterThanOrEqual(2)

		// Proceed button (first) -> terminalOperation continue
		await act(async () => {
			fireEvent.click(buttons[0])
		})
		const proceedCall = (vscode.postMessage as any).mock.calls.find(
			(call: any[]) => call[0]?.type === "terminalOperation",
		)
		expect(proceedCall).toBeDefined()
		expect(proceedCall[0].terminalOperation).toBe("continue")

		// Cancel button (second) -> cancelTask
		const callsBeforeCancel = [...(vscode.postMessage as any).mock.calls]
		await act(async () => {
			fireEvent.click(buttons[1])
		})
		const cancelCall = (vscode.postMessage as any).mock.calls
			.slice(callsBeforeCancel.length)
			.find((call: any[]) => call[0]?.type === "cancelTask")
		expect(cancelCall).toBeDefined()
	})
})
