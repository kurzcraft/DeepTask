import { McpHub } from "../../../services/mcp/McpHub"

export function getCapabilitiesSection(cwd: string, mcpHub?: McpHub): string {
	return `====

CAPABILITIES

- Tools: execute CLI, list files, search, read/write files, ask follow-up questions.
- Initial tasks include a recursive workspace file list in environment_details ('${cwd}'). Use list_files for paths outside the workspace (recursive=true for nested, false for top-level).
- execute_command runs in a new VS Code terminal. Follow RELIABLE COMMAND EXECUTION (script-first, EXTRA/bash + EXTRA/output). Interactive/long-running commands are allowed; the user may keep them in the background.${
		mcpHub
			? `
- You have access to MCP servers that may provide additional tools and resources. Each server may provide different capabilities that you can use to accomplish tasks more effectively.
`
			: ""
	}`
}
