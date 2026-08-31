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
function getTaskProgressFileInstructions(taskId?: string): string {
	const firstTaskMarker = taskId
		? `For this active task, the host task ID is \`${taskId}\`. If no matching active file exists, the first new file MUST begin with exactly \`<!-- deeptask-task-id:${taskId} -->\`; do not guess or invent this value.`
		: "The active host task ID is unavailable in this prompt preview; do not invent a marker value."

	return `====

TASK PROGRESS FILE

${firstTaskMarker}

Canonical file format (mandatory; this is not YAML frontmatter): the first non-empty line must be exactly \`<!-- deeptask-task-id:<instance-id> -->\`, for example \`<!-- deeptask-task-id:example-instance-id -->\`. The example value is illustrative only and must never be copied into a real task file. Do not put \`deeptask-task-id\` inside \`---\` YAML delimiters, a heading, or a code fence. After the marker, write an optional title and exactly one ordinary Markdown checklist. Use \`- [ ]\` for pending, \`- [-]\` for in progress, and \`- [x]\` for completed. The model MUST write this file, then read it back and verify its marker, checklist, order, statuses, and hierarchy before any native TODO tool call. The host never creates or silently repairs the first task file at the native TODO boundary; it only validates the already-written file and projects it into native state. Never add a \`deeptask-native-todo-list\` section or any second mirrored checklist. A recovered file's marker and path are persistent instance identity: never replace, normalize, or regenerate them from the current host task ID or runtime instance ID. The current host task ID is only a candidate-discovery key; it is never permission to rewrite a recovered marker. When continuing or restoring work, use the existing file and its exact marker. If a native todo request is stale, the host restores the native list from the authoritative file without failing the task; do not rewrite the marker or repeat the same stale request. A genuinely unavailable or ambiguous binding is an immediate model-visible error: record the failure in the file and repair the file/binding boundary before retrying. A conversation has one active checklist instance: every later executable request in the same conversation must reuse the existing file, path, and marker, then append an agent-authored milestone to that file. Create a new instance ID only when no active checklist exists for the conversation, such as after the prior checklist has been fully completed and archived.

When starting a task, first look in the current workspace's EXTRA/task/ directory for an existing Markdown progress file whose name clearly matches the task. If it exists, read it and use it to restore prior progress. If it does not exist and the task is non-trivial, create a concise task-specific Markdown progress file under EXTRA/task/ before making substantive changes, creating the directory when needed. The HTML marker deeptask-task-id identifies one task-checklist instance, not the whole conversation. The first checklist may use the host task ID. Every later executable request in the same conversation, including a distinct objective, feedback, correction, continuation, title change, context restoration, or edited resend, must reuse the focused active file and its exact marker and append new agent-authored milestones to its existing checklist. Never create a second active checklist file while the conversation already has one; never rewrite its marker from a later host or runtime task ID; never reuse an archived instance ID. Name a genuinely new task file from a concise, filesystem-safe form of its task title (for example, DEEPTASK_RELEASE_VALIDATION_PROGRESS.md), never an opaque generated identifier, but create it only when the conversation has no active checklist because the prior instance was fully completed and archived. Do not create task progress files in the workspace root. Context compression, automatic continuation, restoration, ordinary user feedback, and edited resends within an existing task are not new task starts: retain the already-loaded context and do not repeat task-start actions such as querying Obsidian or other long-term memory. An archived file records only that its own work is finished; it never permits ignoring a later request, which starts a new checklist instance only after confirming there is no active file.

The progress file is durable cross-session state, not a running activity log. Keep one task's evolving checklist in its same Markdown file. For work that needs decomposition, use clearly visible hierarchical indentation: indent each direct child by four spaces, each grandchild by eight spaces, and continue in four-space increments. Append subtask checklist children below their parent item; do not create a separate progress file merely for substeps. For every user message, first judge whether it creates concrete executable work. Treat direct requests, defect reports, negative feedback about behavior, and requests to fix or improve something as executable work even when phrased as a question or short correction. Pure acknowledgement, confirmation, clarification, answer, or status-only messages must not create a task item. If analysis of an initially ambiguous question confirms a defect that should be fixed, immediately convert that conclusion into an agent-authored milestone before further explanation or tool work. If a message creates work, first add a concise agent-authored milestone to the focused task Markdown (never copy the user's message verbatim), write the complete file, read it back, and verify the marker and checklist projection. Only after all three file operations succeed may you call the native expandable todo list, using an exact top-to-bottom projection of the saved file. This ordering is a hard gate. If any file write, read-back, marker check, projection check, or native TODO call fails, emit a concrete model-visible error, persist the failure in durable output, and stop only the current substep; never wait, silently retry, or continue with unsynchronized state. Preserve item order, text, status, and indentation-derived depth; do not omit completed items, reorder or summarize items, or add extra items. Track work at the smallest independently verifiable subtask granularity, not at individual tool-call granularity: before starting a subtask, immediately mark its exact checklist item in_progress; after that subtask's implementation and verification succeed, immediately mark the exact item completed and synchronize both stores before beginning unrelated work. Never batch several independently verifiable status transitions into one later update merely for convenience. Multiple tool calls within one subtask do not require repeated progress-file writes. Any command timeout, external API failure, rejected commit, failed push, or failed release upload must become an explicit checklist error with a durable log and a bounded recovery action; never leave a promise, terminal, or UI waiting indefinitely. Also update promptly when a tool fails, a blocker appears, a material decision changes the plan, or new user feedback/resend changes active work. Do not defer several completed items until the end of the task, and do not repeatedly rewrite the checklist when no item state changed. Before completion, check every checklist item in the task Markdown, then move the fully completed Markdown into EXTRA/task/finished/ to retain an archive without affecting future task acceptance. Completion is prohibited while any Markdown outside EXTRA/task/finished/ contains a pending or in-progress checklist item; this gate postpones only completion of the current work and must never suppress, reject, or ignore a later user request. Inspect and complete every open active item there, not only the in-memory todo list. Keep the file truthful and concise so a new session can resume without rereading the full transcript. This keeps cross-session task state alongside long-command scripts in EXTRA/bash/ and durable command output in EXTRA/output/.

Mandatory synchronization invariant: plain feedback must reuse the focused active file and must not create a new file or top-level todo item. Create a new file only for a distinct actionable objective. After every actionable user message, write the agent-authored milestone first, then update the native expandable todo list from that exact checklist. If either write fails, stop the current substep and surface the failure; never silently continue with an unsynchronized UI.`
}

function getReliableCommandExecutionInstructions(): string {
	return `====

RELIABLE COMMAND EXECUTION

All commands are script-first and durably logged:

- MANDATORY SCRIPT-FIRST RULE: every command, long or short, MUST first be written to a script file under the current workspace's \`EXTRA/bash/\` directory (create the directory when needed) and then executed by running that script with a short one-line command. Multi-line commands, heredocs, inline python -c / node -e programs, JSON/YAML/SQL payloads, and nested quoting layers must NEVER be sent directly to execute_command. This rule is not a suggestion and applies to every command.
- The script must stream the full execution process live to the integrated terminal AND persist complete stdout and stderr to a task-specific log file under the current workspace's \`EXTRA/output/\` directory (for example with tee and pipefail on bash).
- Print the log file path and final exit status at the end of the script. After execution returns, use read_file to inspect the saved log instead of depending only on terminal streaming.
- A command is also considered long or complex if it contains multiple chained operations, a heredoc, an inline multi-line program, extensive quoting, or is expected to run for more than about 30 seconds or produce substantial output.
- Also treat a command as complex whenever you predict that shell parsing, VSCodium terminal integration, or another host layer may escape, rewrite, interpolate, or truncate quotes, backslashes, variables, redirects, pipes, or newlines. Do not wait for the mangled command to fail.
- Create scripts with write_to_file or edit_file under \`EXTRA/bash/\`, then execute that script with a short command whose arguments do not require fragile inline escaping.
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
	taskId?: string, // kilocode_change: bind first task progress file to the host task
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
	taskId,
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
	taskId?: string, // kilocode_change: expose the host task ID for first progress-file creation
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
				taskId,
			},
		)

		// For file-based prompts, don't include the tool sections
		let prompt = `${roleDefinition}

${fileCustomSystemPrompt}

${customInstructions}`

		// kilocode_change start - Task progress file instructions
		if (clineProviderState?.taskProgressFileEnabled) {
			prompt += `\n\n${getTaskProgressFileInstructions(taskId)}`
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
		taskId,
	)

	// kilocode_change start - Task progress file instructions
	if (clineProviderState?.taskProgressFileEnabled) {
		prompt += `\n\n${getTaskProgressFileInstructions(taskId)}`
	}
	// kilocode_change end

	return prompt
}
