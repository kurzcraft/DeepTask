import { DiffStrategy } from "../../../shared/tools"
import { McpHub } from "../../../services/mcp/McpHub"
import { Experiments, ProviderSettingsEntry } from "@roo-code/types"

export type ToolArgs = {
	cwd: string
	supportsComputerUse: boolean
	diffStrategy?: DiffStrategy
	browserViewportSize?: string
	mcpHub?: McpHub
	toolOptions?: any
	partialReadsEnabled?: boolean
	settings?: Record<string, any>
	providerProfiles?: ProviderSettingsEntry[] // kilocode_change
	/** Whether the switch_provider_profile tool is visible (kilocode_change). */
	providerProfileSwitchEnabled?: boolean
	experiments?: Partial<Experiments>
}
