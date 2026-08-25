import { useEffect, useMemo, useRef, useState } from "react"
import type { ParallelConversation, ParallelFolder, ParallelSession, ParallelWorkspace } from "@roo-code/types"
import { PARALLEL_MAIN_WORKSPACE } from "@roo-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { StandardTooltip } from "@/components/ui"
import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"

const RAIL_WIDTH_KEY = "deeptask.parallelRailWidth"
const RAIL_MIN_WIDTH = 160
const RAIL_MAX_WIDTH = 420
const RAIL_DEFAULT_WIDTH = 208

interface ParallelRailProps {
	sessions: ParallelSession[]
	workspaces: ParallelWorkspace[]
	folders: ParallelFolder[]
	conversations: ParallelConversation[]
	activeConversationId?: string | null
	currentFolderPath?: string | null
	selectedId?: string | null
	onSelect: (id: string) => void
}

const sessionStatusColor: Record<string, string> = {
	running: "bg-vscode-charts-blue animate-pulse",
	completed: "bg-vscode-charts-green",
	error: "bg-vscode-charts-red",
	cancelled: "bg-vscode-descriptionForeground/50",
}

const workspaceStatusColor: Record<string, string> = {
	available: "bg-vscode-charts-green",
	busy: "bg-vscode-charts-blue animate-pulse",
	merged: "bg-vscode-charts-purple",
	conflicted: "bg-vscode-charts-red",
	error: "bg-vscode-charts-red",
}

const itemClass = (active: boolean) =>
	cn(
		"w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer text-left min-w-0",
		active
			? "bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground"
			: "hover:bg-vscode-list-hoverBackground text-vscode-foreground",
	)

const conversationWorkspacePath = (conversation: ParallelConversation) =>
	conversation.workspacePath ?? conversation.folderPath

const RunningRadialSpinner = () => (
	<span
		data-testid="parallel-conversation-running"
		aria-hidden="true"
		className="relative w-3 h-3 shrink-0">
		<span className="absolute inset-0 rounded-full border border-vscode-descriptionForeground/30" />
		<span className="absolute inset-0 rounded-full border-2 border-transparent border-t-vscode-charts-blue animate-spin" />
	</span>
)

const sessionWorkspacePath = (session: ParallelSession, folders: ParallelFolder[]) => {
	if (session.workspacePath) {
		return session.workspacePath
	}
	if (session.workspaceName) {
		return folders.find((folder) => folder.path.endsWith(`/${session.workspaceName}`))?.path
	}
	return undefined
}

const parentFolderForSession = (session: ParallelSession, folders: ParallelFolder[]) => {
	const workspacePath = sessionWorkspacePath(session, folders)
	if (!workspacePath) {
		return undefined
	}
	const posix = workspacePath.replace(/\\/g, "/")
	const marker = "/.kilocode/worktrees"
	const idx = posix.indexOf(marker)
	if (idx > 0) {
		const parent = posix.slice(0, idx)
		return workspacePath.includes("\\") ? parent.replace(/\//g, "\\") : parent
	}
	return folders.find((folder) => folder.path === workspacePath)?.path
}

const parentFolderForWorkspace = (workspace: ParallelWorkspace, folders: ParallelFolder[]) => {
	if (workspace.folderPath) {
		return workspace.folderPath
	}
	const posix = workspace.path.replace(/\\/g, "/")
	const marker = "/.kilocode/worktrees"
	const idx = posix.indexOf(marker)
	if (idx > 0) {
		const parent = posix.slice(0, idx)
		return workspace.path.includes("\\") ? parent.replace(/\//g, "\\") : parent
	}
	return folders.find((folder) => folder.path === workspace.path)?.path
}

/** Hover-revealed row action (kilocode_change). */
const RowAction = ({
	icon,
	label,
	testId,
	onClick,
}: {
	icon: string
	label: string
	testId: string
	onClick: () => void
}) => (
	<StandardTooltip content={label}>
		<button
			aria-label={label}
			data-testid={testId}
			className={cn(
				"codicon p-0.5 rounded text-vscode-descriptionForeground hover:text-vscode-foreground",
				"hover:bg-vscode-list-hoverBackground",
				icon,
			)}
			onClick={(e) => {
				e.preventDefault()
				e.stopPropagation()
				onClick()
			}}
		/>
	</StandardTooltip>
)

/**
 * Fixed left sidebar: folders, then workspaces, then conversations
 * (kilocode_change). Folder/workspace titles start a new conversation; only the
 * chevron expands or collapses the nested list.
 */
export const ParallelRail = ({
	sessions,
	workspaces,
	folders,
	conversations,
	activeConversationId,
	currentFolderPath,
	selectedId,
	onSelect,
}: ParallelRailProps) => {
	const { t } = useAppTranslation()
	const [showArchived, setShowArchived] = useState(false)
	const [renamingId, setRenamingId] = useState<string | null>(null)
	const [renameDraft, setRenameDraft] = useState("")
	const [creatingForFolder, setCreatingForFolder] = useState<string | null>(null)
	const [workspaceName, setWorkspaceName] = useState("")
	const renameInputRef = useRef<HTMLInputElement>(null)
	const createInputRef = useRef<HTMLInputElement>(null)
	const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
	const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(new Set())
	const [unreadConversationIds, setUnreadConversationIds] = useState<Set<string>>(new Set())
	const didStartupCollapse = useRef(false)
	const seenRunningRef = useRef<Set<string>>(new Set())
	const [railWidth, setRailWidth] = useState(() => {
		try {
			const stored = Number(window.localStorage.getItem(RAIL_WIDTH_KEY))
			if (Number.isFinite(stored) && stored >= RAIL_MIN_WIDTH && stored <= RAIL_MAX_WIDTH) {
				return stored
			}
		} catch {
			// localStorage unavailable in some test environments
		}
		return RAIL_DEFAULT_WIDTH
	})
	const dragState = useRef<{ startX: number; startWidth: number } | null>(null)
	const railWidthRef = useRef(railWidth)
	railWidthRef.current = railWidth

	const runningConversationIds = useMemo(() => {
		const ids = new Set<string>()
		for (const conversation of conversations) {
			if (!conversation.sessionId) {
				continue
			}
			if (
				sessions.some(
					(session) =>
						session.status === "running" &&
						(session.sessionId === conversation.sessionId || session.taskId === conversation.sessionId),
				)
			) {
				ids.add(conversation.id)
			}
		}
		return ids
	}, [conversations, sessions])
	const runningConversationKey = [...runningConversationIds].sort().join("|")

	useEffect(() => {
		if (didStartupCollapse.current) {
			return
		}
		if (folders.length === 0) {
			return
		}
		didStartupCollapse.current = true
		const active = conversations.find((conversation) => conversation.id === activeConversationId)
		const activeFolder = active?.folderPath
		const activeWorkspace = active ? conversationWorkspacePath(active) : undefined
		const currentFolder = folders.find(
			(folder) => !folder.archivedAt && folder.kind !== "worktree" && folder.path === currentFolderPath,
		)
		const newestFolder = [...folders]
			.filter((folder) => !folder.archivedAt && folder.kind !== "worktree")
			.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]
		const keepOpen = currentFolder?.path ?? activeFolder ?? newestFolder?.path
		setCollapsedFolders(
			new Set(
				folders
					.filter((folder) => !folder.archivedAt && folder.kind !== "worktree" && folder.path !== keepOpen)
					.map((folder) => folder.path),
			),
		)
		if (keepOpen) {
			setCollapsedWorkspaces((prev) => {
				const next = new Set(prev)
				for (const workspace of workspaces) {
					const parent = parentFolderForWorkspace(workspace, folders)
					if (parent !== keepOpen) {
						next.add(`${parent}::${workspace.path}`)
					} else if (activeWorkspace && workspace.path !== activeWorkspace) {
						next.add(`${parent}::${workspace.path}`)
					} else {
						next.delete(`${parent}::${workspace.path}`)
					}
				}
				if (activeWorkspace) {
					next.delete(`${keepOpen}::${activeWorkspace}`)
				}
				next.delete(`${keepOpen}::${keepOpen}`)
				return next
			})
		}
	}, [activeConversationId, conversations, currentFolderPath, folders, workspaces])

	useEffect(() => {
		const runningFolders = new Set(
			conversations.filter((conversation) => runningConversationIds.has(conversation.id)).map((c) => c.folderPath),
		)
		if (runningFolders.size === 0) {
			return
		}
		setCollapsedFolders((prev) => {
			const next = new Set(prev)
			for (const folderPath of runningFolders) {
				next.delete(folderPath)
			}
			return next
		})
		setCollapsedWorkspaces((prev) => {
			const next = new Set(prev)
			for (const conversation of conversations) {
				if (!runningConversationIds.has(conversation.id)) {
					continue
				}
				next.delete(`${conversation.folderPath}::${conversationWorkspacePath(conversation)}`)
			}
			return next
		})
	}, [conversations, runningConversationKey])

	useEffect(() => {
		setUnreadConversationIds((prev) => {
			const next = new Set(prev)
			for (const conversation of conversations) {
				const wasRunning = seenRunningRef.current.has(conversation.id)
				const isRunning = runningConversationIds.has(conversation.id)
				if (isRunning) {
					seenRunningRef.current.add(conversation.id)
				} else {
					seenRunningRef.current.delete(conversation.id)
				}
				if (conversation.id === activeConversationId) {
					next.delete(conversation.id)
					continue
				}
				if (wasRunning && !isRunning) {
					next.add(conversation.id)
				}
			}
			return next
		})
	}, [activeConversationId, conversations, runningConversationKey])

	useEffect(() => {
		const onMove = (event: MouseEvent) => {
			if (!dragState.current) {
				return
			}
			const next = Math.min(
				RAIL_MAX_WIDTH,
				Math.max(RAIL_MIN_WIDTH, dragState.current.startWidth + (event.clientX - dragState.current.startX)),
			)
			setRailWidth(next)
		}
		const onUp = () => {
			if (!dragState.current) {
				return
			}
			dragState.current = null
			document.body.style.cursor = ""
			document.body.style.userSelect = ""
			try {
				window.localStorage.setItem(RAIL_WIDTH_KEY, String(railWidthRef.current))
			} catch {
				// ignore persistence failures
			}
		}
		window.addEventListener("mousemove", onMove)
		window.addEventListener("mouseup", onUp)
		return () => {
			window.removeEventListener("mousemove", onMove)
			window.removeEventListener("mouseup", onUp)
		}
	}, [])

	const toggleSet = (prev: Set<string>, key: string) => {
		const next = new Set(prev)
		if (next.has(key)) {
			next.delete(key)
		} else {
			next.add(key)
		}
		return next
	}

	const activeFolders = folders.filter((folder) => !folder.archivedAt && folder.kind !== "worktree")
	const archivedFolders = folders.filter((folder) => folder.archivedAt)
	const activeConversations = conversations.filter((c) => !c.archivedAt)
	const archivedConversations = conversations.filter((c) => c.archivedAt)

	const startRename = (conversation: ParallelConversation) => {
		setRenamingId(conversation.id)
		setRenameDraft(conversation.title ?? "")
		requestAnimationFrame(() => renameInputRef.current?.focus())
	}

	const commitRename = () => {
		if (renamingId) {
			vscode.postMessage({
				type: "parallel.renameConversation",
				text: renamingId,
				editedMessageContent: renameDraft,
			})
		}
		setRenamingId(null)
	}

	const submitCreateWorkspace = (folderPath: string) => {
		const name = workspaceName.trim()
		if (!name) {
			return
		}
		vscode.postMessage({
			type: "parallel.createWorkspace",
			text: name,
			values: { folderPath },
		})
		setCreatingForFolder(null)
		setWorkspaceName("")
	}

	const openNewConversation = (folderPath: string, workspacePath: string) => {
		vscode.postMessage({
			type: "parallel.newConversation",
			values: { folderPath, workspacePath },
		})
	}

	const openWorkspaceOrExisting = (
		folderPath: string,
		workspacePath: string,
		nested: ParallelConversation[],
	) => {
		const existing = nested.find((conversation) => conversation.sessionId) ?? nested[0]
		if (existing) {
			onSelect(`cv:${existing.id}`)
			return
		}
		openNewConversation(folderPath, workspacePath)
	}

	const renderConversationRow = (conversation: ParallelConversation, nestedClass: string) => {
		const conversationId = `cv:${conversation.id}`
		const conversationActive = activeConversationId === conversation.id
		const label = conversation.title || t("chat:parallel.newChat")
		return (
			<div
				key={conversation.id}
				className="group relative flex items-center"
				data-testid="parallel-conversation-row">
				{renamingId === conversation.id ? (
					<input
						ref={renameInputRef}
						value={renameDraft}
						onChange={(e) => setRenameDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								commitRename()
							} else if (e.key === "Escape") {
								setRenamingId(null)
							}
							e.stopPropagation()
						}}
						onBlur={commitRename}
						data-testid="parallel-conversation-rename-input"
						className={cn("w-full px-1.5 py-0.5 rounded text-xs", nestedClass)}
					/>
				) : (
					<>
						<StandardTooltip
							content={
								<div className="max-w-[300px] text-xs">
									<div className="font-medium">{label}</div>
									<div className="opacity-70 font-mono break-all">
										{conversationWorkspacePath(conversation)}
									</div>
								</div>
							}>
							<button
								aria-label={label}
								onClick={() => onSelect(conversationId)}
								data-testid="parallel-rail-conversation"
								data-active={conversationActive}
								data-running={runningConversationIds.has(conversation.id) ? "true" : "false"}
								data-unread={unreadConversationIds.has(conversation.id) ? "true" : "false"}
								className={cn(itemClass(conversationActive), nestedClass, "pr-14")}>
								{runningConversationIds.has(conversation.id) ? (
									<RunningRadialSpinner />
								) : (
									<span className="codicon codicon-comment-discussion shrink-0" />
								)}
								<span className="truncate flex-1">{label}</span>
								{unreadConversationIds.has(conversation.id) && (
									<span
										data-testid="parallel-conversation-unread"
										className="w-1.5 h-1.5 rounded-full shrink-0 bg-vscode-charts-green"
									/>
								)}
							</button>
						</StandardTooltip>
						<div className="absolute right-1 hidden group-hover:flex items-center gap-0.5 rounded bg-vscode-sideBar-background px-0.5">
							<RowAction
								icon="codicon-copy"
								label={t("chat:parallel.fork")}
								testId="parallel-conversation-fork"
								onClick={() =>
									vscode.postMessage({ type: "parallel.forkConversation", text: conversation.id })
								}
							/>
							<RowAction
								icon="codicon-edit"
								label={t("chat:parallel.rename")}
								testId="parallel-conversation-rename"
								onClick={() => startRename(conversation)}
							/>
							<RowAction
								icon="codicon-archive"
								label={t("chat:parallel.archive")}
								testId="parallel-conversation-archive"
								onClick={() =>
									vscode.postMessage({
										type: "parallel.archiveConversation",
										text: conversation.id,
										archived: true,
									})
								}
							/>
						</div>
					</>
				)}
			</div>
		)
	}

	const renderWorkspace = (folder: ParallelFolder, workspace: ParallelWorkspace | "main") => {
		const isMain = workspace === "main"
		const workspacePath = isMain ? folder.path : workspace.path
		const workspaceName = isMain ? PARALLEL_MAIN_WORKSPACE : workspace.name
		const collapseKey = `${folder.path}::${workspacePath}`
		const collapsed = collapsedWorkspaces.has(collapseKey)
		const status = isMain ? undefined : workspace.status
		const nestedConversations = activeConversations.filter(
			(conversation) =>
				conversation.folderPath === folder.path && conversationWorkspacePath(conversation) === workspacePath,
		)
		const workspaceActive = nestedConversations.some((conversation) => conversation.id === activeConversationId)
		return (
			<div key={collapseKey} className="flex flex-col gap-0.5" data-testid="parallel-workspace-row">
				<div className="group relative flex items-center pl-3">
					<button
						aria-label={t("chat:parallel.toggleWorkspace")}
						aria-expanded={!collapsed}
						data-testid="parallel-workspace-toggle"
						className="codicon p-1 rounded text-vscode-descriptionForeground hover:bg-vscode-list-hoverBackground shrink-0"
						onClick={(event) => {
							event.stopPropagation()
							setCollapsedWorkspaces((prev) => toggleSet(prev, collapseKey))
						}}>
						<span className={cn("codicon", collapsed ? "codicon-chevron-right" : "codicon-chevron-down")} />
					</button>
					<StandardTooltip
						content={
							<div className="max-w-[320px] text-xs">
								<div className="font-medium">
									{isMain ? t("chat:parallel.mainWorkspace") : workspaceName}
								</div>
								<div className="font-mono opacity-70 break-all">{workspacePath}</div>
								{status && (
									<div className="opacity-70">{t(`chat:parallel.workspaceStatus.${status}`)}</div>
								)}
							</div>
						}>
						<button
							aria-label={isMain ? t("chat:parallel.mainWorkspace") : workspaceName}
							onClick={() => openWorkspaceOrExisting(folder.path, workspacePath, nestedConversations)}
							data-testid="parallel-rail-workspace"
							data-workspace={workspaceName}
							className={cn(itemClass(workspaceActive), "pl-1 pr-14 flex-1")}>
							<span className="codicon codicon-repo shrink-0" />
							<span className="truncate flex-1">
								{isMain ? t("chat:parallel.mainWorkspace") : workspaceName}
							</span>
							{status && (
								<span
									className={cn(
										"w-1.5 h-1.5 rounded-full shrink-0",
										workspaceStatusColor[status] ?? "bg-vscode-descriptionForeground/50",
									)}
								/>
							)}
						</button>
					</StandardTooltip>
					<div className="absolute right-1 z-20 flex items-center gap-0.5 rounded bg-vscode-sideBar-background px-0.5 pointer-events-auto">
						<RowAction
							icon="codicon-gist-fork"
							label={t("chat:parallel.forkWorkspace")}
							testId="parallel-workspace-fork"
							onClick={() =>
								vscode.postMessage({
									type: "parallel.forkWorkspace",
									text: workspaceName,
									values: { folderPath: folder.path },
								})
							}
						/>
						{!isMain && (
							<RowAction
								icon="codicon-trash"
								label={t("chat:parallel.deleteWorkspace")}
								testId="parallel-workspace-delete"
								onClick={() =>
									vscode.postMessage({
										type: "parallel.deleteWorkspace",
										text: workspaceName,
										values: { folderPath: folder.path },
									})
								}
							/>
						)}
					</div>
				</div>
				{!collapsed && nestedConversations.map((conversation) => renderConversationRow(conversation, "pl-16"))}
			</div>
		)
	}

	return (
		<div
			data-testid="parallel-rail"
			style={{ width: railWidth }}
			className="relative shrink-0 flex flex-col border-r border-vscode-panel-border bg-vscode-sideBar-background overflow-y-auto">
			<div className="flex items-center gap-1 px-2 pt-2 pb-1">
				<span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-vscode-descriptionForeground">
					{t("chat:parallel.appTitle")}
				</span>
				<StandardTooltip content={t("chat:parallel.newConversation")}>
					<button
						aria-label={t("chat:parallel.newConversation")}
						className="codicon codicon-add p-1 rounded hover:bg-vscode-list-hoverBackground"
						data-testid="parallel-new-conversation"
						onClick={() => vscode.postMessage({ type: "parallel.newConversation" })}
					/>
				</StandardTooltip>
				<StandardTooltip content={t("chat:parallel.openFolder")}>
					<button
						aria-label={t("chat:parallel.openFolder")}
						className="codicon codicon-new-folder p-1 rounded hover:bg-vscode-list-hoverBackground"
						data-testid="parallel-open-folder"
						onClick={() => vscode.postMessage({ type: "parallel.openFolder" })}
					/>
				</StandardTooltip>
			</div>

			<div className="px-1 pt-1 flex flex-col gap-0.5 pb-2">
				{activeFolders.map((folder) => {
					const folderWorkspaces = workspaces.filter(
						(workspace) => parentFolderForWorkspace(workspace, folders) === folder.path,
					)
					const folderCollapsed = collapsedFolders.has(folder.path)
					return (
						<div key={folder.path} className="flex flex-col gap-0.5">
							<div className="group relative flex items-center">
								<button
									aria-label={t("chat:parallel.toggleFolder")}
									aria-expanded={!folderCollapsed}
									data-testid="parallel-rail-folder"
									data-kind={folder.kind}
									className="codicon p-1 rounded text-vscode-descriptionForeground hover:bg-vscode-list-hoverBackground shrink-0"
									onClick={(event) => {
										event.stopPropagation()
										setCollapsedFolders((prev) => toggleSet(prev, folder.path))
									}}>
									<span
										className={cn(
											"codicon",
											folderCollapsed ? "codicon-chevron-right" : "codicon-chevron-down",
										)}
									/>
								</button>
								<StandardTooltip
									content={
										<div className="max-w-[320px] text-xs">
											<div className="font-medium">{folder.name}</div>
											<div className="font-mono opacity-70 break-all">{folder.path}</div>
										</div>
									}>
									<button
										aria-label={folder.name}
										onClick={() => openNewConversation(folder.path, folder.path)}
										data-testid="parallel-rail-folder-name"
										className={cn(itemClass(false), "pl-1 pr-14 flex-1")}>
										<span className="codicon codicon-folder shrink-0" />
										<span className="truncate flex-1">{folder.name}</span>
									</button>
								</StandardTooltip>
								<div className="absolute right-1 hidden group-hover:flex items-center gap-0.5 rounded bg-vscode-sideBar-background px-0.5">
									<RowAction
										icon="codicon-gist-new"
										label={t("chat:parallel.createWorkspace")}
										testId="parallel-folder-create-workspace"
										onClick={() => {
											setWorkspaceName("")
											setCreatingForFolder(folder.path)
											requestAnimationFrame(() => createInputRef.current?.focus())
										}}
									/>
									<RowAction
										icon="codicon-archive"
										label={t("chat:parallel.archive")}
										testId="parallel-folder-archive"
										onClick={() =>
											vscode.postMessage({
												type: "parallel.archiveFolder",
												text: folder.path,
												archived: true,
											})
										}
									/>
								</div>
							</div>
							{creatingForFolder === folder.path && (
								<div
									data-testid="parallel-folder-create-workspace-form"
									className="flex items-center gap-1 ml-6 mr-1 mb-1">
									<input
										ref={createInputRef}
										value={workspaceName}
										onChange={(e) => setWorkspaceName(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												submitCreateWorkspace(folder.path)
											} else if (e.key === "Escape") {
												setCreatingForFolder(null)
											}
											e.stopPropagation()
										}}
										placeholder={t("chat:parallel.workspaceNamePlaceholder")}
										aria-label={t("chat:parallel.workspaceNamePlaceholder")}
										data-testid="parallel-folder-create-workspace-input"
										className="flex-1 px-1.5 py-0.5 rounded text-xs bg-vscode-input-background text-vscode-inputForeground border border-vscode-inputBorder outline-none focus:border-vscode-focusBorder"
									/>
									<button
										aria-label={t("chat:parallel.createWorkspaceConfirm")}
										data-testid="parallel-folder-create-workspace-confirm"
										disabled={!workspaceName.trim()}
										className="px-1.5 py-0.5 rounded text-xs bg-vscode-buttonBackground text-vscode-buttonForeground disabled:opacity-50"
										onClick={() => submitCreateWorkspace(folder.path)}>
										{t("chat:parallel.createWorkspaceConfirm")}
									</button>
								</div>
							)}
							{!folderCollapsed && (
								<>
									{renderWorkspace(folder, "main")}
									{folderWorkspaces.map((workspace) => renderWorkspace(folder, workspace))}
								</>
							)}
						</div>
					)
				})}
			</div>

			{(archivedFolders.length > 0 || archivedConversations.length > 0) && (
				<div className="px-1 pb-3 flex flex-col gap-0.5 mt-auto">
					<button
						data-testid="parallel-archived-toggle"
						onClick={() => setShowArchived((prev) => !prev)}
						className="flex items-center gap-1 px-2 py-1 rounded text-[11px] uppercase tracking-wide text-vscode-descriptionForeground hover:bg-vscode-list-hoverBackground">
						<span
							className={cn(
								"codicon shrink-0 transition-transform",
								showArchived ? "codicon-chevron-down" : "codicon-chevron-right",
							)}
						/>
						{t("chat:parallel.archived")}
					</button>
					{showArchived && (
						<>
							{archivedFolders.map((folder) => (
								<div key={folder.path} className="group relative flex items-center">
									<button
										data-testid="parallel-archived-folder"
										className={cn(itemClass(false), "pr-8 opacity-70")}>
										<span className="codicon codicon-folder shrink-0" />
										<span className="truncate flex-1">{folder.name}</span>
									</button>
									<div className="absolute right-1 hidden group-hover:flex items-center gap-0.5 rounded bg-vscode-sideBar-background px-0.5">
										<RowAction
											icon="codicon-discard"
											label={t("chat:parallel.unarchive")}
											testId="parallel-archived-folder-unarchive"
											onClick={() =>
												vscode.postMessage({
													type: "parallel.archiveFolder",
													text: folder.path,
													archived: false,
												})
											}
										/>
									</div>
								</div>
							))}
							{archivedConversations.map((conversation) => (
								<div key={conversation.id} className="group relative flex items-center">
									<button
										data-testid="parallel-archived-conversation"
										className={cn(itemClass(false), "pr-8 opacity-70")}>
										<span className="codicon codicon-comment-discussion shrink-0" />
										<span className="truncate flex-1">
											{conversation.title || t("chat:parallel.newChat")}
										</span>
									</button>
									<div className="absolute right-1 hidden group-hover:flex items-center gap-0.5 rounded bg-vscode-sideBar-background px-0.5">
										<RowAction
											icon="codicon-discard"
											label={t("chat:parallel.unarchive")}
											testId="parallel-archived-conversation-unarchive"
											onClick={() =>
												vscode.postMessage({
													type: "parallel.archiveConversation",
													text: conversation.id,
													archived: false,
												})
											}
										/>
									</div>
								</div>
							))}
						</>
					)}
				</div>
			)}
			<div
				data-testid="parallel-rail-resize"
				role="separator"
				aria-orientation="vertical"
				aria-label={t("chat:parallel.resizeRail")}
				className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-vscode-focusBorder/50"
				onMouseDown={(event) => {
					event.preventDefault()
					dragState.current = { startX: event.clientX, startWidth: railWidth }
					document.body.style.cursor = "col-resize"
					document.body.style.userSelect = "none"
				}}
			/>
		</div>
	)
}
