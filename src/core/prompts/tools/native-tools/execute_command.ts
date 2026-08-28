import type OpenAI from "openai"

const EXECUTE_COMMAND_DESCRIPTION = `Request to execute a short CLI command on the system. Tailor it to the user's environment and explain its purpose. Keep calls short and observable. HARD LIMIT: a command longer than 4 lines must NEVER be sent to this tool — first write it as a script file and execute only the script with a short one-line command. Commands containing embedded document text, nested quoting layers, JSON/YAML/SQL payloads, heredocs, or unusual data pipelines that can hang the terminal must also be written as script files first. For any long or complex operation (multiple chained operations, extensive quoting, expected runtime over about 30 seconds, or substantial output), first create its script under the current workspace's EXTRA/bash/ directory, make it persist complete stdout/stderr under the current workspace's EXTRA/output/ directory, and execute only that script here. Create those directories when needed. Then inspect the saved log with read_file. Prefer relative paths for terminal consistency.

Parameters:
- command: (required) The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.
- cwd: (optional) The working directory to execute the command in

Example: Executing npm run dev
{ "command": "npm run dev", "cwd": null }

Example: Executing ls in a specific directory if directed
{ "command": "ls -la", "cwd": "/home/user/projects" }

Example: Using relative paths
{ "command": "touch ./testdata/example.file", "cwd": null }`

const COMMAND_PARAMETER_DESCRIPTION = `Short shell command to execute; long or complex work must be placed in a durable-logging script first`

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
