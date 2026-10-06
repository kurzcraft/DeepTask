import type { HistoryItem, ParallelConversation, ParallelFolder, ParallelWorkspace } from "@roo-code/types"

export const conversationWorkspacePath = (conversation: ParallelConversation) =>
	conversation.workspacePath ?? conversation.folderPath

export const parentFolderForWorkspace = (workspace: ParallelWorkspace, folderPath: string) => {
	if (workspace.folderPath) {
		return workspace.folderPath === folderPath
	}
	const posix = workspace.path.replace(/\\/g, "/")
	const marker = "/.kilocode/worktrees"
	const idx = posix.indexOf(marker)
	if (idx > 0) {
		const parent = posix.slice(0, idx)
		const expected = workspace.path.includes("\\") ? parent.replace(/\//g, "\\") : parent
		return expected === folderPath
	}
	return workspace.path === folderPath
}

export const resolveActiveFolderPath = (params: {
	cwd?: string
	parallelFolders?: ParallelFolder[]
	parallelWorkspaces?: ParallelWorkspace[]
	parallelConversations?: ParallelConversation[]
	parallelActiveConversationId?: string | null
	parallelActiveWorkspace?: string | null
}) => {
	const activeConversation = (params.parallelConversations ?? []).find(
		(conversation) => conversation.id === params.parallelActiveConversationId,
	)
	const activeWorkspace = (params.parallelWorkspaces ?? []).find(
		(workspace) => workspace.path === (params.parallelActiveWorkspace ?? params.cwd),
	)
	return (
		activeConversation?.folderPath ??
		activeWorkspace?.folderPath ??
		(params.parallelFolders ?? []).find((folder) => folder.path === (params.parallelActiveWorkspace ?? params.cwd))
			?.path ??
		params.cwd
	)
}

export const folderConversationsFor = (
	conversations: ParallelConversation[] | undefined,
	folderPath: string | undefined,
) => (conversations ?? []).filter((conversation) => !conversation.archivedAt && conversation.folderPath === folderPath)

export const workspacePathsForFolder = (
	folderPath: string | undefined,
	conversations: ParallelConversation[],
	workspaces: ParallelWorkspace[] | undefined,
) => {
	const workspacePaths = new Set<string>([folderPath ?? "", ...conversations.map(conversationWorkspacePath)])
	for (const workspace of workspaces ?? []) {
		if (folderPath && parentFolderForWorkspace(workspace, folderPath)) {
			workspacePaths.add(workspace.path)
		}
	}
	return workspacePaths
}

export const filterHistoryToFolder = (
	items: HistoryItem[],
	conversations: ParallelConversation[],
	workspacePaths: Set<string>,
) => {
	const sessionIds = new Set(
		conversations.map((conversation) => conversation.sessionId).filter((id): id is string => Boolean(id)),
	)
	// kilocode_change start: DEFECT W2 — family adoption, mirroring the backend
	// getTaskHistory filter. Isolated worktree workspaces (and their
	// conversations) are cleaned up after a subagent settles, so the
	// subagent's own workspace path drops out of workspacePaths and its
	// session out of sessionIds. A subagent passes when its parent (or root)
	// does, so it stays visible nested under its parent.
	const passesDirectly = (item: HistoryItem) =>
		sessionIds.has(item.id) || Boolean(item.workspace && workspacePaths.has(item.workspace))
	const byId = new Map(items.map((item) => [item.id, item]))
	const passesWithFamily = (item: HistoryItem, seen: Set<string>): boolean => {
		if (seen.has(item.id)) return false
		seen.add(item.id)
		if (passesDirectly(item)) return true
		const parent = item.parentTaskId ? byId.get(item.parentTaskId) : undefined
		if (parent) return passesWithFamily(parent, seen)
		const root = !parent && item.rootTaskId ? byId.get(item.rootTaskId) : undefined
		return root ? passesWithFamily(root, seen) : false
	}
	return items.filter((item) => passesWithFamily(item, new Set()))
	// kilocode_change end
}

export type FolderHistoryGroup = {
	key: string
	label: string
	path: string
	items: HistoryItem[]
}

// kilocode_change start: DEFECT W — hierarchical history rendering.
// Nest subagent history items (parentTaskId set) under their parent task so
// History shows the dispatch tree instead of a flat list. Orphans (parent not
// in the same page/workspace) stay at top level so nothing silently disappears.
export type NestedHistoryNode = {
	item: HistoryItem
	children: NestedHistoryNode[]
}

export const nestHistoryItems = (items: HistoryItem[]): NestedHistoryNode[] => {
	const byId = new Map(items.map((item) => [item.id, item]))
	const topLevel = new Map<string, NestedHistoryNode>()
	const resolveSlot = (item: HistoryItem): NestedHistoryNode => {
		const existing = topLevel.get(item.id)
		if (existing) return existing
		const parent = item.parentTaskId ? byId.get(item.parentTaskId) : undefined
		if (parent && parent.id !== item.id) {
			const parentSlot = resolveSlot(parent)
			const node: NestedHistoryNode = { item, children: [] }
			parentSlot.children.push(node)
			return node
		}
		const node: NestedHistoryNode = { item, children: [] }
		topLevel.set(item.id, node)
		return node
	}
	for (const item of items) {
		resolveSlot(item)
	}
	return [...topLevel.values()]
}
// kilocode_change end

export const groupHistoryByWorkspace = (params: {
	folderPath?: string
	folderTasks: HistoryItem[]
	folderConversations: ParallelConversation[]
	workspaces?: ParallelWorkspace[]
	mainLabel: string
}): FolderHistoryGroup[] => {
	const namedWorkspaces = (params.workspaces ?? []).filter(
		(workspace) => params.folderPath && parentFolderForWorkspace(workspace, params.folderPath),
	)
	const groups: FolderHistoryGroup[] = [
		{ key: "main", label: params.mainLabel, path: params.folderPath ?? "", items: [] },
		...namedWorkspaces.map((workspace) => ({
			key: workspace.name,
			label: workspace.name,
			path: workspace.path,
			items: [] as HistoryItem[],
		})),
	]
	const byPath = new Map(groups.map((group) => [group.path, group]))
	// kilocode_change start: DEFECT W2 — group by the item's FAMILY workspace,
	// not its own. While a worktree subagent is still RUNNING, its history item
	// carries the isolated worktree path; grouping by that path tore the
	// dispatch tree apart (parent in the main group, child in a separate
	// worktree group). Resolve the family head's workspace instead: a
	// subagent inherits its parent's (transitively, root's) group placement.
	const byId = new Map(params.folderTasks.map((item) => [item.id, item]))
	const familyWorkspaceOf = (item: HistoryItem, seen: Set<string>): string | undefined => {
		if (seen.has(item.id)) return undefined
		seen.add(item.id)
		const conversation = params.folderConversations.find((c) => c.sessionId === item.id)
		const ownPath = conversationWorkspacePath(
			conversation ?? { folderPath: params.folderPath ?? "", workspacePath: item.workspace } as ParallelConversation,
		)
		if (!item.parentTaskId) return ownPath
		const parent = byId.get(item.parentTaskId)
		if (!parent) return ownPath
		return familyWorkspaceOf(parent, seen)
	}
	// kilocode_change end
	for (const item of params.folderTasks) {
		const conversation = params.folderConversations.find((c) => c.sessionId === item.id)
		const itemPath = conversationWorkspacePath(
			conversation ??
				({
					folderPath: params.folderPath ?? "",
					workspacePath: item.workspace,
				} as ParallelConversation),
		)
		// kilocode_change: DEFECT W2 — subagents follow their family head's group.
		const groupPath = item.parentTaskId ? familyWorkspaceOf(item, new Set()) : itemPath
		const group = byPath.get(groupPath ?? "") ?? byPath.get(params.folderPath ?? "")
		group?.items.push(item)
	}
	return groups.filter((group) => group.items.length > 0)
}
