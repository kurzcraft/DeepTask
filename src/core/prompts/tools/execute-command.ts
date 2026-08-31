import { ToolArgs } from "./types"

export function getExecuteCommandDescription(args: ToolArgs): string | undefined {
	return `## execute_command
Description: Request to execute a short CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish a task step. You must tailor the command to the user's system and explain what it does. Keep execute_command calls short and observable. MANDATORY SCRIPT-FIRST RULE: every command, long or short, must first be written to a script file under the current workspace's \`EXTRA/bash/\` directory (create the directory when needed) and then executed here with a short one-line command that runs only that script. Multi-line commands, heredocs, inline python -c / node -e programs, JSON/YAML/SQL payloads, nested quoting layers, and embedded document text must NEVER be sent directly to this tool. The script must stream the execution process live to the integrated terminal and persist complete stdout/stderr under the current workspace's \`EXTRA/output/\` directory (for example with tee and pipefail on bash), printing the log file path and final exit status. After it returns, inspect the durable log with read_file. Prefer relative paths that avoid location sensitivity, e.g. \`bash ./EXTRA/bash/run_check.sh\` or \`bash ./scripts/verify.sh\`. If directed by the user, use the \`cwd\` parameter for another directory.
Parameters:
- command: (required) The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.
- cwd: (optional) The working directory to execute the command in (default: ${args.cwd})
Usage:
<execute_command>
<command>Your command here</command>
<cwd>Working directory path (optional)</cwd>
</execute_command>

Example: Requesting to execute a prepared script
<execute_command>
<command>bash EXTRA/bash/run_build.sh</command>
</execute_command>

Example: Requesting to execute a prepared script in a specific directory if directed
<execute_command>
<command>bash EXTRA/bash/check_status.sh</command>
<cwd>/home/user/projects</cwd>
</execute_command>`
}
