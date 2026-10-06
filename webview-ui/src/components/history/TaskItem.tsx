import { memo } from "react"
import type { HistoryItem } from "@roo-code/types"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"

import TaskItemFooter from "./TaskItemFooter"

interface DisplayHistoryItem extends HistoryItem {
	highlight?: string
}

interface TaskItemProps {
	item: DisplayHistoryItem
	variant: "compact" | "full"
	showWorkspace?: boolean
	isSelectionMode?: boolean
	isSelected?: boolean
	onToggleSelection?: (taskId: string, isSelected: boolean) => void
	onDelete?: (taskId: string) => void
	className?: string
	// kilocode_change start: DEFECT W — subagent badge + workspace annotation for
	// hierarchical history display.
	isSubagentItem?: boolean
	showWorkspaceLabel?: string
	// kilocode_change end
}

const TaskItem = ({
	item,
	variant,
	showWorkspace = false,
	isSelectionMode = false,
	isSelected = false,
	onToggleSelection,
	onDelete,
	className,
	// kilocode_change
	isSubagentItem = false,
	showWorkspaceLabel,
}: TaskItemProps) => {
	const handleClick = () => {
		if (isSelectionMode && onToggleSelection) {
			onToggleSelection(item.id, !isSelected)
		} else {
			vscode.postMessage({ type: "showTaskWithId", text: item.id })
		}
	}

	const isCompact = variant === "compact"

	return (
		<div
			key={item.id}
			data-testid={`task-item-${item.id}`}
			className={cn(
				"cursor-pointer group bg-vscode-editor-background rounded relative overflow-hidden border border-transparent hover:bg-vscode-list-hoverBackground transition-colors", // kilocode_change: no rounded borders
				className,
			)}
			onClick={handleClick}>
			<div className={(!isCompact && isSelectionMode ? "pl-3 pb-3" : "pl-4") + " flex gap-3 px-3 pt-3 pb-1"}>
				{/* Selection checkbox - only in full variant */}
				{!isCompact && isSelectionMode && (
					<div
						className="task-checkbox mt-1"
						onClick={(e) => {
							e.stopPropagation()
						}}>
						<Checkbox
							checked={isSelected}
							onCheckedChange={(checked: boolean) => onToggleSelection?.(item.id, checked === true)}
							variant="description"
						/>
					</div>
				)}

				<div className="flex-1 min-w-0">
					{/* kilocode_change start: DEFECT W — subagent badge + workspace label */}
					{(isSubagentItem || showWorkspaceLabel) && (
						<div className="flex flex-row items-center gap-1 mb-1 text-vscode-descriptionForeground">
							{isSubagentItem && (
								<span
									data-testid={`subagent-badge-${item.id}`}
									className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide border border-vscode-panel-border rounded px-1 py-px">
									<span className="codicon codicon-organization scale-75" />
									子代理
								</span>
							)}
							{showWorkspaceLabel && (
								<span className="text-[10px] truncate" data-testid={`workspace-label-${item.id}`}>
									<span className="codicon codicon-folder scale-75" /> {showWorkspaceLabel}
								</span>
							)}
						</div>
					)}
					{/* kilocode_change end */}
					<div
						className={cn(
							"overflow-hidden whitespace-pre-wrap font-light text-vscode-foreground text-ellipsis line-clamp-3",
							{
								"text-base": !isCompact,
							},
							!isCompact && isSelectionMode ? "mb-1" : "",
						)}
						data-testid="task-content"
						{...(item.highlight ? { dangerouslySetInnerHTML: { __html: item.highlight } } : {})}>
						{item.highlight ? undefined : item.task}
					</div>

					<TaskItemFooter
						item={item}
						variant={variant}
						isSelectionMode={isSelectionMode}
						onDelete={onDelete}
					/>

					{showWorkspace && item.workspace && (
						<div className="flex flex-row gap-1 text-vscode-descriptionForeground text-xs mt-1">
							<span className="codicon codicon-folder scale-80" />
							<span>{item.workspace}</span>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

export default memo(TaskItem)
