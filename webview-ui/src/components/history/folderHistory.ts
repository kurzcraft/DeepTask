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
	return items.filter(
		(item) => sessionIds.has(item.id) || Boolean(item.workspace && workspacePaths.has(item.workspace)),
	)
}

export type FolderHistoryGroup = {
	key: string
	label: string
	path: string
	items: HistoryItem[]
}

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
	for (const item of params.folderTasks) {
		const conversation = params.folderConversations.find((c) => c.sessionId === item.id)
		const itemPath = conversationWorkspacePath(
			conversation ??
				({
					folderPath: params.folderPath ?? "",
					workspacePath: item.workspace,
				} as ParallelConversation),
		)
		const group = byPath.get(itemPath) ?? byPath.get(params.folderPath ?? "")
		group?.items.push(item)
	}
	return groups.filter((group) => group.items.length > 0)
}
