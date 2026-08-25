// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/ChatView.spec.tsx

import React from "react"
import { render, waitFor, act, fireEvent } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import ChatView, { ChatViewProps } from "../ChatView"

// Define minimal types needed for testing
interface ClineMessage {
	type: "say" | "ask"
	say?: string
	ask?: string
	ts: number
	text?: string
	partial?: boolean
	isAnswered?: boolean
}

interface ExtensionState {
	version: string
	clineMessages: ClineMessage[]
	taskHistory: any[]
	shouldShowAnnouncement: boolean
	allowedCommands: string[]
	alwaysAllowExecute: boolean
	[key: string]: any
}

// Mock vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock use-sound hook
const mockPlayFunction = vi.fn()
vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => {
		return [mockPlayFunction]
	}),
}))

// Mock components that use ESM dependencies
vi.mock("../BrowserSessionRow", () => ({
	default: function MockBrowserSessionRow({ messages }: { messages: ClineMessage[] }) {
		return <div data-testid="browser-session">{JSON.stringify(messages)}</div>
	},
}))

vi.mock("../ChatRow", () => ({
	default: function MockChatRow({ message }: { message: ClineMessage }) {
		return (
			<div data-testid="chat-row">
				{JSON.stringify(message)}
				{message.say === "user_feedback" && (
					<button
						data-testid={`resend-${message.ts}`}
						onClick={() =>
							vscode.postMessage({
								type: "submitEditedMessage",
								value: message.ts,
								editedMessageContent: "edited resend content",
								images: [],
							})
						}>
						resend
					</button>
				)}
			</div>
		)
	},
}))

vi.mock("../AutoApproveMenu", () => ({
	default: () => null,
}))

const mockVirtuosoScrollTo = vi.fn()
const mockVirtuosoScrollToIndex = vi.fn()
let latestVirtuosoProps: {
	atBottomStateChange?: (isAtBottom: boolean) => void
	totalListHeightChanged?: (height: number) => void
}

// Mock react-virtuoso to render items directly without virtualization while
// retaining the scrolling callbacks needed for output-following tests.
vi.mock("react-virtuoso", () => ({
	Virtuoso: React.forwardRef(function MockVirtuoso(
		{
			data,
			itemContent,
			atBottomStateChange,
			totalListHeightChanged,
			className,
		}: {
			data: ClineMessage[]
			itemContent: (index: number, item: ClineMessage) => React.ReactNode
			atBottomStateChange?: (isAtBottom: boolean) => void
			totalListHeightChanged?: (height: number) => void
			className?: string
		},
		ref: React.ForwardedRef<{
			scrollTo: typeof mockVirtuosoScrollTo
			scrollToIndex: typeof mockVirtuosoScrollToIndex
		}>,
	) {
		React.useImperativeHandle(ref, () => ({
			scrollTo: mockVirtuosoScrollTo,
			scrollToIndex: mockVirtuosoScrollToIndex,
		}))
		const isChatList = className?.includes("scrollable") ?? false
		if (isChatList) {
			latestVirtuosoProps = { atBottomStateChange, totalListHeightChanged }
		}

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

// Mock VersionIndicator - returns null by default to prevent rendering in tests
vi.mock("../../common/VersionIndicator", () => ({
	default: vi.fn(() => null),
}))

// Get the mock function after the module is mocked
const mockVersionIndicator = vi.mocked((await import("../../common/VersionIndicator")).default)

vi.mock("../Announcement", () => ({
	default: function MockAnnouncement({ hideAnnouncement }: { hideAnnouncement: () => void }) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const React = require("react")
		return React.createElement(
			"div",
			{ "data-testid": "announcement-modal" },
			React.createElement("div", null, "What's New"),
			React.createElement("button", { onClick: hideAnnouncement }, "Close"),
		)
	},
}))

// Mock DismissibleUpsell component
vi.mock("@/components/common/DismissibleUpsell", () => ({
	default: function MockDismissibleUpsell({ children }: { children: React.ReactNode }) {
		return <div data-testid="dismissible-upsell">{children}</div>
	},
}))

// Mock RooTips component
vi.mock("@src/components/welcome/RooTips", () => ({
	default: function MockRooTips() {
		return <div data-testid="roo-tips">Tips content</div>
	},
}))

// Mock RooHero component
vi.mock("@src/components/welcome/RooHero", () => ({
	default: function MockRooHero() {
		return <div data-testid="roo-hero">Hero content</div>
	},
}))

// Mock TelemetryBanner component
vi.mock("../common/TelemetryBanner", () => ({
	default: function MockTelemetryBanner() {
		return null // Don't render anything to avoid interference
	},
}))

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: any) => {
			if (key === "chat:versionIndicator.ariaLabel" && options?.version) {
				return `Version ${options.version}`
			}
			return key
		},
	}),
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
	Trans: ({ i18nKey, children }: { i18nKey: string; children?: React.ReactNode }) => {
		return <>{children || i18nKey}</>
	},
}))

interface ChatTextAreaProps {
	onSend: () => void
	inputValue?: string
	setInputValue?: (value: string) => void
	sendingDisabled?: boolean
	placeholderText?: string
	selectedImages?: string[]
	shouldDisableImages?: boolean
}

const mockInputRef = React.createRef<HTMLInputElement>()
const mockFocus = vi.fn()

vi.mock("../ChatTextArea", () => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const mockReact = require("react")

	const ChatTextAreaComponent = mockReact.forwardRef(function MockChatTextArea(
		props: ChatTextAreaProps,
		ref: React.ForwardedRef<{ focus: () => void }>,
	) {
		// Use useImperativeHandle to expose the mock focus method
		mockReact.useImperativeHandle(ref, () => ({
			focus: mockFocus,
		}))

		return (
			<div data-testid="chat-textarea">
				<input
					ref={mockInputRef}
					type="text"
					value={props.inputValue || ""}
					onChange={(e) => {
						// Use parent's setInputValue if available
						if (props.setInputValue) {
							props.setInputValue(e.target.value)
						}
					}}
					onKeyDown={(e) => {
						// Only call onSend when Enter is pressed (simulating real behavior)
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault()
							props.onSend()
						}
					}}
					data-sending-disabled={props.sendingDisabled}
				/>
			</div>
		)
	})

	return {
		default: ChatTextAreaComponent,
		ChatTextArea: ChatTextAreaComponent, // Export as named export too
	}
})

// Mock VSCode components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: function MockVSCodeButton({
		children,
		onClick,
		appearance,
	}: {
		children: React.ReactNode
		onClick?: () => void
		appearance?: string
	}) {
		return (
			<button onClick={onClick} data-appearance={appearance}>
				{children}
			</button>
		)
	},
	VSCodeTextField: function MockVSCodeTextField({
		value,
		onInput,
		placeholder,
	}: {
		value?: string
		onInput?: (e: { target: { value: string } }) => void
		placeholder?: string
	}) {
		return (
			<input
				type="text"
				value={value}
				onChange={(e) => onInput?.({ target: { value: e.target.value } })}
				placeholder={placeholder}
			/>
		)
	},
	VSCodeLink: function MockVSCodeLink({ children, href }: { children: React.ReactNode; href?: string }) {
		return <a href={href}>{children}</a>
	},
}))

// Mock window.postMessage to trigger state hydration
const mockPostMessage = (state: Partial<ExtensionState>) => {
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

// kilocode_change start: keep streaming reasoning pinned unless the user explicitly scrolls up

describe("ChatView - streaming output following", () => {
	let animationFrames: FrameRequestCallback[]
	let restoreRequestAnimationFrame: () => void

	beforeEach(() => {
		vi.clearAllMocks()
		animationFrames = []
		const requestAnimationFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			animationFrames.push(callback)
			return animationFrames.length
		})
		restoreRequestAnimationFrame = () => requestAnimationFrameSpy.mockRestore()
	})

	afterEach(() => {
		restoreRequestAnimationFrame()
	})

	const renderActiveTask = async () => {
		const result = renderChatView()
		mockPostMessage({
			clineMessages: [{ type: "say", say: "task", ts: 1, text: "Active task" }],
		})
		await waitFor(() => expect(result.getByTestId("chat-virtuoso-item-list")).toBeInTheDocument())
		return result
	}

	const flushNextAnimationFrame = () => {
		const callback = animationFrames.shift()
		expect(callback).toBeDefined()
		act(() => callback?.(0))
	}

	it("keeps following when streaming content growth temporarily reports away from bottom", async () => {
		await renderActiveTask()
		mockVirtuosoScrollTo.mockClear()

		act(() => {
			latestVirtuosoProps.atBottomStateChange?.(false)
			latestVirtuosoProps.totalListHeightChanged?.(500)
		})
		flushNextAnimationFrame()

		expect(mockVirtuosoScrollTo).toHaveBeenCalledWith({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "auto",
		})
	})

	it("stops forcing the bottom after an explicit upward wheel gesture", async () => {
		const { getByTestId } = await renderActiveTask()
		mockVirtuosoScrollTo.mockClear()

		fireEvent.wheel(getByTestId("chat-virtuoso-item-list"), { deltaY: -100 })
		act(() => {
			latestVirtuosoProps.atBottomStateChange?.(false)
			latestVirtuosoProps.totalListHeightChanged?.(600)
		})

		expect(animationFrames).toHaveLength(0)
		expect(mockVirtuosoScrollTo).not.toHaveBeenCalled()
	})

	it("keeps following when a touch gesture moves toward newer output", async () => {
		const { getByTestId } = await renderActiveTask()
		const chatList = getByTestId("chat-virtuoso-item-list")
		mockVirtuosoScrollTo.mockClear()

		fireEvent.touchStart(chatList, { touches: [{ clientY: 200 }] })
		fireEvent.touchMove(chatList, { touches: [{ clientY: 100 }] })
		act(() => latestVirtuosoProps.totalListHeightChanged?.(650))
		flushNextAnimationFrame()

		expect(mockVirtuosoScrollTo).toHaveBeenCalledTimes(1)
	})

	it("stops following when a touch gesture moves toward older output", async () => {
		const { getByTestId } = await renderActiveTask()
		const chatList = getByTestId("chat-virtuoso-item-list")
		mockVirtuosoScrollTo.mockClear()

		fireEvent.touchStart(chatList, { touches: [{ clientY: 100 }] })
		fireEvent.touchMove(chatList, { touches: [{ clientY: 200 }] })
		act(() => latestVirtuosoProps.totalListHeightChanged?.(675))

		expect(animationFrames).toHaveLength(0)
		expect(mockVirtuosoScrollTo).not.toHaveBeenCalled()
	})

	it("resumes following after the user returns to the bottom", async () => {
		const { getByTestId } = await renderActiveTask()
		fireEvent.wheel(getByTestId("chat-virtuoso-item-list"), { deltaY: -100 })
		mockVirtuosoScrollTo.mockClear()

		act(() => {
			latestVirtuosoProps.atBottomStateChange?.(true)
			latestVirtuosoProps.atBottomStateChange?.(false)
			latestVirtuosoProps.totalListHeightChanged?.(700)
		})
		flushNextAnimationFrame()

		expect(mockVirtuosoScrollTo).toHaveBeenCalledTimes(1)
	})

	it("stops following after jumping to a user message until the list is at the bottom again", async () => {
		const result = renderChatView()
		mockPostMessage({
			clineMessages: [
				{ type: "say", say: "task", ts: 1, text: "Active task" },
				{ type: "say", say: "user_feedback", ts: 2, text: "first user" },
				{ type: "say", say: "text", ts: 3, text: "assistant" },
			],
		})
		await waitFor(() => expect(result.getByTestId("user-message-rail")).toBeInTheDocument())
		mockVirtuosoScrollTo.mockClear()
		mockVirtuosoScrollToIndex.mockClear()

		fireEvent.click(result.getAllByTestId("user-message-rail-tick")[0])
		act(() => latestVirtuosoProps.totalListHeightChanged?.(800))

		expect(mockVirtuosoScrollToIndex).toHaveBeenCalled()
		expect(animationFrames).toHaveLength(0)
		expect(mockVirtuosoScrollTo).not.toHaveBeenCalled()

		act(() => {
			latestVirtuosoProps.atBottomStateChange?.(true)
			latestVirtuosoProps.atBottomStateChange?.(false)
			latestVirtuosoProps.totalListHeightChanged?.(850)
		})
		flushNextAnimationFrame()
		expect(mockVirtuosoScrollTo).toHaveBeenCalledTimes(1)
	})
})

// kilocode_change end

// kilocode_change start: prominent GitHub Star entry on the Deeptask home screen
describe("ChatView - GitHub Star entry", () => {
	beforeEach(() => vi.clearAllMocks())

	it("shows the Star action on the empty home screen and opens the canonical repository", async () => {
		const { getByRole } = renderChatView()
		mockPostMessage({ clineMessages: [], taskHistory: [] })

		const starButton = await waitFor(() => getByRole("button", { name: "Star Deeptask on GitHub" }))
		fireEvent.click(starButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "openExternal",
			url: "https://github.com/kurzcraft/DeepTask",
		})
	})

	it("does not occupy the active task view", async () => {
		const { queryByRole } = renderChatView()
		mockPostMessage({
			clineMessages: [{ type: "say", say: "task", ts: Date.now(), text: "Active task" }],
		})

		await waitFor(() => {
			expect(queryByRole("button", { name: "Star Deeptask on GitHub" })).not.toBeInTheDocument()
		})
	})
})
// kilocode_change end

describe("ChatView - Sound Playing Tests", () => {
	beforeEach(() => vi.clearAllMocks())

	it("plays celebration sound for completion results", async () => {
		renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			soundEnabled: true, // Enable sound
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		mockPlayFunction.mockClear()

		// Add completion result
		mockPostMessage({
			soundEnabled: true, // Enable sound
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "completion_result",
					ts: Date.now(),
					text: "Task completed successfully",
					partial: false, // Ensure it's not partial
				},
			],
		})

		// Wait for sound to be played
		await waitFor(() => {
			expect(mockPlayFunction).toHaveBeenCalled()
		})
	})

	it("plays progress_loop sound for api failures", async () => {
		renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			soundEnabled: true, // Enable sound
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		mockPlayFunction.mockClear()

		// Add API failure
		mockPostMessage({
			soundEnabled: true, // Enable sound
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "api_req_failed",
					ts: Date.now(),
					text: "API request failed",
					partial: false, // Ensure it's not partial
				},
			],
		})

		// Wait for sound to be played
		await waitFor(() => {
			expect(mockPlayFunction).toHaveBeenCalled()
		})
	})

	it("does not play sound when resuming a task from history", () => {
		renderChatView()

		// Clear any initial calls
		mockPlayFunction.mockClear()

		// Hydrate state with a task that has a resumeTaskId (indicating it's resumed from history)
		mockPostMessage({
			resumeTaskId: "task-123",
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Resumed task",
				},
				{
					type: "ask",
					ask: "tool",
					ts: Date.now(),
					text: JSON.stringify({ tool: "readFile", path: "test.txt" }),
				},
			],
		})

		// Should not play sound when resuming from history
		expect(mockPlayFunction).not.toHaveBeenCalled()
	})

	it("does not play sound when resuming a completed task from history", () => {
		renderChatView()

		// Clear any initial calls
		mockPlayFunction.mockClear()

		// Hydrate state with a completed task that has a resumeTaskId
		mockPostMessage({
			resumeTaskId: "task-123",
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Resumed task",
				},
				{
					type: "ask",
					ask: "completion_result",
					ts: Date.now(),
					text: "Task completed",
				},
			],
		})

		// Should not play sound for completion when resuming from history
		expect(mockPlayFunction).not.toHaveBeenCalled()
	})
})

describe("ChatView - Focus Grabbing Tests", () => {
	beforeEach(() => vi.clearAllMocks())

	it("does not grab focus when follow-up question presented", async () => {
		const { getByTestId } = renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Wait for the component to fully render and settle before clearing mocks
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Wait for the debounced focus effect to fire (50ms debounce + buffer for CI variability)
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100))
		})

		// Clear any initial calls after state has settled
		mockFocus.mockClear()

		// Add follow-up question
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "followup",
					ts: Date.now(),
					text: "Should I continue?",
				},
			],
		})

		// Wait for state update to complete
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Should not grab focus for follow-up questions
		expect(mockFocus).not.toHaveBeenCalled()
	})
})

describe.skip("ChatView - Version Indicator Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Reset the mock to return null by default
		mockVersionIndicator.mockReturnValue(null)
	})

	it("displays version indicator button", () => {
		// Mock VersionIndicator to return a button
		mockVersionIndicator.mockReturnValue(
			React.createElement("button", {
				"data-testid": "version-indicator",
				"aria-label": "Version 1.0.0",
				className: "version-indicator-button",
			}),
		)

		const { getByTestId } = renderChatView()

		// Hydrate state with no active task
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		// Should display version indicator
		expect(getByTestId("version-indicator")).toBeInTheDocument()
	})

	it("opens announcement modal when version indicator is clicked", async () => {
		// Mock VersionIndicator to return a button with onClick
		mockVersionIndicator.mockImplementation(({ onClick }: { onClick?: () => void }) =>
			React.createElement("button", {
				"data-testid": "version-indicator",
				onClick,
			}),
		)

		const { getByTestId, queryByTestId } = renderChatView({ showAnnouncement: false })

		// Hydrate state
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		// Wait for component to render
		await waitFor(() => {
			expect(getByTestId("version-indicator")).toBeInTheDocument()
		})

		// Click version indicator
		const versionIndicator = getByTestId("version-indicator")
		act(() => {
			versionIndicator.click()
		})

		// Wait for announcement modal to appear
		await waitFor(() => {
			expect(queryByTestId("announcement-modal")).toBeInTheDocument()
		})
	})

	it("version indicator has correct styling classes", () => {
		// Mock VersionIndicator to return a button with specific classes
		mockVersionIndicator.mockReturnValue(
			React.createElement("button", {
				"data-testid": "version-indicator",
				className: "version-indicator-button absolute top-2 right-2",
			}),
		)

		const { getByTestId } = renderChatView()

		// Hydrate state
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		const versionIndicator = getByTestId("version-indicator")
		expect(versionIndicator.className).toContain("version-indicator-button")
		expect(versionIndicator.className).toContain("absolute")
		expect(versionIndicator.className).toContain("top-2")
		expect(versionIndicator.className).toContain("right-2")
	})

	it("version indicator has proper accessibility attributes", () => {
		// Mock VersionIndicator to return a button with aria-label
		mockVersionIndicator.mockReturnValue(
			React.createElement("button", {
				"data-testid": "version-indicator",
				"aria-label": "Version 1.0.0",
				role: "button",
			}),
		)

		const { getByTestId } = renderChatView()

		// Hydrate state
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		const versionIndicator = getByTestId("version-indicator")
		expect(versionIndicator.getAttribute("aria-label")).toBe("Version 1.0.0")
		expect(versionIndicator.getAttribute("role")).toBe("button")
	})

	it("does not display version indicator when there is an active task", () => {
		// Mock VersionIndicator to return null (simulating hidden state)
		mockVersionIndicator.mockReturnValue(null)

		const { queryByTestId } = renderChatView()

		// Hydrate state with active task
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now(),
					text: "Active task",
				},
			],
		})

		// Should not display version indicator during active task
		expect(queryByTestId("version-indicator")).not.toBeInTheDocument()
	})

	it("displays version indicator only on welcome screen (no task)", () => {
		// Mock VersionIndicator to return a button
		mockVersionIndicator.mockReturnValue(React.createElement("button", { "data-testid": "version-indicator" }))

		const { queryByTestId } = renderChatView()

		// Hydrate state with no active task
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		// Should display version indicator on welcome screen
		expect(queryByTestId("version-indicator")).toBeInTheDocument()
	})
})

// kilocode_change skip
it.skip("ChatView - RooCloudCTA Display Tests", () => {
	beforeEach(() => vi.clearAllMocks())

	it("does not show DismissibleUpsell when user is authenticated to Cloud", () => {
		const { queryByTestId } = renderChatView()

		// Hydrate state with user authenticated to cloud
		mockPostMessage({
			cloudIsAuthenticated: true,
			taskHistory: [
				{ id: "1", ts: Date.now() - 3000 },
				{ id: "2", ts: Date.now() - 2000 },
				{ id: "3", ts: Date.now() - 1000 },
				{ id: "4", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		// Should not show DismissibleUpsell when authenticated
		expect(queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
	})

	it("does not show DismissibleUpsell when user has only run 3 tasks in their history", () => {
		const { queryByTestId } = renderChatView()

		// Hydrate state with user not authenticated but only 3 tasks
		mockPostMessage({
			cloudIsAuthenticated: false,
			taskHistory: [
				{ id: "1", ts: Date.now() - 2000 },
				{ id: "2", ts: Date.now() - 1000 },
				{ id: "3", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		// Should not show DismissibleUpsell with less than 4 tasks
		expect(queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
	})

	// kilocode_change skip
	it.skip("shows DismissibleUpsell when user is not authenticated and has run 6 or more tasks", async () => {
		const { getByTestId } = renderChatView()

		// Hydrate state with user not authenticated and 4 tasks
		mockPostMessage({
			cloudIsAuthenticated: false,
			taskHistory: [
				{ id: "1", ts: Date.now() - 6000 },
				{ id: "2", ts: Date.now() - 5000 },
				{ id: "3", ts: Date.now() - 4000 },
				{ id: "4", ts: Date.now() - 3000 },
				{ id: "5", ts: Date.now() - 2000 },
				{ id: "6", ts: Date.now() - 1000 },
				{ id: "7", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		// Wait for component to render and show DismissibleUpsell
		await waitFor(() => {
			expect(getByTestId("dismissible-upsell")).toBeInTheDocument()
		})
	})

	it("does not show DismissibleUpsell when there is an active task (regardless of auth status)", async () => {
		const { queryByTestId } = renderChatView()

		// Hydrate state with active task
		mockPostMessage({
			cloudIsAuthenticated: false,
			taskHistory: [
				{ id: "1", ts: Date.now() - 3000 },
				{ id: "2", ts: Date.now() - 2000 },
				{ id: "3", ts: Date.now() - 1000 },
				{ id: "4", ts: Date.now() },
			],
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now(),
					text: "Active task",
				},
			],
		})

		// Wait for component to render with active task
		await waitFor(() => {
			// Should not show DismissibleUpsell during active task
			expect(queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
			// Should not show RooTips either since the entire welcome screen is hidden during active tasks
			expect(queryByTestId("roo-tips")).not.toBeInTheDocument()
			// Should not show RooHero either since the entire welcome screen is hidden during active tasks
			expect(queryByTestId("roo-hero")).not.toBeInTheDocument()
		})
	})

	// kilocode_change skip
	it.skip("shows RooTips when user is authenticated (instead of RooCloudCTA)", () => {
		const { queryByTestId, getByTestId } = renderChatView()

		// Hydrate state with user authenticated to cloud
		mockPostMessage({
			cloudIsAuthenticated: true,
			taskHistory: [
				{ id: "1", ts: Date.now() - 3000 },
				{ id: "2", ts: Date.now() - 2000 },
				{ id: "3", ts: Date.now() - 1000 },
				{ id: "4", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		// Should not show DismissibleUpsell but should show RooTips
		expect(queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
		expect(getByTestId("roo-tips")).toBeInTheDocument()
	})

	// kilocode_change skip
	it.skip("shows RooTips when user has fewer than 6 tasks (instead of DismissibleUpsell)", () => {
		const { queryByTestId, getByTestId } = renderChatView()

		// Hydrate state with user not authenticated but fewer than 4 tasks
		mockPostMessage({
			cloudIsAuthenticated: false,
			taskHistory: [
				{ id: "1", ts: Date.now() - 2000 },
				{ id: "2", ts: Date.now() - 1000 },
				{ id: "3", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		// Should not show DismissibleUpsell but should show RooTips
		expect(queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
		expect(getByTestId("roo-tips")).toBeInTheDocument()
	})
})

// kilocode_change skip: these tests are flaky and only reliably pass when run individually, not as a set
describe.skip("ChatView - Message Queueing Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Reset the mock to clear any initial calls
		vi.mocked(vscode.postMessage).mockClear()
	})

	it("shows sending is disabled when task is active", async () => {
		const { getByTestId } = renderChatView()

		// Hydrate state with active task that should disable sending
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 1000,
					text: "Task in progress",
				},
				{
					type: "ask",
					ask: "tool",
					ts: Date.now(),
					text: JSON.stringify({ tool: "readFile", path: "test.txt" }),
					partial: true, // Partial messages disable sending
				},
			],
		})

		// Wait for state to be updated and check that sending is disabled
		await waitFor(() => {
			const chatTextArea = getByTestId("chat-textarea")
			const input = chatTextArea.querySelector("input")!
			expect(input.getAttribute("data-sending-disabled")).toBe("true")
		})
	})

	it("shows sending is enabled when no task is active", async () => {
		const { getByTestId } = renderChatView()

		// Hydrate state with completed task
		mockPostMessage({
			clineMessages: [
				{
					type: "ask",
					ask: "completion_result",
					ts: Date.now(),
					text: "Task completed",
					partial: false,
				},
			],
		})

		// Wait for state to be updated
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Check that sending is enabled
		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")!
		expect(input.getAttribute("data-sending-disabled")).toBe("false")
	})

	it("queues messages when API request is in progress (spinner visible)", async () => {
		const { getByTestId } = renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		vi.mocked(vscode.postMessage).mockClear()

		// Add api_req_started without cost (spinner state - API request in progress)
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "api_req_started",
					ts: Date.now(),
					text: JSON.stringify({ apiProtocol: "anthropic" }), // No cost = still streaming
				},
			],
		})

		// Wait for state to be updated
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement
		expect(input.getAttribute("data-sending-disabled")).toBe("false")

		// Clear message calls before simulating user input
		vi.mocked(vscode.postMessage).mockClear()

		// Simulate user typing and sending a message during the spinner
		// Trigger message send by simulating typing and Enter key press
		await act(async () => {
			// Use fireEvent to properly trigger React's onChange handler
			fireEvent.change(input, { target: { value: "follow-up question during spinner" } })

			// Simulate pressing Enter to send
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		// Verify that busy sends go through the direct feedback/continue path, not legacy queue transport.
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "messageResponse",
				text: "follow-up question during spinner",
				images: [],
			})
		})

		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "queueMessage" }))
	})

	it("sends messages normally when API request is complete (cost present)", async () => {
		const { getByTestId } = renderChatView()

		// Hydrate state with completed API request (cost present)
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "api_req_started",
					ts: Date.now(),
					text: JSON.stringify({
						apiProtocol: "anthropic",
						cost: 0.05, // Cost present = streaming complete
						tokensIn: 100,
						tokensOut: 50,
					}),
				},
				{
					type: "say",
					say: "text",
					ts: Date.now(),
					text: "Response from API",
				},
			],
		})

		// Wait for state to be updated
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Clear message calls before simulating user input
		vi.mocked(vscode.postMessage).mockClear()

		// Simulate user sending a message when API is done
		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement

		await act(async () => {
			// Use fireEvent to properly trigger React's onChange handler
			fireEvent.change(input, { target: { value: "follow-up after completion" } })

			// Simulate pressing Enter to send
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		// Verify that the message was sent as askResponse, not queued
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "messageResponse",
				text: "follow-up after completion",
				images: [],
			})
		})

		// Verify it was NOT queued
		expect(vscode.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({
				type: "queueMessage",
			}),
		)
	})

	it("sends directly even when stale queue state exists", async () => {
		const { getByTestId } = renderChatView()

		// Hydrate state with API request in progress and stale queue state.
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "api_req_started",
					ts: Date.now(),
					text: JSON.stringify({ apiProtocol: "anthropic" }), // No cost = still streaming
				},
			],
			messageQueue: [
				{ id: "msg1", text: "queued message 1", images: [] },
				{ id: "msg2", text: "queued message 2", images: [] },
			],
		})

		// Wait for state to be updated
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Clear message calls before simulating user input
		vi.mocked(vscode.postMessage).mockClear()

		// Simulate user sending a new message while stale queue state exists.
		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement

		await act(async () => {
			fireEvent.change(input, { target: { value: "message during queue drain" } })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		// Verify that stale queues do not force new input back onto the legacy queue path.
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "messageResponse",
				text: "message during queue drain",
				images: [],
			})
		})

		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "queueMessage" }))
	})
})

describe("ChatView - Edited Resend Visibility", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(vscode.postMessage).mockClear()
	})

	it("renders no local queue row while an edited resend is rewound and persists only the accepted replacement", async () => {
		const originalTs = Date.now() - 1000
		const { getByTestId, getAllByTestId, queryAllByText } = renderChatView()

		const getResendChatRows = () =>
			getAllByTestId("chat-row").filter((row) => row.textContent?.includes("edited resend content"))

		mockPostMessage({
			clineMessages: [
				{ type: "say", say: "task", ts: originalTs - 1, text: "Initial task" },
				{ type: "say", say: "user_feedback", ts: originalTs, text: "old content" },
			],
		})

		await waitFor(() => expect(getByTestId(`resend-${originalTs}`)).toBeInTheDocument())
		fireEvent.click(getByTestId(`resend-${originalTs}`))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "submitEditedMessage",
			value: originalTs,
			editedMessageContent: "edited resend content",
			images: [],
		})
		expect(queryAllByText("edited resend content")).toHaveLength(0)
		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "queueMessage" }))

		// During rewind neither the old text nor a local optimistic/queued replacement is rendered.
		mockPostMessage({
			clineMessages: [{ type: "say", say: "task", ts: originalTs - 1, text: "Initial task" }],
		})
		await waitFor(() => expect(queryAllByText("old content")).toHaveLength(0))
		expect(queryAllByText("edited resend content")).toHaveLength(0)

		mockPostMessage({
			clineMessages: [
				{ type: "say", say: "task", ts: originalTs - 1, text: "Initial task" },
				{ type: "say", say: "user_feedback", ts: Date.now(), text: "edited resend content" },
			],
		})

		await waitFor(() => expect(getResendChatRows()).toHaveLength(1))
		expect(queryAllByText("old content")).toHaveLength(0)
	})
})

describe("ChatView - Command Execution Status", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(vscode.postMessage).mockClear()
	})

	it("routes sends during command_output waits directly to terminalOperation", async () => {
		const { getByTestId, getByText } = renderChatView()

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "command_output",
					ts: Date.now(),
					text: "",
					partial: false,
				},
			],
		})

		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "commandExecutionStatus",
						text: JSON.stringify({
							executionId: "command-output-live",
							status: "started",
							command: "python test.py",
						}),
					},
				}),
			)
		})

		// Wait until the command_output ask UI is hydrated; chat-textarea alone is always present.
		await waitFor(() => {
			expect(getByText("chat:proceedWhileRunning.title")).toBeInTheDocument()
		})

		vi.mocked(vscode.postMessage).mockClear()

		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement

		await act(async () => {
			fireEvent.change(input, { target: { value: "command finished, continue" } })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "terminalOperation",
				terminalOperation: "continue",
				terminalOperationText: "command finished, continue",
				terminalOperationImages: [],
			})
		})

		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "queueMessage" }))
		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "askResponse" }))
		// Waiting feedback must not be mirrored below the transcript. The input is
		// cleared immediately and the full text appears only after host persistence.
		expect(input).toHaveValue("")
		expect(document.body).not.toHaveTextContent("command finished, continue")
	})

	it("suppresses rapid duplicate sends while preserving a single direct message", async () => {
		const { getByTestId, getByText, queryAllByText } = renderChatView()

		mockPostMessage({
			clineMessages: [
				{ type: "say", say: "task", ts: Date.now() - 2_000, text: "Initial task" },
				{ type: "say", say: "api_req_started", ts: Date.now() - 1_000, text: "{}" },
			],
		})

		await waitFor(() => expect(getByText("Initial task")).toBeInTheDocument())
		vi.mocked(vscode.postMessage).mockClear()

		const input = getByTestId("chat-textarea").querySelector("input")! as HTMLInputElement
		await act(async () => {
			fireEvent.change(input, { target: { value: "one long follow-up" } })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledTimes(1)
			expect(vscode.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "askResponse",
					askResponse: "messageResponse",
					text: "one long follow-up",
				}),
			)
		})
		expect(queryAllByText("one long follow-up")).toHaveLength(0)
	})

	it("allows distinct rapid instructions without rendering waiting cards", async () => {
		const { getByTestId, getByText, queryAllByText } = renderChatView()

		mockPostMessage({
			clineMessages: [
				{ type: "say", say: "task", ts: Date.now() - 2_000, text: "Initial task" },
				{ type: "say", say: "api_req_started", ts: Date.now() - 1_000, text: "{}" },
			],
		})

		await waitFor(() => expect(getByText("Initial task")).toBeInTheDocument())
		vi.mocked(vscode.postMessage).mockClear()
		const input = getByTestId("chat-textarea").querySelector("input")! as HTMLInputElement

		await act(async () => {
			fireEvent.change(input, { target: { value: "first distinct instruction" } })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
			fireEvent.change(input, { target: { value: "second distinct instruction" } })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		await waitFor(() => expect(vscode.postMessage).toHaveBeenCalledTimes(2))
		expect(queryAllByText("first distinct instruction")).toHaveLength(0)
		expect(queryAllByText("second distinct instruction")).toHaveLength(0)
		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "queueMessage" }))
	})

	it("does not treat finished command_output say rows as live terminal waits", async () => {
		const { getByTestId, getByText } = renderChatView()

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "command_output",
					ts: Date.now(),
					text: "done",
					partial: false,
				},
			],
		})

		// Wait until the task state is hydrated so sends don't race into newTask.
		await waitFor(() => {
			expect(getByText("Initial task")).toBeInTheDocument()
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		vi.mocked(vscode.postMessage).mockClear()

		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement

		await act(async () => {
			fireEvent.change(input, { target: { value: "next task after command finished" } })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "messageResponse",
				text: "next task after command finished",
				images: [],
			})
		})

		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "terminalOperation" }))
	})

	it("does not route sends as command feedback after fallback clears the active command", async () => {
		const { getByTestId } = renderChatView()
		const executionId = "command-1"

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "text",
					ts: Date.now() - 1000,
					text: "Task has an existing assistant response",
				},
			],
		})

		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		act(() => {
			window.postMessage(
				{
					type: "commandExecutionStatus",
					text: JSON.stringify({ executionId, status: "started", command: "npm test" }),
				},
				"*",
			)
			window.postMessage(
				{
					type: "commandExecutionStatus",
					text: JSON.stringify({ executionId, status: "fallback" }),
				},
				"*",
			)
		})

		vi.mocked(vscode.postMessage).mockClear()

		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement

		await act(async () => {
			fireEvent.change(input, { target: { value: "continue normally" } })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "messageResponse",
				text: "continue normally",
				images: [],
			})
		})

		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "terminalOperation" }))
	})

	it("clears a leftover Run button once the shell starts and routes a late click as continue", async () => {
		const { getByTestId, queryByText, getByText } = renderChatView()
		const executionId = "command-long-1"

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "command",
					ts: Date.now() - 1000,
					text: "sleep 30 && echo done",
					partial: false,
					isAnswered: true,
				},
			],
		})

		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// A persisted answered ask is history only until the host reports a live execution.
		expect(queryByText("Run")).not.toBeInTheDocument()
		expect(queryByText("chat:proceedWhileRunning.title")).not.toBeInTheDocument()

		act(() => {
			window.postMessage(
				{
					type: "commandExecutionStatus",
					text: JSON.stringify({ executionId, status: "started", command: "sleep 30 && echo done" }),
				},
				"*",
			)
		})

		await waitFor(() => {
			expect(queryByText("Run")).not.toBeInTheDocument()
			expect(getByText("chat:proceedWhileRunning.title")).toBeInTheDocument()
		})

		// A refreshed answered history row must not override the live execution state.
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "command",
					ts: Date.now() - 1000,
					text: "sleep 30 && echo done",
					partial: false,
					isAnswered: true,
				},
			],
		})

		await waitFor(() => {
			expect(queryByText("Run")).not.toBeInTheDocument()
			expect(getByText("chat:proceedWhileRunning.title")).toBeInTheDocument()
		})
	})

	it("clears stale command controls after the shell exits", async () => {
		const { queryByText } = renderChatView()
		const executionId = "command-exit-1"

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "command",
					ts: Date.now() - 1000,
					text: "python long_script.py",
					partial: false,
					isAnswered: true,
				},
			],
		})

		act(() => {
			window.postMessage(
				{
					type: "commandExecutionStatus",
					text: JSON.stringify({ executionId, status: "started", command: "python long_script.py" }),
				},
				"*",
			)
			window.postMessage(
				{
					type: "commandExecutionStatus",
					text: JSON.stringify({ executionId, status: "exited", exitCode: 0 }),
				},
				"*",
			)
			// VS Code may flush one final output event after shell exit. It must not
			// resurrect the live command controls for this settled execution.
			window.postMessage(
				{
					type: "commandExecutionStatus",
					text: JSON.stringify({ executionId, status: "output", output: "late output" }),
				},
				"*",
			)
		})

		await waitFor(() => {
			expect(queryByText("chat:proceedWhileRunning.title")).not.toBeInTheDocument()
		})

		expect(vscode.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "terminalOperation", terminalOperation: "continue" }),
		)
	})

	it("does not resurrect controls when an unanswered command_output ask is replayed after exit", async () => {
		const { queryByText } = renderChatView()
		const executionId = "command-replayed-after-exit"
		const baseTs = Date.now() - 3000

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: baseTs,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "command_output",
					ts: baseTs + 1000,
					text: "command output",
					partial: false,
					isAnswered: false,
				},
			],
		})

		await act(async () => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "commandExecutionStatus",
						text: JSON.stringify({ executionId, status: "started", command: "python test.py" }),
					},
				}),
			)
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "commandExecutionStatus",
						text: JSON.stringify({ executionId, status: "exited", exitCode: 0 }),
					},
				}),
			)
		})

		await waitFor(() => {
			expect(queryByText("chat:proceedWhileRunning.title")).not.toBeInTheDocument()
			expect(queryByText("chat:killCommand.title")).not.toBeInTheDocument()
		})
	})

	it("still shows Continue during a live command even if api_req_started has no cost yet", async () => {
		const { getByText, queryByText } = renderChatView()
		const executionId = "command-stream-1"

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 3000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "api_req_started",
					ts: Date.now() - 2000,
					// No cost means isStreaming would otherwise be true and hide Continue.
					text: JSON.stringify({ apiProtocol: "openai" }),
				},
				{
					type: "ask",
					ask: "command",
					ts: Date.now() - 1000,
					text: "python3 - <<'PY'\nprint('hi')\nPY",
					partial: false,
					isAnswered: true,
				},
			],
		})

		act(() => {
			window.postMessage(
				{
					type: "commandExecutionStatus",
					text: JSON.stringify({
						executionId,
						status: "started",
						command: "python3 - <<'PY'\nprint('hi')\nPY",
					}),
				},
				"*",
			)
		})

		await waitFor(() => {
			expect(getByText("chat:proceedWhileRunning.title")).toBeInTheDocument()
			expect(getByText("chat:killCommand.title")).toBeInTheDocument()
		})

		// Must not collapse to Cancel-only streaming chrome.
		expect(queryByText("chat:cancel.title")).not.toBeInTheDocument()
	})

	it("shows Cancel after force-continue starts a new API request even if the shell is still active", async () => {
		const { getByText, queryByText } = renderChatView()
		const executionId = "command-force-continue-1"
		const baseTs = Date.now() - 5000

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: baseTs,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "command",
					ts: baseTs + 1000,
					text: "python long_script.py",
					partial: false,
					isAnswered: true,
				},
				{
					type: "say",
					say: "command_output",
					ts: baseTs + 2000,
					text: "still running...",
					partial: false,
				},
			],
		})

		act(() => {
			window.postMessage(
				{
					type: "commandExecutionStatus",
					text: JSON.stringify({
						executionId,
						status: "started",
						command: "python long_script.py",
					}),
				},
				"*",
			)
		})

		await waitFor(() => {
			expect(getByText("chat:proceedWhileRunning.title")).toBeInTheDocument()
			expect(getByText("chat:killCommand.title")).toBeInTheDocument()
		})

		// Simulate force-continue: a brand-new model request starts after the command.
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: baseTs,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "command",
					ts: baseTs + 1000,
					text: "python long_script.py",
					partial: false,
					isAnswered: true,
				},
				{
					type: "say",
					say: "command_output",
					ts: baseTs + 2000,
					text: "still running...",
					partial: false,
				},
				{
					type: "say",
					say: "api_req_started",
					ts: baseTs + 3000,
					// No cost means the new model turn is actively streaming.
					text: JSON.stringify({ apiProtocol: "openai" }),
				},
				{
					type: "say",
					say: "reasoning",
					ts: baseTs + 3100,
					text: "thinking about next steps...",
					partial: true,
				},
			],
		})

		await waitFor(() => {
			expect(getByText("chat:cancel.title")).toBeInTheDocument()
		})

		// The new API turn must not stay stuck without a pause/cancel control.
		expect(queryByText("chat:cancel.title")).toBeInTheDocument()
	})

	it("keeps recovery controls after a tool/model error instead of freezing the chat", async () => {
		const { getByTestId, getByText } = renderChatView()

		mockPostMessage({
			clineMessages: [
				{ type: "say", say: "task", ts: Date.now() - 2000, text: "Initial task" },
				{ type: "say", say: "error", ts: Date.now() - 1000, text: "tool call failed", partial: false },
			],
		})

		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
			expect(getByText("chat:resumeTask.title")).toBeInTheDocument()
			expect(getByText("chat:startNewTask.title")).toBeInTheDocument()
		})

		vi.mocked(vscode.postMessage).mockClear()
		fireEvent.click(getByText("chat:resumeTask.title"))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "askResponse",
			askResponse: "yesButtonClicked",
		})
	})

	it("keeps the composer interactive after soft completion while typed feedback continues the task", async () => {
		const { getByTestId, queryByText } = renderChatView()

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "completion_result",
					ts: Date.now() - 1000,
					text: "Done with previous work",
					partial: false,
				},
			],
		})

		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		expect(queryByText("chat:startNewTask.title")).not.toBeInTheDocument()
		expect(queryByText("chat:proceedWhileRunning.title")).not.toBeInTheDocument()
		expect(queryByText("chat:cancel.title")).not.toBeInTheDocument()

		vi.mocked(vscode.postMessage).mockClear()

		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement

		await act(async () => {
			fireEvent.change(input, { target: { value: "add this as a new incomplete task" } })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "messageResponse",
				text: "add this as a new incomplete task",
				images: [],
			})
		})

		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "terminalOperation" }))
	})

	it("does not treat ordinary text rows as command_output waits after soft completion", async () => {
		const { getByTestId, queryByText } = renderChatView()

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 3000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "completion_result",
					ts: Date.now() - 2000,
					text: "Done with previous work",
					partial: false,
				},
				{
					type: "say",
					say: "text",
					ts: Date.now() - 1000,
					text: "Follow-up assistant text after soft completion",
					partial: false,
				},
			],
		})

		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Ordinary settled text must not fake a command Continue button.
		expect(queryByText("chat:proceedWhileRunning.title")).not.toBeInTheDocument()

		vi.mocked(vscode.postMessage).mockClear()

		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement

		await act(async () => {
			fireEvent.change(input, { target: { value: "add this as a new incomplete task" } })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "messageResponse",
				text: "add this as a new incomplete task",
				images: [],
			})
		})

		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "terminalOperation" }))
	})

	it("starts a new task from the home/history list screen even when sendingDisabled is sticky", async () => {
		const { getByTestId } = renderChatView()

		// No active conversation: this is the home / recent-task-list screen.
		mockPostMessage({
			clineMessages: [],
		})

		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Simulate sticky busy state that previously swallowed first messages as askResponse.
		await act(async () => {
			const event = new MessageEvent("message", {
				data: {
					type: "state",
					state: {
						clineMessages: [],
						taskHistory: [],
						shouldShowAnnouncement: false,
						apiConfiguration: { apiProvider: "anthropic" },
						currentTaskItem: undefined,
					},
				},
			})
			window.dispatchEvent(event)
		})

		vi.mocked(vscode.postMessage).mockClear()

		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement

		await act(async () => {
			fireEvent.change(input, { target: { value: "start brand new work from home" } })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "newTask",
				text: "start brand new work from home",
				images: [],
			})
		})

		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "askResponse" }))
	})

	it("starts a new task from the home screen even if a previous shell is still marked active", async () => {
		const { getByTestId } = renderChatView()

		// Seed a live shell from a previous task, then return to the empty home screen.
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "previous task with shell",
				},
			],
			currentTaskItem: { id: "task-prev", number: 1, ts: Date.now() - 2000 },
		})

		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		await act(async () => {
			const event = new MessageEvent("message", {
				data: {
					type: "commandExecutionStatus",
					text: JSON.stringify({
						executionId: "stale-shell-1",
						status: "started",
						pid: 4242,
						command: "sleep 999",
					}),
				},
			})
			window.dispatchEvent(event)
		})

		// Navigate back to home / task list (no messages, no current task).
		mockPostMessage({
			clineMessages: [],
			currentTaskItem: undefined,
		})

		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		vi.mocked(vscode.postMessage).mockClear()

		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement

		await act(async () => {
			fireEvent.change(input, { target: { value: "brand new home instruction after stale shell" } })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "newTask",
				text: "brand new home instruction after stale shell",
				images: [],
			})
		})

		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "terminalOperation" }))
		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "askResponse" }))
	})

	it("does not demote mid-task typed text to terminal continue after a fresher API request starts", async () => {
		const { getByTestId } = renderChatView()
		const now = Date.now()

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: now - 4000,
					text: "work in progress",
				},
				{
					type: "ask",
					ask: "command",
					ts: now - 3000,
					text: "long running command",
					partial: false,
					isAnswered: true,
				},
				{
					type: "say",
					say: "command_output",
					ts: now - 2000,
					text: "partial output",
					partial: false,
				},
				{
					// Force-continue already started a new model turn.
					type: "say",
					say: "api_req_started",
					ts: now - 1000,
					text: JSON.stringify({ request: "streaming", tokensIn: 10 }),
					partial: false,
				},
			],
			currentTaskItem: { id: "task-mid", number: 2, ts: now - 4000 },
		})

		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Shell still tracked as active after force-continue.
		await act(async () => {
			const event = new MessageEvent("message", {
				data: {
					type: "commandExecutionStatus",
					text: JSON.stringify({
						executionId: "shell-still-active",
						status: "output",
						output: "still running",
					}),
				},
			})
			window.dispatchEvent(event)
		})

		vi.mocked(vscode.postMessage).mockClear()

		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement

		await act(async () => {
			fireEvent.change(input, { target: { value: "actual new mid-task instruction" } })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "messageResponse",
				text: "actual new mid-task instruction",
				images: [],
			})
		})

		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "terminalOperation" }))
	})
})

describe("ChatView - Context Condensing Indicator Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should add a condensing message to groupedMessages when isCondensing is true", async () => {
		// This test verifies that when the condenseTaskContextStarted message is received,
		// the isCondensing state is set to true and a synthetic condensing message is added
		// to the grouped messages list
		const { getByTestId, container } = renderChatView()

		// First hydrate state with an active task
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "api_req_started",
					ts: Date.now() - 1000,
					text: JSON.stringify({ apiProtocol: "anthropic" }),
				},
			],
		})

		// Wait for component to render
		await waitFor(() => {
			expect(getByTestId("chat-view")).toBeInTheDocument()
		})

		// Allow time for useEvent hook to register message listener
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10))
		})

		// Dispatch a MessageEvent directly to trigger the message handler
		// This simulates the VSCode extension sending a message to the webview
		await act(async () => {
			const event = new MessageEvent("message", {
				data: {
					type: "condenseTaskContextStarted",
					text: "test-task-id",
				},
			})
			window.dispatchEvent(event)
			// Wait for React state updates
			await new Promise((resolve) => setTimeout(resolve, 0))
		})

		// Check that groupedMessages now includes a condensing message
		// With Virtuoso mocked, items render directly and we can find the ChatRow with partial condense_context message
		await waitFor(
			() => {
				const rows = container.querySelectorAll('[data-testid="chat-row"]')
				// Check for the actual message structure: partial condense_context message
				const condensingRow = Array.from(rows).find((row) => {
					const text = row.textContent || ""
					return text.includes('"say":"condense_context"') && text.includes('"partial":true')
				})
				expect(condensingRow).toBeTruthy()
			},
			{ timeout: 2000 },
		)
	})
})
