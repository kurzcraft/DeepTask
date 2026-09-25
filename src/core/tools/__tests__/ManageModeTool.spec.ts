// kilocode_change - new file: tests for ManageModeTool (create / copy -1 -2 suffix / update / switch / list)
import { describe, it, expect, vi, beforeEach } from "vitest"

import { manageModeTool } from "../ManageModeTool"
import { getAllModes } from "../../../shared/modes"
import type { Task } from "../../task/Task"
import type { ToolCallbacks } from "../BaseTool"
import type { ModeConfig } from "@roo-code/types"

vi.mock("vscode", () => ({ window: {} }))

function makeTask(overrides: Record<string, unknown> = {}): Task {
	return {
		taskId: "t1",
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		recordToolError: vi.fn(),
		sayAndCreateMissingParamError: vi.fn(
			async (_tool: string, param: string) => `Missing required parameter: ${param}`,
		),
		ask: vi.fn(async () => {}),
		providerRef: { deref: () => overrides.provider ?? null },
		...overrides,
	} as unknown as Task
}

interface TestCallbacks extends ToolCallbacks {
	results: string[]
	approvals: unknown[]
}

function makeCallbacks(opts: { approve?: boolean } = {}): TestCallbacks {
	const results: string[] = []
	const approvals: unknown[] = []
	return {
		askApproval: vi.fn(async (_t, msg) => {
			approvals.push(JSON.parse(msg as string))
			return opts.approve ?? true
		}),
		handleError: vi.fn(async (action, error) => {
			results.push(`ERROR(${action}): ${error.message}`)
		}),
		pushToolResult: vi.fn((content) => {
			results.push(typeof content === "string" ? content : JSON.stringify(content))
		}),
		removeClosingTag: (_tag, text) => text || "",
		toolProtocol: "xml",
		results,
		approvals,
	}
}

function makeProvider(customModes: ModeConfig[] = [], stateMode = "code") {
	const modes = customModes.map((m) => ({ ...m }))
	const updated: Array<{ slug: string; config: ModeConfig }> = []
	const switched: string[] = []
	const statePosts: number[] = []
	const contextSets: unknown[][] = []
	const provider = {
		modes,
		updated,
		switched,
		statePosts,
		contextSets,
		customModesManager: {
			getCustomModes: vi.fn(async () => modes.map((m) => ({ ...m }))),
			updateCustomMode: vi.fn(async (slug: string, config: ModeConfig) => {
				updated.push({ slug, config })
				const idx = modes.findIndex((m) => m.slug === slug)
				if (idx >= 0) {
					modes[idx] = config
				} else {
					modes.push(config)
				}
			}),
		},
		getState: vi.fn(async () => ({ mode: stateMode })),
		handleModeSwitch: vi.fn(async (slug: string) => {
			switched.push(slug)
			provider.getState = vi.fn(async () => ({ mode: slug }))
		}),
		postStateToWebview: vi.fn(async () => {
			statePosts.push(1)
		}),
		contextProxy: {
			setValue: vi.fn(async (key: string, value: unknown) => {
				contextSets.push([key, value])
			}),
		},
	}
	return provider
}

// Use the real built-in code mode from the source of truth instead of a
// hand-written fixture, so copy-semantics assertions track the actual defaults.
const codeBuiltIn = getAllModes([]).find((m) => m.slug === "code") as ModeConfig

describe("ManageModeTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("lists modes including built-ins and marks current mode", async () => {
		const provider = makeProvider()
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute({ action: "list", reason: "" }, task, cb)
		expect(cb.results[0]).toContain("current: code")
		expect(cb.results[0]).toContain('"slug": "code"')
	})

	it("creates a new mode and switches immediately by default", async () => {
		const provider = makeProvider()
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute(
			{
				action: "create",
				slug: "Research Buddy",
				name: "Research Buddy",
				role_definition: "You research things",
				groups: '["read"]',
				switch_after: "true",
				reason: "",
			},
			task,
			cb,
		)
		expect(provider.updated).toHaveLength(1)
		expect(provider.updated[0].slug).toBe("research-buddy")
		expect(provider.switched).toEqual(["research-buddy"])
		expect(cb.results[0]).toContain("Created mode")
		expect(cb.results[0]).toContain("Switched to the new mode")
	})

	it("respects switch_after=false by not switching", async () => {
		const provider = makeProvider()
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute(
			{
				action: "create",
				slug: "no-switch",
				role_definition: "x",
				switch_after: "false",
				reason: "",
			},
			task,
			cb,
		)
		expect(provider.updated).toHaveLength(1)
		expect(provider.switched).toHaveLength(0)
		expect(cb.results[0]).toContain("switch_mode")
	})

	it("rejects create with an existing slug and points to copy", async () => {
		const provider = makeProvider()
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute({ action: "create", slug: "code", role_definition: "x", reason: "" }, task, cb)
		expect(cb.results[0]).toContain("already exists")
		expect(cb.results[0]).toContain("copy")
	})

	it("copy duplicates a built-in with -1 suffix and -N progression", async () => {
		const provider = makeProvider()
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute(
			{ action: "copy", copy_from: "code", role_definition: "", reason: "" },
			task,
			cb,
		)
		expect(provider.updated).toHaveLength(1)
		expect(provider.updated[0].slug).toBe("code-1")
		expect(provider.updated[0].config.roleDefinition).toBe(codeBuiltIn.roleDefinition)
		expect(provider.updated[0].config.groups).toEqual(codeBuiltIn.groups)
		expect(provider.updated[0].config.name).toBe("Code-1")

		// Second copy gets -2
		const cb2 = makeCallbacks()
		await manageModeTool.execute({ action: "copy", copy_from: "code", reason: "" }, task, cb2)
		expect(provider.updated[1].slug).toBe("code-2")
	})

	it("copy allows explicit overrides on top of the source", async () => {
		const provider = makeProvider()
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute(
			{
				action: "copy",
				copy_from: "code",
				name: "Coder",
				role_definition: "Overridden role",
				groups: '[["edit",{"fileRegex":"\\\\.md$"}]]',
				reason: "",
			},
			task,
			cb,
		)
		expect(provider.updated[0].slug).toBe("code-1")
		expect(provider.updated[0].config.name).toBe("Coder")
		expect(provider.updated[0].config.roleDefinition).toBe("Overridden role")
		expect(provider.updated[0].config.groups).toEqual([["edit", { fileRegex: "\\.md$", description: undefined }]])
	})

	it("copy errors when copy_from does not exist", async () => {
		const provider = makeProvider()
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute({ action: "copy", copy_from: "nope", role_definition: "x", reason: "" }, task, cb)
		expect(cb.results[0]).toContain('copy_from mode "nope" not found')
	})

	it("update merges fields into the existing custom mode and switches", async () => {
		const existing: ModeConfig = {
			slug: "reviewer",
			name: "Reviewer",
			roleDefinition: "old role",
			groups: ["read"],
			source: "global",
		}
		const provider = makeProvider([existing])
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute(
			{
				action: "update",
				slug: "reviewer",
				role_definition: "new role",
				name: "Reviewer Pro",
				reason: "",
			},
			task,
			cb,
		)
		expect(provider.updated).toHaveLength(1)
		expect(provider.updated[0].config.roleDefinition).toBe("new role")
		expect(provider.updated[0].config.name).toBe("Reviewer Pro")
		// unchanged fields preserved
		expect(provider.updated[0].config.groups).toEqual(["read"])
		expect(provider.switched).toEqual(["reviewer"])
		expect(cb.results[0]).toContain("Updated mode")
	})

	it("update ignores literal 'null' strings so omitted params never pollute fields", async () => {
		const existing: ModeConfig = {
			slug: "reviewer",
			name: "Reviewer",
			roleDefinition: "old role",
			whenToUse: "when reviewing",
			description: "desc",
			iconName: "codicon-eye",
			groups: ["read"],
			source: "global",
		}
		const provider = makeProvider([existing])
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute(
			{
				action: "update",
				slug: "reviewer",
				role_definition: "new role",
				name: "null",
				when_to_use: "null",
				description: "null",
				icon_name: "null",
				groups: "null",
				reason: "null",
			},
			task,
			cb,
		)
		expect(provider.updated).toHaveLength(1)
		expect(provider.updated[0].config.roleDefinition).toBe("new role")
		// literal "null" must never overwrite existing values
		expect(provider.updated[0].config.name).toBe("Reviewer")
		expect(provider.updated[0].config.whenToUse).toBe("when reviewing")
		expect(provider.updated[0].config.description).toBe("desc")
		expect(provider.updated[0].config.iconName).toBe("codicon-eye")
		expect(provider.updated[0].config.groups).toEqual(["read"])
	})

	it("update with undefined omitted params keeps every existing field", async () => {
		const existing: ModeConfig = {
			slug: "reviewer",
			name: "Reviewer",
			roleDefinition: "old role",
			whenToUse: "when reviewing",
			description: "desc",
			iconName: "codicon-eye",
			groups: ["read"],
			source: "global",
		}
		const provider = makeProvider([existing])
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute(
			{
				action: "update",
				slug: "reviewer",
				role_definition: "new role only",
			},
			task,
			cb,
		)
		expect(provider.updated).toHaveLength(1)
		expect(provider.updated[0].config.roleDefinition).toBe("new role only")
		expect(provider.updated[0].config.name).toBe("Reviewer")
		expect(provider.updated[0].config.whenToUse).toBe("when reviewing")
		expect(provider.updated[0].config.description).toBe("desc")
		expect(provider.updated[0].config.iconName).toBe("codicon-eye")
		expect(provider.updated[0].config.groups).toEqual(["read"])
	})

	it("update on a built-in persists an override with the same slug", async () => {
		const provider = makeProvider()
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute(
			{ action: "update", slug: "code", role_definition: "new builtin role", reason: "" },
			task,
			cb,
		)
		expect(provider.updated).toHaveLength(1)
		expect(provider.updated[0].slug).toBe("code")
		expect(provider.updated[0].config.roleDefinition).toBe("new builtin role")
		expect(provider.switched).toEqual(["code"])
	})

	it("update errors when the target mode is unknown", async () => {
		const provider = makeProvider()
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute({ action: "update", slug: "ghost", role_definition: "x", reason: "" }, task, cb)
		expect(cb.results[0]).toContain('Mode "ghost" not found')
	})

	it("switch activates the target mode", async () => {
		const provider = makeProvider([], "code")
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute({ action: "switch", slug: "architect", reason: "design phase" }, task, cb)
		expect(provider.switched).toEqual(["architect"])
		expect(cb.results[0]).toContain("Successfully switched from code")
	})

	it("switch is a no-op when already in the mode", async () => {
		const provider = makeProvider([], "code")
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute({ action: "switch", slug: "code", reason: "" }, task, cb)
		expect(provider.switched).toHaveLength(0)
		expect(cb.results[0]).toContain("Already in")
	})

	it("switch rejects an invalid mode", async () => {
		const provider = makeProvider()
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute({ action: "switch", slug: "does-not-exist", reason: "" }, task, cb)
		expect(cb.results[0]).toContain("Invalid mode")
	})

	it("rejects unknown actions", async () => {
		const provider = makeProvider()
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute({ action: "explode" as never, reason: "" }, task, cb)
		expect(cb.results[0]).toContain("Unknown action")
	})

	it("missing action parameter produces a missing-param error", async () => {
		const provider = makeProvider()
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute({ reason: "" } as never, task, cb)
		expect(cb.results[0]).toContain("Missing required parameter: action")
	})

	it("create without role_definition fails", async () => {
		const provider = makeProvider()
		const task = makeTask({ provider })
		const cb = makeCallbacks()
		await manageModeTool.execute({ action: "create", slug: "x", reason: "" }, task, cb)
		expect(cb.results[0]).toContain("Missing required parameter: role_definition")
	})

	it("approval rejection stops persistence", async () => {
		const provider = makeProvider()
		const task = makeTask({ provider })
		const cb = makeCallbacks({ approve: false })
		await manageModeTool.execute({ action: "create", slug: "y", role_definition: "r", reason: "" }, task, cb)
		expect(provider.updated).toHaveLength(0)
		expect(cb.results).toHaveLength(0)
	})
})
