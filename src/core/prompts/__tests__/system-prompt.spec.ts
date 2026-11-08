// npx vitest core/prompts/__tests__/system-prompt.spec.ts

// Mock ManagedIndexer before importing anything that uses it
vi.mock("../../../services/code-index/managed/ManagedIndexer", () => ({
	ManagedIndexer: {
		getInstance: vi.fn().mockReturnValue({
			isEnabled: vi.fn().mockReturnValue(false),
			organization: null,
		}),
	},
}))

vi.mock("os", () => ({
	default: {
		homedir: () => "/home/user",
		platform: () => "linux",
		arch: () => "x64",
		type: () => "Linux",
		release: () => "5.4.0",
		hostname: () => "test-host",
		tmpdir: () => "/tmp",
		endianness: () => "LE",
		loadavg: () => [0, 0, 0],
		totalmem: () => 8589934592,
		freemem: () => 4294967296,
		cpus: () => [],
		networkInterfaces: () => ({}),
		userInfo: () => ({ username: "test", uid: 1000, gid: 1000, shell: "/bin/bash", homedir: "/home/user" }),
	},
	homedir: () => "/home/user",
	platform: () => "linux",
	arch: () => "x64",
	type: () => "Linux",
	release: () => "5.4.0",
	hostname: () => "test-host",
	tmpdir: () => "/tmp",
	endianness: () => "LE",
	loadavg: () => [0, 0, 0],
	totalmem: () => 8589934592,
	freemem: () => 4294967296,
	cpus: () => [],
	networkInterfaces: () => ({}),
	userInfo: () => ({ username: "test", uid: 1000, gid: 1000, shell: "/bin/bash", homedir: "/home/user" }),
}))

vi.mock("default-shell", () => ({
	default: "/bin/zsh",
}))

vi.mock("os-name", () => ({
	default: () => "Linux",
}))

vi.mock("fs/promises")

import * as vscode from "vscode"

import { ModeConfig } from "@roo-code/types"

import { SYSTEM_PROMPT } from "../system"
import { McpHub } from "../../../services/mcp/McpHub"
import { defaultModeSlug, modes, Mode } from "../../../shared/modes"
import "../../../utils/path"
import { addCustomInstructions } from "../sections/custom-instructions"
import { MultiSearchReplaceDiffStrategy } from "../../diff/strategies/multi-search-replace"

// Mock the sections
vi.mock("../sections/modes", () => ({
	getModesSection: vi.fn().mockImplementation(async () => `====\n\nMODES\n\n- Test modes section`),
}))

// Mock the custom instructions
vi.mock("../sections/custom-instructions", () => {
	const addCustomInstructions = vi.fn()
	return {
		addCustomInstructions,
		__setMockImplementation: (impl: any) => {
			addCustomInstructions.mockImplementation(impl)
		},
	}
})

// Set up default mock implementation
const customInstructionsMock = vi.mocked(await import("../sections/custom-instructions"))
const { __setMockImplementation } = customInstructionsMock as any
__setMockImplementation(
	async (
		modeCustomInstructions: string,
		globalCustomInstructions: string,
		cwd: string,
		mode: string,
		options?: { language?: string; rooIgnoreInstructions?: string; settings?: Record<string, any> },
	) => {
		const sections = []

		// Add language preference if provided
		if (options?.language) {
			sections.push(
				`Language Preference:\nYou should always speak and think in the "${options.language}" language.`,
			)
		}

		// Add global instructions first
		if (globalCustomInstructions?.trim()) {
			sections.push(`Global Instructions:\n${globalCustomInstructions.trim()}`)
		}

		// Add mode-specific instructions after
		if (modeCustomInstructions?.trim()) {
			sections.push(`Mode-specific Instructions:\n${modeCustomInstructions}`)
		}

		// Add rules
		const rules = []
		if (mode) {
			rules.push(`# Rules from .clinerules-${mode}:\nMock mode-specific rules`)
		}
		rules.push(`# Rules from .clinerules:\nMock generic rules`)

		if (rules.length > 0) {
			sections.push(`Rules:\n${rules.join("\n")}`)
		}

		const joinedSections = sections.join("\n\n")
		const effectiveProtocol = options?.settings?.toolProtocol || "xml"
		const skipXmlReferences = effectiveProtocol === "native"
		const toolUseRef = skipXmlReferences ? "." : " without interfering with the TOOL USE guidelines."
		return joinedSections
			? `\n====\n\nUSER'S CUSTOM INSTRUCTIONS\n\nThe following additional instructions are provided by the user, and should be followed to the best of your ability${toolUseRef}\n\n${joinedSections}`
			: ""
	},
)

// Mock vscode language
vi.mock("vscode", () => ({
	env: {
		language: "en",
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/test/path" } }],
		getWorkspaceFolder: vi.fn().mockReturnValue({ uri: { fsPath: "/test/path" } }),
	},
	window: {
		activeTextEditor: undefined,
	},
	EventEmitter: vi.fn().mockImplementation(() => ({
		event: vi.fn(),
		fire: vi.fn(),
		dispose: vi.fn(),
	})),
}))

vi.mock("../../../utils/shell", () => ({
	getShell: () => "/bin/zsh",
}))

// Create a mock ExtensionContext
const mockContext = {
	extensionPath: "/mock/extension/path",
	globalStoragePath: "/mock/storage/path",
	storagePath: "/mock/storage/path",
	logPath: "/mock/log/path",
	subscriptions: [],
	workspaceState: {
		get: () => undefined,
		update: () => Promise.resolve(),
	},
	globalState: {
		get: () => undefined,
		update: () => Promise.resolve(),
		setKeysForSync: () => {},
	},
	extensionUri: { fsPath: "/mock/extension/path" },
	globalStorageUri: { fsPath: "/mock/settings/path" },
	asAbsolutePath: (relativePath: string) => `/mock/extension/path/${relativePath}`,
	extension: {
		packageJSON: {
			version: "1.0.0",
		},
	},
} as unknown as vscode.ExtensionContext

// Instead of extending McpHub, create a mock that implements just what we need
const createMockMcpHub = (withServers: boolean = false): McpHub =>
	({
		getServers: () =>
			withServers
				? [
						{
							name: "test-server",
							disabled: false,
							resources: [{ uri: "test://resource", name: "Test Resource" }],
						},
					]
				: [],
		getMcpServersPath: async () => "/mock/mcp/path",
		getMcpSettingsFilePath: async () => "/mock/settings/path",
		dispose: async () => {},
		// Add other required public methods with no-op implementations
		restartConnection: async () => {},
		readResource: async () => ({ contents: [] }),
		callTool: async () => ({ content: [] }),
		toggleServerDisabled: async () => {},
		toggleToolAlwaysAllow: async () => {},
		isConnecting: false,
		connections: [],
	}) as unknown as McpHub

describe("SYSTEM_PROMPT", () => {
	let mockMcpHub: McpHub
	let experiments: Record<string, boolean> | undefined

	beforeEach(() => {
		// Reset experiments before each test to ensure they're disabled by default.
		experiments = {}
	})

	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(async () => {
		if (mockMcpHub) {
			await mockMcpHub.dispose()
		}
	})

	it("should maintain consistent system prompt", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsImages
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
		)

		expect(prompt).toMatchFileSnapshot("./__snapshots__/system-prompt/consistent-system-prompt.snap")
	})

	it("requires long commands to use scripts with durable output logs", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined,
			undefined,
			undefined,
			defaultModeSlug,
			undefined,
			undefined,
			undefined,
			undefined,
			experiments,
			true,
		)

		expect(prompt).toContain("RELIABLE COMMAND EXECUTION")
		expect(prompt).toContain("MANDATORY SCRIPT-FIRST RULE")
		expect(prompt).toContain("must NEVER be sent directly to execute_command")
		expect(prompt).toContain("VSCodium terminal integration")
		expect(prompt).toContain("current workspace's `EXTRA/bash/` directory")
		expect(prompt).toContain("current workspace's `EXTRA/output/` directory")
		expect(prompt).toContain("persist complete stdout and stderr to a task-specific log file")
		expect(prompt).toContain("use read_file to inspect the saved log")
		expect(prompt).toContain("Do not use inline heredocs")
		expect(prompt).toContain("HARD LIMIT")
		expect(prompt).toContain("more than 2 physical lines")
	})

	it("should include browser actions when supportsImages is true", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			true, // supportsImages
			undefined, // mcpHub
			undefined, // diffStrategy
			"1280x800", // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes,
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
		)

		expect(prompt).toMatchFileSnapshot("./__snapshots__/system-prompt/with-computer-use-support.snap")
	})

	it("should include MCP server info when mcpHub is provided", async () => {
		mockMcpHub = createMockMcpHub(true)

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			mockMcpHub, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes,
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
		)

		expect(prompt).toMatchFileSnapshot("./__snapshots__/system-prompt/with-mcp-hub-provided.snap")
	})

	it("should explicitly handle undefined mcpHub", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined, // explicitly undefined mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes,
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
		)

		expect(prompt).toMatchFileSnapshot("./__snapshots__/system-prompt/with-undefined-mcp-hub.snap")
	})

	it("should handle different browser viewport sizes", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined, // mcpHub
			undefined, // diffStrategy
			"900x600", // different viewport size
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes,
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
		)

		expect(prompt).toMatchFileSnapshot("./__snapshots__/system-prompt/with-different-viewport-size.snap")
	})

	it("should include diff strategy tool description when diffEnabled is true", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined, // mcpHub
			new MultiSearchReplaceDiffStrategy(), // Use actual diff strategy from the codebase
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			true, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
		)

		expect(prompt).toContain("apply_diff")
		expect(prompt).toMatchFileSnapshot("./__snapshots__/system-prompt/with-diff-enabled-true.snap")
	})

	it("should exclude diff strategy tool description when diffEnabled is false", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsImages
			undefined, // mcpHub
			new MultiSearchReplaceDiffStrategy(), // Use actual diff strategy from the codebase
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			false, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
		)

		expect(prompt).not.toContain("apply_diff")
		expect(prompt).toMatchFileSnapshot("./__snapshots__/system-prompt/with-diff-enabled-false.snap")
	})

	it("should exclude diff strategy tool description when diffEnabled is undefined", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined, // mcpHub
			new MultiSearchReplaceDiffStrategy(), // Use actual diff strategy from the codebase
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
		)

		expect(prompt).not.toContain("apply_diff")
		expect(prompt).toMatchFileSnapshot("./__snapshots__/system-prompt/with-diff-enabled-undefined.snap")
	})

	it("should include vscode language in custom instructions", async () => {
		// Mock vscode.env.language
		const vscode = vi.mocked(await import("vscode")) as any
		vscode.env = { language: "es" }
		// Ensure workspace mock is maintained
		vscode.workspace = {
			workspaceFolders: [
				{
					uri: {
						fsPath: "/test/path",
					},
				},
			],
			getWorkspaceFolder: vi.fn().mockReturnValue({
				uri: {
					fsPath: "/test/path",
				},
			}),
		}
		vscode.window = {
			activeTextEditor: undefined,
		}
		vscode.EventEmitter = vi.fn().mockImplementation(() => ({
			event: vi.fn(),
			fire: vi.fn(),
			dispose: vi.fn(),
		}))

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			undefined, // experiments
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
		)

		expect(prompt).toContain("Language Preference:")
		expect(prompt).toContain('You should always speak and think in the "es" language')

		// Reset mock
		vscode.env = { language: "en" }
		vscode.workspace = {
			workspaceFolders: [
				{
					uri: {
						fsPath: "/test/path",
					},
				},
			],
			getWorkspaceFolder: vi.fn().mockReturnValue({
				uri: {
					fsPath: "/test/path",
				},
			}),
		}
		vscode.window = {
			activeTextEditor: undefined,
		}
		vscode.EventEmitter = vi.fn().mockImplementation(() => ({
			event: vi.fn(),
			fire: vi.fn(),
			dispose: vi.fn(),
		}))
	})

	it("should include custom mode role definition at top and instructions at bottom", async () => {
		const modeCustomInstructions = "Custom mode instructions"

		const customModes: ModeConfig[] = [
			{
				slug: "custom-mode",
				name: "Custom Mode",
				roleDefinition: "Custom role definition",
				customInstructions: modeCustomInstructions,
				groups: ["read"] as const,
			},
		]

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			"custom-mode", // mode
			undefined, // customModePrompts
			customModes, // customModes
			"Global instructions", // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
		)

		// Role definition should be at the top
		expect(prompt.indexOf("Custom role definition")).toBeLessThan(prompt.indexOf("TOOL USE"))

		// Custom instructions should be at the bottom
		const customInstructionsIndex = prompt.indexOf("Custom mode instructions")
		const userInstructionsHeader = prompt.indexOf("USER'S CUSTOM INSTRUCTIONS")
		expect(customInstructionsIndex).toBeGreaterThan(-1)
		expect(userInstructionsHeader).toBeGreaterThan(-1)
		expect(customInstructionsIndex).toBeGreaterThan(userInstructionsHeader)
	})

	it("should use promptComponent roleDefinition when available", async () => {
		const customModePrompts = {
			[defaultModeSlug]: {
				roleDefinition: "Custom prompt role definition",
				customInstructions: "Custom prompt instructions",
			},
		}

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug as Mode, // mode
			customModePrompts, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			undefined, // experiments
			false, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
		)

		// Role definition from promptComponent should be at the top
		expect(prompt.indexOf("Custom prompt role definition")).toBeLessThan(prompt.indexOf("TOOL USE"))
		// Should not contain the default mode's role definition
		expect(prompt).not.toContain(modes[0].roleDefinition)
	})

	it("should fallback to modeConfig roleDefinition when promptComponent has no roleDefinition", async () => {
		const customModePrompts = {
			[defaultModeSlug]: {
				customInstructions: "Custom prompt instructions",
				// No roleDefinition provided
			},
		}

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug as Mode, // mode
			customModePrompts, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			undefined, // experiments
			false, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
		)

		// Should use the default mode's role definition
		expect(prompt.indexOf(modes[0].roleDefinition)).toBeLessThan(prompt.indexOf("TOOL USE"))
	})

	it("should exclude update_todo_list tool when todoListEnabled is false", async () => {
		const settings = {
			maxConcurrentFileReads: 5,
			todoListEnabled: false,
			useAgentRules: true,
			newTaskRequireTodos: false,
			toolProtocol: "xml" as const,
		}

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
			settings, // settings
		)

		// Should not contain the tool description
		expect(prompt).not.toContain("## update_todo_list")
		// Mode instructions will still reference the tool with a fallback to markdown
	})

	it("should include update_todo_list tool when todoListEnabled is true", async () => {
		const settings = {
			maxConcurrentFileReads: 5,
			todoListEnabled: true,
			useAgentRules: true,
			newTaskRequireTodos: false,
			toolProtocol: "xml" as const,
		}

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
			settings, // settings
		)

		expect(prompt).toContain("update_todo_list")
		expect(prompt).toContain("## update_todo_list")
	})

	it("should include update_todo_list tool when todoListEnabled is undefined", async () => {
		const settings = {
			maxConcurrentFileReads: 5,
			todoListEnabled: true,
			useAgentRules: true,
			newTaskRequireTodos: false,
			toolProtocol: "xml" as const,
		}

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
			settings, // settings
		)

		expect(prompt).toContain("update_todo_list")
		expect(prompt).toContain("## update_todo_list")
	})

	it("should include XML tool instructions when disableXmlToolInstructions is false (default)", async () => {
		const settings = {
			maxConcurrentFileReads: 5,
			todoListEnabled: true,
			useAgentRules: true,
			newTaskRequireTodos: false,
			toolProtocol: "xml" as const, // explicitly xml
		}

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
			settings, // settings
		)

		// Should contain XML guidance sections
		expect(prompt).toContain("TOOL USE")
		expect(prompt).toContain("XML-style tags")
		expect(prompt).toContain("<actual_tool_name>")
		expect(prompt).toContain("</actual_tool_name>")
		expect(prompt).toContain("Tool Use Guidelines")
		expect(prompt).toContain("# Tools")

		// Should contain tool descriptions with XML examples
		expect(prompt).toContain("## read_file")
		expect(prompt).toContain("<read_file>")
		expect(prompt).toContain("<path>")

		// Should be byte-for-byte compatible with default behavior
		const defaultPrompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined,
			undefined,
			undefined,
			defaultModeSlug,
			undefined,
			undefined,
			undefined,
			undefined,
			experiments,
			true,
			undefined,
			undefined,
			undefined,
			{
				maxConcurrentFileReads: 5,
				todoListEnabled: true,
				useAgentRules: true,
				newTaskRequireTodos: false,
				toolProtocol: "xml" as const,
			},
		)

		expect(prompt).toBe(defaultPrompt)
	})

	it("should include native tool instructions when toolProtocol is native", async () => {
		const settings = {
			maxConcurrentFileReads: 5,
			todoListEnabled: true,
			useAgentRules: true,
			newTaskRequireTodos: false,
			toolProtocol: "native" as const, // native protocol
		}

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
			settings, // settings
		)

		// Should contain TOOL USE section with native note
		expect(prompt).toContain("TOOL USE")
		expect(prompt).toContain("provider-native tool-calling mechanism")
		expect(prompt).toContain("Do not include XML markup or examples")

		// Should NOT contain XML-style tags or examples
		expect(prompt).not.toContain("XML-style tags")
		expect(prompt).not.toContain("<actual_tool_name>")
		expect(prompt).not.toContain("</actual_tool_name>")

		// Should contain Tool Use Guidelines section without format-specific guidance
		expect(prompt).toContain("Tool Use Guidelines")
		// Should NOT contain any protocol-specific formatting instructions
		expect(prompt).not.toContain("provider's native tool-calling mechanism")
		expect(prompt).not.toContain("XML format specified for each tool")

		// Should NOT contain # Tools catalog at all in native mode
		expect(prompt).not.toContain("# Tools")
		expect(prompt).not.toContain("## read_file")
		expect(prompt).not.toContain("## execute_command")
		expect(prompt).not.toContain("<read_file>")
		expect(prompt).not.toContain("<path>")
		expect(prompt).not.toContain("Usage:")
		expect(prompt).not.toContain("Examples:")

		// Should still contain role definition and other non-XML sections
		const codeMode = modes.find((m) => m.slug === defaultModeSlug)
		expect(prompt).toContain(codeMode!.roleDefinition)
		expect(prompt).toContain("CAPABILITIES")
		expect(prompt).toContain("RULES")
		expect(prompt).toContain("SYSTEM INFORMATION")
		expect(prompt).toContain("OBJECTIVE")
	})

	it("should default to XML tool instructions when toolProtocol is undefined", async () => {
		const settings = {
			maxConcurrentFileReads: 5,
			todoListEnabled: true,
			useAgentRules: true,
			newTaskRequireTodos: false,
			toolProtocol: "xml" as const,
		}

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
			undefined, // language
			undefined, // rooIgnoreInstructions
			undefined, // partialReadsEnabled
			settings, // settings
		)

		// Should contain XML guidance (default behavior)
		expect(prompt).toContain("TOOL USE")
		expect(prompt).toContain("XML-style tags")
		expect(prompt).toContain("<actual_tool_name>")
		expect(prompt).toContain("Tool Use Guidelines")
		expect(prompt).toContain("# Tools")
	})

	// kilocode_change start
	it("should include task progress file instructions when enabled", async () => {
		const settings = {
			maxConcurrentFileReads: 5,
			todoListEnabled: true,
			useAgentRules: true,
			newTaskRequireTodos: false,
			toolProtocol: "xml" as const,
		}

		const defaultPrompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined,
			undefined,
			undefined,
			defaultModeSlug,
			undefined,
			undefined,
			undefined,
			undefined,
			experiments,
			true,
			undefined,
			undefined,
			undefined,
			settings,
		)
		const enabledPrompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false,
			undefined,
			undefined,
			undefined,
			defaultModeSlug,
			undefined,
			undefined,
			undefined,
			undefined,
			experiments,
			true,
			undefined,
			undefined,
			undefined,
			settings,
			undefined,
			undefined,
			undefined,
			{ taskProgressFileEnabled: true } as any,
			"host-task-123",
		)

		expect(defaultPrompt).not.toContain("TASK PROGRESS FILE")
		expect(enabledPrompt).toContain("TASK PROGRESS FILE")
		expect(enabledPrompt).toContain("the host task ID is `host-task-123`")
		expect(enabledPrompt).toContain("`<!-- deeptask-task-id:host-task-123 -->`")
		expect(enabledPrompt).toContain("look in EXTRA/task/ first")
		expect(enabledPrompt).toContain("create there for non-trivial work")
		expect(enabledPrompt).toContain("never in the workspace root")
		expect(enabledPrompt).toContain("filesystem-safe title")
		expect(enabledPrompt).toContain("later executable requests")
		expect(enabledPrompt).toContain("reuse that file/path/marker")
		expect(enabledPrompt).not.toContain(
			"unique host-prefixed instance ID in the form host-task-id:work-instance-id",
		)
		expect(enabledPrompt).toContain("first non-empty line MUST be exactly")
		expect(enabledPrompt).toContain("<!-- deeptask-task-id:<instance-id> -->")
		expect(enabledPrompt).toContain("illustrative only—never copy it")
		expect(enabledPrompt).toContain("current host task ID is only a candidate-discovery key")
		expect(enabledPrompt).toContain("never permission to rewrite a recovered marker")
		expect(enabledPrompt).toContain("An archived file records only that its own work is finished")
		expect(enabledPrompt).toContain("restore from the authoritative file")
		expect(enabledPrompt).toContain("do not rewrite the marker")
		expect(enabledPrompt).toContain("Never add a `deeptask-native-todo-list` section")
		expect(enabledPrompt).toContain("verify marker/checklist/order/status/hierarchy")
		expect(enabledPrompt).toContain("THEN call native TODO")
		expect(enabledPrompt).toContain("exact top-to-bottom projection")
		expect(enabledPrompt).toContain("order, text, status, indentation depth")
		expect(enabledPrompt).toContain("indent children by 4 spaces per level")
		expect(enabledPrompt).toContain("≤30 lines and ≤4 nesting levels")
		expect(enabledPrompt).toContain("Host-enforced growth gate, not a freeze")
		expect(enabledPrompt).toContain("root pointer AND light files")
		expect(enabledPrompt).toContain("Overflow is never solved by stopping writes")
		expect(enabledPrompt).toContain("Split first")
		expect(enabledPrompt).toContain("create EXTRA/task/<short-title>/")
		expect(enabledPrompt).toContain("split again if needed")
		expect(enabledPrompt).not.toContain("stop appending deep children to the root file")
		expect(enabledPrompt).toContain("light files MUST NOT contain deeptask-task-id")
		expect(enabledPrompt).not.toContain("about >80 lines")
		expect(enabledPrompt).not.toContain("longer than 80 lines")
		expect(enabledPrompt).toContain("every checklist item must be done")
		expect(enabledPrompt).toContain("ordinary feedback, and edited resends are not new task starts")
		expect(enabledPrompt).toContain("independently verifiable subtasks, not tool calls")
		expect(enabledPrompt).toContain("Multiple tools in one subtask do not need repeated progress-file writes")
		expect(enabledPrompt).toContain("Do not batch status transitions")
		expect(enabledPrompt).toContain("move the Markdown to EXTRA/task/finished/")
		expect(enabledPrompt).toContain(
			"any Markdown outside EXTRA/task/finished/ has pending/in-progress items",
		)
		expect(enabledPrompt).toContain("Update promptly on tool failure, blockers, plan changes")
		expect(enabledPrompt).toContain("current workspace's `EXTRA/bash/` directory")
		expect(enabledPrompt).toContain("current workspace's `EXTRA/output/` directory")
	})
	// kilocode_change end

	// kilocode_change start - use the real custom-instruction assembler for deduplication.
	it.each([false, true])("preserves user rules and emits one host block (file override: %s)", async (override) => {
		const actual = await vi.importActual<typeof import("../sections/custom-instructions")>(
			"../sections/custom-instructions",
		)
		vi.mocked(addCustomInstructions).mockImplementationOnce(actual.addCustomInstructions)
		const loader = await import("../sections/custom-system-prompt")
		const loadSpy = vi
			.spyOn(loader, "loadSystemPromptFile")
			.mockResolvedValueOnce(override ? "CUSTOM OVERRIDE: preserve this verbatim" : "")
		const userRules = "USER RULE repeated verbatim. USER RULE repeated verbatim."
		try {
			const prompt = await SYSTEM_PROMPT(
				mockContext,
				"/test/path",
				false,
				undefined,
				undefined,
				undefined,
				defaultModeSlug,
				undefined,
				undefined,
				userRules,
				undefined,
				{},
				false,
				"en",
				undefined,
				undefined,
				{
					maxConcurrentFileReads: 5,
					todoListEnabled: true,
					useAgentRules: false,
					newTaskRequireTodos: false,
					taskProgressFileEnabled: true,
					toolProtocol: "native",
				},
				undefined,
				undefined,
				undefined,
				{ taskProgressFileEnabled: true } as any,
				"host-dedup-id",
			)
			expect(prompt).toContain(userRules)
			expect(prompt.split("first non-empty line MUST be exactly")).toHaveLength(2)
			expect(prompt).toContain("<!-- deeptask-task-id:host-dedup-id -->")
			expect(prompt).toContain("read it back, and verify marker/checklist/order/status/hierarchy")
			expect(prompt).toContain("indent children by 4 spaces per level")
			expect(prompt).toContain("stale")
			expect(prompt).toContain("EXTRA/task/finished/")
			if (override) {
				expect(prompt).toContain("CUSTOM OVERRIDE: preserve this verbatim")
			} else {
				expect(prompt).toContain("RELIABLE COMMAND EXECUTION")
				expect(prompt).toContain("more than 2 physical lines")
				expect(prompt).not.toContain("SCRIPT-FIRST COMMAND RULE:")
			}
		} finally {
			loadSpy.mockRestore()
		}
	})
	// kilocode_change end

	afterAll(() => {
		vi.restoreAllMocks()
	})
})
