import { ToolArgs } from "./types"

export function getExecuteCommandDescription(args: ToolArgs): string | undefined {
	return `## execute_command
Description: Request to execute a short CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish a task step. You must tailor the command to the user's system and explain what it does. Keep execute_command calls short and observable. If an operation is long or complex (multiple chained operations, heredoc, inline multi-line code, extensive quoting, expected runtime over about 30 seconds, or substantial output), first create its script under the current workspace's \`EXTRA/bash/\` directory, make the script persist complete stdout/stderr under the current workspace's \`EXTRA/output/\` directory, and then execute only that script here. Create those directories when needed. After it returns, inspect the durable log with read_file. Never place heredocs or long inline programs directly in this tool. Prefer relative paths that avoid location sensitivity, e.g. \`touch ./testdata/example.file\` or \`go test ./cmd/front --config ./cmd/front/config.yml\`. If directed by the user, use the \`cwd\` parameter for another directory.
Parameters:
- command: (required) The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.
- cwd: (optional) The working directory to execute the command in (default: ${args.cwd})
Usage:
<execute_command>
<command>Your command here</command>
<cwd>Working directory path (optional)</cwd>
</execute_command>

Example: Requesting to execute npm run dev
<execute_command>
<command>npm run dev</command>
</execute_command>

Example: Requesting to execute ls in a specific directory if directed
<execute_command>
<command>ls -la</command>
<cwd>/home/user/projects</cwd>
</execute_command>`
}
