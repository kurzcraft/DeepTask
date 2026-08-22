import { useMemo } from "react"
import type { ClineMessage } from "@roo-code/types"

import { StandardTooltip } from "@/components/ui"
import { cn } from "@/lib/utils"

interface UserMessageRailProps {
	/** The rendered message list; rail indices map to positions in this list. */
	messages: ClineMessage[]
	onJump: (index: number) => void
	className?: string
}

/**
 * Scrollbar-like quick-jump rail for user messages (kilocode_change).
 * One marker per user-sent message, positioned proportionally along the
 * conversation. Hovering a tick shows the full message to the right of the
 * strip; clicking scrolls the chat to that user message.
 */
export const UserMessageRail = ({ messages, onJump, className }: UserMessageRailProps) => {
	const userMessages = useMemo(
		() =>
			messages
				.map((message, index) => ({ message, index }))
				.filter(
					({ message }) =>
						message.type === "say" && message.say === "user_feedback" && message.partial !== true,
				),
		[messages],
	)

	if (userMessages.length === 0) {
		return null
	}

	const last = userMessages[userMessages.length - 1]

	return (
		<div
			data-testid="user-message-rail"
			className={cn(
				"relative w-2.5 shrink-0 self-stretch min-h-0",
				"border-r border-vscode-panel-border/60 bg-vscode-sideBar-background/40",
				className,
			)}>
			{userMessages.map(({ message, index }) => {
				const top = Math.min(100, Math.max(0, (index / Math.max(1, messages.length - 1)) * 100))
				return (
					<StandardTooltip
						key={message.ts}
						side="right"
						sideOffset={8}
						content={
							<div className="max-w-[360px] whitespace-pre-wrap break-words text-left text-xs">
								{message.text?.slice(0, 2000) || "(empty message)"}
							</div>
						}>
						<button
							aria-label="Jump to user message"
							onClick={() => onJump(index)}
							className="group absolute left-0 right-0 h-3 -translate-y-1/2 flex items-center justify-center"
							style={{ top: `${top}%` }}
							data-testid="user-message-rail-tick">
							<span
								className={cn(
									"w-1.5 h-3 rounded-sm",
									"bg-vscode-descriptionForeground/70",
									"group-hover:bg-vscode-focusBorder group-hover:h-4 group-hover:w-2",
									message === last.message && "bg-vscode-focusBorder/70",
								)}
							/>
						</button>
					</StandardTooltip>
				)
			})}
		</div>
	)
}
