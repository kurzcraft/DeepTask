import { useCallback, useMemo, useRef, useState } from "react"
import { Virtuoso } from "react-virtuoso"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import ChatRow from "@/components/chat/ChatRow"
import { UserMessageRail } from "./UserMessageRail"
import { cn } from "@/lib/utils"

interface ParallelSessionPanelProps {
	/** Session id ("sa-…") or workspace panel id ("ws:<name>"). */
	selectedId: string
	onClose: () => void
}

/**
 * Fixed docked right pane for a parallel subagent conversation or workspace
 * (kilocode_change). It is a permanent layout sibling of the main chat column,
 * not a floating popup: opening it narrows the main chat, closing (collapsing)
 * restores full width. Subagent transcripts render with the exact same ChatRow
 * components as the main chat (integrated terminal output included).
 */
export const ParallelSessionPanel = ({ selectedId, onClose }: ParallelSessionPanelProps) => {
	const { t } = useAppTranslation()
	const { parallelSessions, parallelSessionMessages, parallelWorkspaces } = useExtensionState()
	const [expanded, setExpanded] = useState<Set<number>>(new Set())
	const [pinnedJumpTs, setPinnedJumpTs] = useState<number | null>(null)
	const virtuosoRef = useRef<any>(null)
	const pinnedJumpTsRef = useRef<number | null>(null)

	const session = selectedId.startsWith("ws:") ? undefined : parallelSessions?.[selectedId]
	const workspaceName = selectedId.startsWith("ws:") ? selectedId.slice(3) : session?.workspaceName
	const workspace = parallelWorkspaces?.find((w) => w.name === workspaceName)
	const messages = useMemo(
		() => (session ? (parallelSessionMessages?.[session.sessionId] ?? []) : []),
		[session, parallelSessionMessages],
	)

	const scrollToPinnedMessage = useCallback(() => {
		const ts = pinnedJumpTsRef.current
		if (ts == null) {
			return
		}
		const index = messages.findIndex((message) => message.ts === ts)
		if (index < 0) {
			return
		}
		virtuosoRef.current?.scrollToIndex({ index, align: "end", behavior: "auto" })
	}, [messages])

	const handleJump = (index: number) => {
		const ts = messages[index]?.ts ?? null
		pinnedJumpTsRef.current = ts
		setPinnedJumpTs(ts)
		scrollToPinnedMessage()
		window.requestAnimationFrame(() => scrollToPinnedMessage())
	}

	return (
		<div
			data-testid="parallel-session-panel"
			className="w-[420px] shrink-0 flex flex-col min-h-0 bg-vscode-sideBar-background border-l border-vscode-panel-border">
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2 border-b border-vscode-panel-border shrink-0">
				<span className={cn("codicon", session ? "codicon-hub" : "codicon-repo")} />
				<div className="flex-1 min-w-0">
					<div className="text-sm font-medium truncate">
						{session?.label ?? workspace?.name ?? selectedId}
					</div>
					<div className="text-xs text-vscode-descriptionForeground truncate">
						{session
							? `${t(`chat:parallel.status.${session.status}`)}${
									session.workspaceName
										? ` · ${t("chat:parallel.workspace")}: ${session.workspaceName}`
										: ""
								}`
							: workspace
								? `${t(`chat:parallel.workspaceStatus.${workspace.status}`)} · ${workspace.branch}`
								: ""}
					</div>
				</div>
				{session?.status === "running" && (
					<button
						aria-label={t("chat:parallel.stop")}
						title={t("chat:parallel.stop")}
						className="codicon codicon-debug-stop p-1 rounded hover:bg-vscode-list-hoverBackground"
						data-testid="parallel-session-stop"
						onClick={() => vscode.postMessage({ type: "parallelSession.stop", text: session.sessionId })}
					/>
				)}
				<button
					aria-label={t("chat:parallel.close")}
					title={t("chat:parallel.close")}
					className="codicon codicon-chevron-right p-1 rounded hover:bg-vscode-list-hoverBackground"
					data-testid="parallel-session-close"
					onClick={onClose}
				/>
			</div>

			{/* Body */}
			{session ? (
				<div className="flex-1 flex flex-row min-h-0">
					<UserMessageRail
						messages={messages}
						onJump={handleJump}
						className="border-r border-vscode-panel-border"
					/>
					<Virtuoso
						ref={virtuosoRef}
						className="flex-1 overflow-y-auto"
						data={messages}
						initialTopMostItemIndex={Math.max(0, messages.length - 1)}
						followOutput={pinnedJumpTs != null ? false : "smooth"}
						totalListHeightChanged={() => {
							if (pinnedJumpTsRef.current != null) {
								scrollToPinnedMessage()
							}
						}}
						itemContent={(index, message) => (
							<ChatRow
								key={message.ts}
								message={message}
								isExpanded={expanded.has(message.ts)}
								isLast={index === messages.length - 1}
								isStreaming={index === messages.length - 1 && session.status === "running"}
								onToggleExpand={(ts: number) =>
									setExpanded((prev) => {
										const next = new Set(prev)
										if (next.has(ts)) {
											next.delete(ts)
										} else {
											next.add(ts)
										}
										return next
									})
								}
								onHeightChange={() => {}}
								editable={false}
							/>
						)}
					/>
				</div>
			) : workspace ? (
				<div className="flex-1 overflow-y-auto p-3 text-xs space-y-2">
					<div className="text-sm font-medium">{workspace.name}</div>
					<div className="font-mono break-all text-vscode-descriptionForeground">{workspace.path}</div>
					<div>
						{t("chat:parallel.branch")}: <span className="font-mono">{workspace.branch}</span>
					</div>
					<div>
						{t("chat:parallel.baseBranch")}: <span className="font-mono">{workspace.baseBranch}</span>
					</div>
					<div>
						{t("chat:parallel.workspaceStatusLabel")}:{" "}
						{t(`chat:parallel.workspaceStatus.${workspace.status}`)}
						{workspace.owner ? ` · ${workspace.owner}` : ""}
					</div>
					<div className="text-vscode-descriptionForeground">{t("chat:parallel.workspaceHint")}</div>
				</div>
			) : (
				<div className="flex-1 flex items-center justify-center text-xs text-vscode-descriptionForeground">
					{t("chat:parallel.notFound")}
				</div>
			)}

			{/* Footer: task + result summary */}
			{session && (
				<div className="px-3 py-2 border-t border-vscode-panel-border shrink-0 max-h-32 overflow-y-auto">
					<div className="text-xs text-vscode-descriptionForeground whitespace-pre-wrap break-words">
						{session.status === "running" ? session.task : session.result || session.error || session.task}
					</div>
				</div>
			)}
		</div>
	)
}
