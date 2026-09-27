import type { LucideIcon } from "lucide-react"
import {
	Eye,
	Pencil,
	Trash2,
	Globe,
	Plug,
	RefreshCw,
	Server,
	Terminal,
	HelpCircle,
	Network,
	FolderGit2,
} from "lucide-react"
import type { GlobalSettings } from "@roo-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"
import { Button, StandardTooltip } from "@/components/ui"

// kilocode_change start: 9.2.4 removed alwaysAllowSubtasks from the panel —
// new_task is gone and dispatch_subagents approval is governed by
// agentSubagentDispatchEnabled (capability) + alwaysAllowSubtasks (approval)
// internally, so a second "Subagents" card duplicated the capability toggle.
type AutoApproveToggles = Pick<
	GlobalSettings,
	| "alwaysAllowReadOnly"
	| "alwaysAllowWrite"
	| "alwaysAllowDelete" // kilocode_change
	| "alwaysAllowBrowser"
	| "alwaysAllowMcp"
	| "alwaysAllowModeSwitch"
	| "alwaysAllowProviderProfileSwitch" // kilocode_change
	| "alwaysAllowExecute"
	| "alwaysAllowFollowupQuestions"
	// kilocode_change start: parallel subagents & workspaces
	| "agentSubagentDispatchEnabled"
	| "agentWorkspaceManagementEnabled"
	// kilocode_change end
>

export type AutoApproveSetting = keyof AutoApproveToggles

type AutoApproveConfig = {
	key: AutoApproveSetting
	labelKey: string
	descriptionKey: string
	icon: LucideIcon
	testId: string
}

export const autoApproveSettingsConfig: Record<AutoApproveSetting, AutoApproveConfig> = {
	alwaysAllowReadOnly: {
		key: "alwaysAllowReadOnly",
		labelKey: "settings:autoApprove.readOnly.label",
		descriptionKey: "settings:autoApprove.readOnly.description",
		icon: Eye,
		testId: "always-allow-readonly-toggle",
	},
	alwaysAllowWrite: {
		key: "alwaysAllowWrite",
		labelKey: "settings:autoApprove.write.label",
		descriptionKey: "settings:autoApprove.write.description",
		icon: Pencil,
		testId: "always-allow-write-toggle",
	},
	// kilocode_change start
	alwaysAllowDelete: {
		key: "alwaysAllowDelete",
		labelKey: "settings:autoApprove.delete.label",
		descriptionKey: "settings:autoApprove.delete.description",
		icon: Trash2,
		testId: "always-allow-delete-toggle",
	},
	// kilocode_change end
	alwaysAllowBrowser: {
		key: "alwaysAllowBrowser",
		labelKey: "settings:autoApprove.browser.label",
		descriptionKey: "settings:autoApprove.browser.description",
		icon: Globe,
		testId: "always-allow-browser-toggle",
	},
	alwaysAllowMcp: {
		key: "alwaysAllowMcp",
		labelKey: "settings:autoApprove.mcp.label",
		descriptionKey: "settings:autoApprove.mcp.description",
		icon: Plug,
		testId: "always-allow-mcp-toggle",
	},
	alwaysAllowModeSwitch: {
		key: "alwaysAllowModeSwitch",
		labelKey: "settings:autoApprove.modeSwitch.label",
		descriptionKey: "settings:autoApprove.modeSwitch.description",
		icon: RefreshCw,
		testId: "always-allow-mode-switch-toggle",
	},
	// kilocode_change start
	alwaysAllowProviderProfileSwitch: {
		key: "alwaysAllowProviderProfileSwitch",
		labelKey: "settings:autoApprove.providerProfileSwitch.label",
		descriptionKey: "settings:autoApprove.providerProfileSwitch.description",
		icon: Server,
		testId: "always-allow-provider-profile-switch-toggle",
	},
	// kilocode_change end
	alwaysAllowExecute: {
		key: "alwaysAllowExecute",
		labelKey: "settings:autoApprove.execute.label",
		descriptionKey: "settings:autoApprove.execute.description",
		icon: Terminal,
		testId: "always-allow-execute-toggle",
	},
	alwaysAllowFollowupQuestions: {
		key: "alwaysAllowFollowupQuestions",
		labelKey: "settings:autoApprove.followupQuestions.label",
		descriptionKey: "settings:autoApprove.followupQuestions.description",
		icon: HelpCircle,
		testId: "always-allow-followup-questions-toggle",
	},
	// kilocode_change start: parallel subagents & workspaces permission bar toggles
	agentSubagentDispatchEnabled: {
		key: "agentSubagentDispatchEnabled",
		labelKey: "settings:autoApprove.parallel.subagents.toggle",
		descriptionKey: "settings:autoApprove.parallel.subagents.description",
		icon: Network,
		testId: "agent-subagent-dispatch-toggle",
	},
	agentWorkspaceManagementEnabled: {
		key: "agentWorkspaceManagementEnabled",
		labelKey: "settings:autoApprove.parallel.workspaces.toggle",
		descriptionKey: "settings:autoApprove.parallel.workspaces.description",
		icon: FolderGit2,
		testId: "agent-workspace-management-toggle",
	},
	// kilocode_change end
}

type AutoApproveToggleProps = AutoApproveToggles & {
	onToggle: (key: AutoApproveSetting, value: boolean) => void
}

export const AutoApproveToggle = ({ onToggle, ...props }: AutoApproveToggleProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-row flex-wrap gap-2 py-2")}>
			{Object.values(autoApproveSettingsConfig).map(({ key, descriptionKey, labelKey, icon: Icon, testId }) => (
				<StandardTooltip key={key} content={t(descriptionKey || "")}>
					<Button
						variant={props[key] ? "primary" : "secondary"}
						onClick={() => onToggle(key, !props[key])}
						aria-label={t(labelKey)}
						aria-pressed={!!props[key]}
						data-testid={testId}
						className={cn("gap-1.5 text-xs whitespace-nowrap", !props[key] && "opacity-50")}>
						<Icon className="size-3.5 flex-shrink-0" />
						<span>{t(labelKey)}</span>
					</Button>
				</StandardTooltip>
			))}
		</div>
	)
}
