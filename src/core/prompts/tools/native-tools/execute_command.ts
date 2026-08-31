import type OpenAI from "openai"

const EXECUTE_COMMAND_DESCRIPTION = `Request to execute a CLI command on the system. MANDATORY SCRIPT-FIRST RULE: every command, regardless of length, MUST first be written to a script file under the current workspace's EXTRA/bash/ directory (create the directory when needed) and then executed by running that script with a short one-line command — never send multi-line commands, heredocs, inline python -c / node -e programs, JSON/YAML/SQL payloads, or nested quoting directly to this tool. The script itself MUST stream the full execution process to the integrated terminal AND persist complete stdout and stderr (for example with tee and pipefail on bash) to a log file under the current workspace's EXTRA/output/ directory, then print the log file path and final exit status; afterwards inspect the saved log with read_file. Tailor commands to the user's environment and explain their purpose. Keep calls short and observable. Prefer relative paths for terminal consistency.

Parameters:
- command: (required) The short one-line command that runs the prepared script. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.
- cwd: (optional) The working directory to execute the command in

Example: Executing a prepared script
{ "command": "bash EXTRA/bash/run_build.sh", "cwd": null }

Example: Running the prepared script in a specific directory if directed
{ "command": "bash EXTRA/bash/check_status.sh", "cwd": "/home/user/projects" }

Example: Using relative paths
{ "command": "bash ./scripts/verify.sh", "cwd": null }`

const COMMAND_PARAMETER_DESCRIPTION = `Short one-line command that executes a prepared script file; all multi-line or complex work must be scripted under EXTRA/bash/ with durable logs under EXTRA/output/ first`

const CWD_PARAMETER_DESCRIPTION = `Optional working directory for the command, relative or absolute`

export default {
	type: "function",
	function: {
		name: "execute_command",
		description: EXECUTE_COMMAND_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: COMMAND_PARAMETER_DESCRIPTION,
				},
				cwd: {
					type: ["string", "null"],
					description: CWD_PARAMETER_DESCRIPTION,
				},
			},
			required: ["command", "cwd"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
