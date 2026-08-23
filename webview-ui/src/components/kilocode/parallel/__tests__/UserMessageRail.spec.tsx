import { render, screen, fireEvent } from "@/utils/test-utils"
import { UserMessageRail } from "../UserMessageRail"
import type { ClineMessage } from "@roo-code/types"

const msg = (ts: number, say: string, text: string): ClineMessage =>
	({ ts, type: "say", say, text }) as unknown as ClineMessage

describe("UserMessageRail", () => {
	const onJump = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	test("renders nothing without user messages", () => {
		const { container } = render(
			<UserMessageRail messages={[msg(1, "text", "assistant output")]} onJump={onJump} />,
		)
		expect(container).toBeEmptyDOMElement()
	})

	test("renders a tick even when the only completed messages are user messages", () => {
		render(<UserMessageRail messages={[msg(1, "user_feedback", "only me")]} onJump={onJump} />)
		expect(screen.getAllByTestId("user-message-rail-tick")).toHaveLength(1)
	})

	test("renders one tick per completed user_feedback message only", () => {
		const messages = [
			msg(1, "text", "assistant"),
			msg(2, "user_feedback", "first question"),
			msg(3, "api_req_started", ""),
			msg(4, "user_feedback", "second question"),
			msg(5, "user_feedback", "streaming...") as ClineMessage,
		]
		;(messages[4] as any).partial = true

		render(<UserMessageRail messages={messages} onJump={onJump} />)
		const ticks = screen.getAllByTestId("user-message-rail-tick")
		expect(ticks).toHaveLength(2)
	})

	test("clicking a tick jumps to the message's list index", () => {
		const messages = [msg(1, "text", "hi"), msg(2, "user_feedback", "fix it"), msg(3, "text", "ok")]
		render(<UserMessageRail messages={messages} onJump={onJump} />)

		fireEvent.click(screen.getByTestId("user-message-rail-tick"))
		expect(onJump).toHaveBeenCalledWith(1)
	})

	test("renders each tick as a horizontal line instead of a vertical bar", () => {
		render(<UserMessageRail messages={[msg(1, "user_feedback", "only me")]} onJump={onJump} />)
		const line = screen.getByTestId("user-message-rail-tick").querySelector("span")
		expect(line).toHaveClass("h-px")
		expect(line).toHaveClass("w-full")
	})
})
