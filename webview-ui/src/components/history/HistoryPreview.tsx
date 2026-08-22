import { memo, useMemo } from "react"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@/context/ExtensionStateContext"

import TaskItem from "./TaskItem"
import { useTaskHistory } from "@/kilocode/hooks/useTaskHistory"
import {
	filterHistoryToFolder,
	folderConversationsFor,
	groupHistoryByWorkspace,
	resolveActiveFolderPath,
	workspacePathsForFolder,
} from "./folderHistory"

const HistoryPreview = ({ taskHistoryVersion }: { taskHistoryVersion: number } /*kilocode_change*/) => {
	const { t } = useAppTranslation()
	const {
		cwd,
		parallelFolders,
		parallelWorkspaces,
		parallelConversations,
		parallelActiveConversationId,
		parallelActiveWorkspace,
	} = useExtensionState()
	const { data } = useTaskHistory(
		{
			workspace: "all",
			sort: "newest",
			favoritesOnly: false,
			pageIndex: 0,
		},
		taskHistoryVersion,
	)
	const allTasks = data?.historyItems ?? []

	const folderPath = resolveActiveFolderPath({
		cwd,
		parallelFolders,
		parallelWorkspaces,
		parallelConversations,
		parallelActiveConversationId,
		parallelActiveWorkspace,
	})
	const folderConversations = folderConversationsFor(parallelConversations, folderPath)
	const workspacePaths = workspacePathsForFolder(folderPath, folderConversations, parallelWorkspaces)
	const folderTasks = filterHistoryToFolder(allTasks, folderConversations, workspacePaths)

	const workspaceGroups = useMemo(
		() =>
			groupHistoryByWorkspace({
				folderPath,
				folderTasks,
				folderConversations,
				workspaces: parallelWorkspaces,
				mainLabel: t("history:workspaceGroupMain"),
			}),
		[folderPath, folderTasks, folderConversations, parallelWorkspaces, t],
	)

	const handleViewAllHistory = () => {
		vscode.postMessage({ type: "switchTab", tab: "history" })
	}

	return (
		<div className="flex flex-col gap-1">
			<div className="flex flex-wrap items-center justify-between mt-4 mb-2">
				<h2 className="font-semibold text-lg grow m-0">{t("history:recentTasks")}</h2>
				<button
					onClick={handleViewAllHistory}
					className="text-base text-vscode-descriptionForeground hover:text-vscode-textLink-foreground transition-colors cursor-pointer"
					aria-label={t("history:viewAllHistory")}>
					{t("history:viewAllHistory")}
				</button>
			</div>
			{workspaceGroups.length === 0 ? (
				<p className="text-xs text-vscode-descriptionForeground m-0">{t("history:noRecentTasksInFolder")}</p>
			) : (
				workspaceGroups.map((group) => (
					<div
						key={group.key}
						data-testid={`history-workspace-group-${group.key}`}
						className="flex flex-col gap-1 mb-2">
						<div className="text-[11px] uppercase tracking-wide text-vscode-descriptionForeground px-1">
							{group.label}
						</div>
						{group.items.slice(0, 4).map((item) => (
							<TaskItem key={item.id} item={item} variant="compact" />
						))}
					</div>
				))
			)}
		</div>
	)
}

export default memo(HistoryPreview)
