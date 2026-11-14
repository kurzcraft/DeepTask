import { useMemo, useState } from "react"
import type { ClineMessage } from "@roo-code/types"

import { cn } from "@/lib/utils"

export interface UserMessageRailTick {
	ts: number
	index: number
	preview: string
}

interface UserMessageRailProps {
	/** Visible rows; used only when host ticks are absent. */
	messages?: ClineMessage[]
	/** Full-history light index from the host. Preview is already capped. */
	ticks?: UserMessageRailTick[]
	/** Stored transcript length for tick placement. */
	totalCount?: number
	onJump: (ts: number) => void
	className?: string
}

function ticksFromMessages(messages: ClineMessage[]): UserMessageRailTick[] {
	const ticks: UserMessageRailTick[] = []
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index]!
		if (message.type === "say" && message.say === "user_feedback" && message.partial !== true) {
			const text = typeof message.text === "string" ? message.text.replace(/\s+/g, " ").trim() : ""
			ticks.push({
				ts: message.ts,
				index,
				preview: text || "(empty message)",
			})
		}
	}
	return ticks
}

/**
 * Scrollbar-like quick-jump rail for user messages (kilocode_change).
 * One horizontal line per user-sent message, positioned along the
 * full stored conversation. Hovering a line shows the capped preview
 * to the right of the strip; clicking jumps by timestamp inside the
 * same continuous Virtuoso list.
 *
 * Preview content is a single overlay (not a Tooltip per tick) so long
 * conversations do not mount N 2000-char tooltip trees.
 */
export const UserMessageRail = ({ messages, ticks, totalCount, onJump, className }: UserMessageRailProps) => {
	const [hoveredTs, setHoveredTs] = useState<number | null>(null)

	const userMessages = useMemo(
		() => (ticks && ticks.length > 0 ? ticks : ticksFromMessages(messages ?? [])),
		[ticks, messages],
	)

	const hovered = useMemo(
		() => (hoveredTs == null ? undefined : userMessages.find((tick) => tick.ts === hoveredTs)),
		[hoveredTs, userMessages],
	)

	if (userMessages.length === 0) {
		return null
	}

	const last = userMessages[userMessages.length - 1]
	const span = Math.max(
		1,
		(totalCount && totalCount > 0 ? totalCount : (messages?.length ?? userMessages.length)) - 1,
	)

	const minGap = 2.2
	const spacedTops: number[] = []
	for (const tick of userMessages) {
		const raw = Math.min(98, Math.max(2, (tick.index / span) * 100))
		const previous = spacedTops[spacedTops.length - 1]
		spacedTops.push(previous === undefined ? raw : Math.min(98, Math.max(raw, previous + minGap)))
	}

	const hoveredOrder = hovered ? userMessages.findIndex((tick) => tick.ts === hovered.ts) : -1
	const hoveredTop = hoveredOrder >= 0 ? spacedTops[hoveredOrder] : 8

	return (
		<div
			data-testid="user-message-rail"
			className={cn(
				"relative w-3 shrink-0 self-stretch min-h-0",
				"border-r border-vscode-panel-border/60 bg-vscode-sideBar-background/40",
				className,
			)}
			onMouseLeave={() => setHoveredTs(null)}>
			{userMessages.map((tick, order) => {
				const top = spacedTops[order]
				return (
					<button
						key={tick.ts}
						aria-label="Jump to user message"
						onClick={() => onJump(tick.ts)}
						onMouseEnter={() => setHoveredTs(tick.ts)}
						onFocus={() => setHoveredTs(tick.ts)}
						onBlur={() => setHoveredTs((current) => (current === tick.ts ? null : current))}
						className="group absolute left-0 right-0 h-2.5 -translate-y-1/2 flex items-center justify-center px-0.5"
						style={{ top: `${top}%` }}
						data-testid="user-message-rail-tick">
						<span
							className={cn(
								"block w-full h-px rounded-none",
								"bg-vscode-descriptionForeground/80",
								"group-hover:bg-vscode-focusBorder group-hover:h-0.5",
								tick === last && "bg-vscode-focusBorder/80",
							)}
						/>
					</button>
				)
			})}
			{hovered ? (
				<div
					data-testid="user-message-rail-preview"
					className="pointer-events-none absolute left-full z-20 ml-2 max-w-[360px] whitespace-pre-wrap break-words rounded border border-vscode-panel-border bg-vscode-editorHoverWidget-background px-2 py-1.5 text-left text-xs text-vscode-editorHoverWidget-foreground shadow-md"
					style={{ top: `${Math.min(88, Math.max(2, hoveredTop))}%` }}>
					{hovered.preview || "(empty message)"}
				</div>
			) : null}
		</div>
	)
}
