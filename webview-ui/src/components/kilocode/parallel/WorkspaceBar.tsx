import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import type { ParallelWorkspace } from "@roo-code/types"

const basename = (path: string) =>
	path
		.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.filter(Boolean)
		.pop() ?? path

const folderForWorkspace = (workspace: ParallelWorkspace, cwd?: string) => workspace.folderPath || cwd || workspace.path

/**
 * Chat header workspace bar (kilocode_change): shows the current folder and
 * workspace names only. Create/switch controls live on the left folder rail.
 */
export const WorkspaceBar = () => {
	const { t } = useAppTranslation()
	const {
		cwd,
		parallelFolders,
		parallelWorkspaces,
		parallelActiveWorkspace,
		parallelConversations,
		parallelActiveConversationId,
	} = useExtensionState()

	const activeConversation = (parallelConversations ?? []).find((c) => c.id === parallelActiveConversationId)
	const activePath: string =
		parallelActiveWorkspace ?? activeConversation?.workspacePath ?? activeConversation?.folderPath ?? cwd ?? ""
	const activeWorkspace = (parallelWorkspaces ?? []).find((ws) => ws.path === activePath)
	const folderPath =
		activeConversation?.folderPath ??
		(activeWorkspace ? folderForWorkspace(activeWorkspace, cwd) : undefined) ??
		(parallelFolders ?? []).find((folder) => folder.path === activePath)?.path ??
		cwd
	const folderName =
		(parallelFolders ?? []).find((folder) => folder.path === folderPath)?.name ?? basename(folderPath || "")
	const workspaceName = activeWorkspace ? activeWorkspace.name : t("chat:parallel.mainWorkspace")

	return (
		<div
			data-testid="workspace-bar"
			className="flex items-center gap-2 px-3 py-1 border-b border-vscode-panel-border text-xs shrink-0">
			<span className="codicon codicon-folder text-vscode-descriptionForeground" />
			<span className="font-medium truncate max-w-[45%]" title={folderPath}>
				{folderName}
			</span>
			<span className="codicon codicon-repo text-vscode-descriptionForeground" />
			<span
				className="truncate text-vscode-descriptionForeground"
				title={activeWorkspace?.branch ?? workspaceName}>
				{activeWorkspace ? `${workspaceName} · ${activeWorkspace.branch}` : workspaceName}
			</span>
		</div>
	)
}
