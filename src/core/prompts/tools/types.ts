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
	experiments?: Partial<Experiments>
}
