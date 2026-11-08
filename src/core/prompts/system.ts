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

Format: first non-empty line MUST be exactly \`<!-- deeptask-task-id:<instance-id> -->\` (HTML comment, not YAML/heading/fence). Example \`<!-- deeptask-task-id:example-instance-id -->\` is illustrative only—never copy it. Then optional title + exactly one Markdown checklist: \`- [ ]\` pending, \`- [-]\` in progress, \`- [x]\` completed. Write the file, read it back, and verify marker/checklist/order/status/hierarchy before any native TODO call. Host never creates or silently repairs the first file; it only validates and projects. Never add a \`deeptask-native-todo-list\` section or a second mirrored checklist.

Identity: recovered marker+path are persistent. The current host task ID is only a candidate-discovery key, never permission to rewrite a recovered marker. If a native todo request is stale, restore from the authoritative file; do not rewrite the marker. Unavailable/ambiguous binding is a model-visible error—repair the file/binding before retrying. One active checklist per conversation: later executable requests (distinct objectives, feedback, corrections, continuations, title changes, restorations, edited resends) reuse that file/path/marker and append an agent-authored milestone. New instance ID only after the prior checklist is fully completed and archived. Never reuse an archived instance ID. An archived file records only that its own work is finished; it never permits ignoring a later request.

Location: look in EXTRA/task/ first; create there for non-trivial work; never in the workspace root. Name from a filesystem-safe title (e.g. DEEPTASK_RELEASE_VALIDATION_PROGRESS.md), not an opaque id. Context compression, auto-continuation, restoration, ordinary feedback, and edited resends are not new task starts.

Limits: every EXTRA/task Markdown file (root pointer AND light files) ≤30 lines and ≤4 nesting levels. Host-enforced growth gate, not a freeze: overflowing writes are rejected; shrinks/status-only updates on an over-limit file are allowed until under cap. Overflow is never solved by stopping writes, omitting milestones, or freezing. Split first: create EXTRA/task/<short-title>/, move overflow into light files there (same cap; split again if needed). (1) exactly one authoritative checklist, a direct EXTRA/task/*.md child, the only file with deeptask-task-id; (2) light files MUST NOT contain deeptask-task-id; (3) daily progress only in light files; (4) root pointer keeps current cell / falsification line / child paths; (5) completed light file → one-sentence conclusion on root, then archive to EXTRA/task/finished/; (6) never create a second authoritative checklist.

Hierarchy: indent children by 4 spaces per level. Append children under their parent; do not make a separate file merely for substeps.

Work items: treat direct requests, defect reports, negative feedback, and fix/improve requests as executable even if phrased as a question. Pure acknowledgement/confirmation/clarification/status-only must not create an item. If an ambiguous question later confirms a defect, convert it into a milestone before further work. File-first hard gate: add a concise agent-authored milestone (never copy the user verbatim), write the complete file, read it back, verify projection, THEN call native TODO with an exact top-to-bottom projection (order, text, status, indentation depth). Any write/read-back/marker/projection/native-TODO failure is a model-visible error; stop only the current substep.

Track independently verifiable subtasks, not tool calls. Mark in_progress before starting; mark completed after verification; sync both stores. Do not batch status transitions. Multiple tools in one subtask do not need repeated progress-file writes. Timeouts, API failures, rejected commits/pushes/releases become explicit checklist errors with a durable log and bounded recovery. Update promptly on tool failure, blockers, plan changes, or new user feedback.

Before completion, every checklist item must be done, then move the Markdown to EXTRA/task/finished/. Completion is prohibited while any Markdown outside EXTRA/task/finished/ has pending/in-progress items; this postpones only current-work completion and must never ignore a later user request.

Sync invariant: plain feedback reuses the focused file and must not create a new file or top-level todo. After every actionable user message: milestone in the file first, then native TODO from that exact checklist.`
}

function getReliableCommandExecutionInstructions(): string {
	return `====

RELIABLE COMMAND EXECUTION

All commands are script-first and durably logged:

- MANDATORY SCRIPT-FIRST RULE: every command, long or short, MUST first be written to a script file under the current workspace's \`EXTRA/bash/\` directory (create the directory when needed) and then executed by running that script with a short one-line command. Multi-line commands, heredocs, inline python -c / node -e programs, JSON/YAML/SQL payloads, and nested quoting layers must NEVER be sent directly to execute_command. This rule is not a suggestion and applies to every command. HARD LIMIT: if execute_command's command parameter has more than 2 physical lines (real LF/CRLF/CR; a trailing newline is not an extra line; the two-character sequence \\n is not a newline), the tool immediately returns an error with no approval wait, terminal, or execution — write EXTRA/bash/ and retry with a one-line script invocation.
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
${getRulesSection(cwd, settings, clineProviderState, true /* kilocode_change: complete command section below */)}

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
	omitTaskProgressFileInstructions: clineProviderState?.taskProgressFileEnabled === true, // kilocode_change
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
				omitTaskProgressFileInstructions: clineProviderState?.taskProgressFileEnabled === true, // kilocode_change
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
