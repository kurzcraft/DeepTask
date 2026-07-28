import * as vscode from "vscode"
import * as os from "os"

import {
	type ModeConfig,
	type PromptComponent,
	type CustomModePrompts,
	type TodoItem,
	getEffectiveProtocol,
	isNativeProtocol,
	Experiments, // kilocode_change
} from "@roo-code/types"

import { customToolRegistry, formatXml } from "@roo-code/core"

import { Mode, modes, defaultModeSlug, getModeBySlug, getGroupName, getModeSelection } from "../../shared/modes"
import { DiffStrategy } from "../../shared/tools"
import { formatLanguage } from "../../shared/language"
import { isEmpty } from "../../utils/object"
import { McpHub } from "../../services/mcp/McpHub"
import { CodeIndexManager } from "../../services/code-index/manager"
import { SkillsManager } from "../../services/skills/SkillsManager"

import { PromptVariables, loadSystemPromptFile } from "./sections/custom-system-prompt"

import type { SystemPromptSettings } from "./types"
import { getToolDescriptionsForMode } from "./tools"
import {
	getRulesSection,
	getSystemInfoSection,
	getObjectiveSection,
	getSharedToolUseSection,
	getMcpServersSection,
	getToolUseGuidelinesSection,
	getCapabilitiesSection,
	getModesSection,
	addCustomInstructions,
	markdownFormattingSection,
	getSkillsSection,
} from "./sections"
import { type ClineProviderState } from "../webview/ClineProvider" // kilocode_change

// Helper function to get prompt component, filtering out empty objects
export function getPromptComponent(
	customModePrompts: CustomModePrompts | undefined,
	mode: string,
): PromptComponent | undefined {
	const component = customModePrompts?.[mode]
	// Return undefined if component is empty
	if (isEmpty(component)) {
		return undefined
	}
	return component
}

// kilocode_change start - Task progress file instructions
function getTaskProgressFileInstructions(): string {
	return `====

TASK PROGRESS FILE

When starting a task, first look in the current workspace's EXTRA/task/ directory for an existing Markdown progress file whose name clearly matches the task. If it exists, read it and use it to restore prior progress. If it does not exist and the task is non-trivial, create a concise task-specific Markdown progress file under EXTRA/task/ before making substantive changes, creating the directory when needed. Do not create task progress files in the workspace root.

The progress file should contain a short checklist of milestones, current findings, decisions, blockers, and verification status. Update it whenever a milestone is completed or the plan changes, so another session can resume the task from that file. This keeps cross-session task state alongside long-command scripts in EXTRA/bash/ and durable command output in EXTRA/output/.`
}

function getReliableCommandExecutionInstructions(): string {
	return `====

RELIABLE COMMAND EXECUTION

Keep terminal calls short, observable, and recoverable:

- A command is considered long or complex if it contains multiple chained operations, a heredoc, an inline multi-line program, extensive quoting, or is expected to run for more than about 30 seconds or produce substantial output.
- Never send a long or complex command directly to execute_command. First create its task-specific script under the current workspace's \`EXTRA/bash/\` directory with write_to_file or edit_file (creating that directory when needed), then execute that script with a short command.
- Every long-running script must persist complete stdout and stderr to a task-specific log file under the current workspace's \`EXTRA/output/\` directory (creating that directory when needed) while also emitting useful live output when practical (for example with tee and pipefail on bash).
- Print the log file path and final exit status. After execution returns, use read_file to inspect the saved log instead of depending only on terminal streaming.
- Do not use inline heredocs, nested shell programs, or very long command chains in execute_command; put that content in the script file.
- For commands that intentionally remain running (servers, watchers, training), start them through a script with durable logging, state that they are long-running, and inspect the log file in later steps.
- If terminal output is empty, truncated, delayed, or the completion status is uncertain, do not blindly rerun the operation. Read the durable log and any generated status file first.`
}
// kilocode_change end

async function generatePrompt(
	context: vscode.ExtensionContext,
	cwd: string,
	supportsComputerUse: boolean,
	mode: Mode,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	browserViewportSize?: string,
	promptComponent?: PromptComponent,
	customModeConfigs?: ModeConfig[],
	globalCustomInstructions?: string,
	diffEnabled?: boolean,
	experiments?: Record<string, boolean>,
	enableMcpServerCreation?: boolean,
	language?: string,
	rooIgnoreInstructions?: string,
	partialReadsEnabled?: boolean,
	settings?: SystemPromptSettings,
	todoList?: TodoItem[],
	modelId?: string,
	skillsManager?: SkillsManager,
	clineProviderState?: ClineProviderState, // kilocode_change
): Promise<string> {
	if (!context) {
		throw new Error("Extension context is required for generating system prompt")
	}

	// If diff is disabled, don't pass the diffStrategy
	const effectiveDiffStrategy = diffEnabled ? diffStrategy : undefined

	// Get the full mode config to ensure we have the role definition (used for groups, etc.)
	const modeConfig = getModeBySlug(mode, customModeConfigs) || modes.find((m) => m.slug === mode) || modes[0]
	const { roleDefinition, baseInstructions } = getModeSelection(mode, promptComponent, customModeConfigs)

	// Check if MCP functionality should be included
	const hasMcpGroup = modeConfig.groups.some((groupEntry) => getGroupName(groupEntry) === "mcp")
	const hasMcpServers = mcpHub && mcpHub.getServers().length > 0
	const shouldIncludeMcp = hasMcpGroup && hasMcpServers

	const codeIndexManager = CodeIndexManager.getInstance(context, cwd)

	// Determine the effective protocol (defaults to 'xml')
	const effectiveProtocol = getEffectiveProtocol(settings?.toolProtocol)

	const [modesSection, mcpServersSection, skillsSection] = await Promise.all([
		getModesSection(context),
		shouldIncludeMcp
			? getMcpServersSection(
					mcpHub,
					effectiveDiffStrategy,
					enableMcpServerCreation,
					!isNativeProtocol(effectiveProtocol),
				)
			: Promise.resolve(""),
		getSkillsSection(skillsManager, mode as string),
	])

	// Build tools catalog section only for XML protocol
	const builtInToolsCatalog = isNativeProtocol(effectiveProtocol)
		? ""
		: `\n\n${getToolDescriptionsForMode(
				mode,
				cwd,
				supportsComputerUse,
				codeIndexManager,
				effectiveDiffStrategy,
				browserViewportSize,
				shouldIncludeMcp ? mcpHub : undefined,
				customModeConfigs,
				experiments,
				partialReadsEnabled,
				settings,
				enableMcpServerCreation,
				modelId,
				clineProviderState, // kilocode_change
			)}`

	let customToolsSection = ""

	if (experiments?.customTools && !isNativeProtocol(effectiveProtocol)) {
		const customTools = customToolRegistry.getAllSerialized()

		if (customTools.length > 0) {
			customToolsSection = `\n\n${formatXml(customTools)}`
		}
	}

	const toolsCatalog = builtInToolsCatalog + customToolsSection

	const basePrompt = `${roleDefinition}

${markdownFormattingSection()}

${getSharedToolUseSection(effectiveProtocol, experiments)}${toolsCatalog}

${getToolUseGuidelinesSection(effectiveProtocol, experiments)}

${mcpServersSection}

${getCapabilitiesSection(cwd, shouldIncludeMcp ? mcpHub : undefined)}

${modesSection}
${skillsSection ? `\n${skillsSection}` : ""}
${getRulesSection(cwd, settings, clineProviderState /* kilocode_change */)}

${getSystemInfoSection(cwd)}

${getReliableCommandExecutionInstructions()}

${getObjectiveSection()}

${await addCustomInstructions(baseInstructions, globalCustomInstructions || "", cwd, mode, {
	language: language ?? formatLanguage(vscode.env.language),
	rooIgnoreInstructions,
	localRulesToggleState: context.workspaceState.get("localRulesToggles"), // kilocode_change
	globalRulesToggleState: context.globalState.get("globalRulesToggles"), // kilocode_change
	settings,
})}`

	// kilocode_change start: Append custom system prompt from CLI if provided
	const appendSystemPrompt = clineProviderState?.appendSystemPrompt
	if (appendSystemPrompt) {
		return `${basePrompt}\n\n${appendSystemPrompt}`
	}
	// kilocode_change end

	return basePrompt
}

export const SYSTEM_PROMPT = async (
	context: vscode.ExtensionContext,
	cwd: string,
	supportsComputerUse: boolean,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	browserViewportSize?: string,
	inputMode: Mode = defaultModeSlug, // kilocode_change: name changed to inputMode
	customModePrompts?: CustomModePrompts,
	customModes?: ModeConfig[],
	globalCustomInstructions?: string,
	diffEnabled?: boolean,
	experiments?: Experiments, // kilocode_change: type
	enableMcpServerCreation?: boolean,
	language?: string,
	rooIgnoreInstructions?: string,
	partialReadsEnabled?: boolean,
	settings?: SystemPromptSettings,
	todoList?: TodoItem[],
	modelId?: string,
	skillsManager?: SkillsManager,
	clineProviderState?: ClineProviderState, // kilocode_change
): Promise<string> => {
	if (!context) {
		throw new Error("Extension context is required for generating system prompt")
	}

	const mode =
		getModeBySlug(inputMode, customModes)?.slug || modes.find((m) => m.slug === inputMode)?.slug || defaultModeSlug // kilocode_change: don't try to use non-existent modes

	// Try to load custom system prompt from file
	const variablesForPrompt: PromptVariables = {
		workspace: cwd,
		mode: mode,
		language: language ?? formatLanguage(vscode.env.language),
		shell: vscode.env.shell,
		operatingSystem: os.type(),
	}
	const fileCustomSystemPrompt = await loadSystemPromptFile(cwd, mode, variablesForPrompt)

	// Check if it's a custom mode
	const promptComponent = getPromptComponent(customModePrompts, mode)

	// Get full mode config from custom modes or fall back to built-in modes
	const currentMode = getModeBySlug(mode, customModes) || modes.find((m) => m.slug === mode) || modes[0]

	// If a file-based custom system prompt exists, use it
	if (fileCustomSystemPrompt) {
		const { roleDefinition, baseInstructions: baseInstructionsForFile } = getModeSelection(
			mode,
			promptComponent,
			customModes,
		)

		const customInstructions = await addCustomInstructions(
			baseInstructionsForFile,
			globalCustomInstructions || "",
			cwd,
			mode,
			{
				language: language ?? formatLanguage(vscode.env.language),
				rooIgnoreInstructions,
				settings,
			},
		)

		// For file-based prompts, don't include the tool sections
		let prompt = `${roleDefinition}

${fileCustomSystemPrompt}

${customInstructions}`

		// kilocode_change start - Task progress file instructions
		if (clineProviderState?.taskProgressFileEnabled) {
			prompt += `\n\n${getTaskProgressFileInstructions()}`
		}
		// kilocode_change end

		return prompt
	}

	// If diff is disabled, don't pass the diffStrategy
	const effectiveDiffStrategy = diffEnabled ? diffStrategy : undefined

	let prompt = await generatePrompt(
		context,
		cwd,
		supportsComputerUse,
		currentMode.slug,
		mcpHub,
		effectiveDiffStrategy,
		browserViewportSize,
		promptComponent,
		customModes,
		globalCustomInstructions,
		diffEnabled,
		experiments,
		enableMcpServerCreation,
		language,
		rooIgnoreInstructions,
		partialReadsEnabled,
		settings,
		todoList,
		modelId,
		skillsManager,
		clineProviderState, // kilocode_change
	)

	// kilocode_change start - Task progress file instructions
	if (clineProviderState?.taskProgressFileEnabled) {
		prompt += `\n\n${getTaskProgressFileInstructions()}`
	}
	// kilocode_change end

	return prompt
}
