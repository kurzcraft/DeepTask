// kilocode_change - new file: tests for ManageProviderProfileTool
import { describe, it, expect, vi, beforeEach } from "vitest"

import { manageProviderProfileTool } from "../ManageProviderProfileTool"
import type { Task } from "../../task/Task"
import type { ToolCallbacks } from "../BaseTool"

// Mock vscode module (required by transitive Task imports in this repo's test setup)
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

function makeProvider() {
	const profiles: Record<
		string,
		{
			id: string
			apiProvider: string
			apiModelId?: string
			deepSeekApiKey?: string
			deepSeekBaseUrl?: string
			enableReasoningEffort?: boolean
			reasoningEffort?: string
		}
	> = {
		deepseek: {
			id: "id-deepseek",
			apiProvider: "deepseek",
			apiModelId: "deepseek-chat",
			deepSeekApiKey: "sk-secret",
			enableReasoningEffort: true,
			reasoningEffort: "high",
		},
	}
	const saved: Array<{ name: string; settings: Record<string, unknown> }> = []
	const deleted: string[] = []
	const activated: string[] = []
	const provider = {
		saved,
		deleted,
		activated,
		profiles,
		providerSettingsManager: {
			listConfig: vi.fn(async () =>
				Object.keys(profiles).map((name) => ({
					name,
					id: profiles[name].id,
					apiProvider: profiles[name].apiProvider,
					modelId: profiles[name].apiModelId,
				})),
			),
			getProfile: vi.fn(async ({ name }: { name: string }) => {
				if (!profiles[name]) throw new Error(`Config with name '${name}' not found`)
				return { name, ...profiles[name] }
			}),
			saveConfig: vi.fn(async (name: string, settings: Record<string, unknown>) => {
				saved.push({ name, settings })
				profiles[name] = {
					...(profiles[name] ?? { id: `id-${name}` }),
					...(settings as Partial<(typeof profiles)[string]>),
				}
				return profiles[name].id
			}),
			deleteConfig: vi.fn(async (name: string) => {
				deleted.push(name)
				delete profiles[name]
			}),
		},
		getState: vi.fn(async () => ({ currentApiConfigName: "deepseek" })),
		upsertProviderProfile: vi.fn(async (name: string, settings: Record<string, unknown>) => {
			const { ...rest } = settings
			profiles[name] = {
				...(profiles[name] ?? { id: `id-${name}` }),
				...(rest as Partial<(typeof profiles)[string]>),
			}
			return profiles[name].id
		}),
		activateProviderProfile: vi.fn(async ({ name }: { name: string }) => {
			activated.push(name)
			return { name }
		}),
	}
	return provider
}

describe("ManageProviderProfileTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("lists profiles with redacted secrets", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks()
		await manageProviderProfileTool.execute({ action: "list" }, task, cb)
		expect(cb.results).toHaveLength(1)
		expect(cb.results[0]).toContain('"deepseek"')
		expect(cb.results[0]).toContain("«redacted»")
		expect(cb.results[0]).not.toContain("sk-secret")
	})

	it("set_reasoning disable turns reasoning off", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks()
		await manageProviderProfileTool.execute(
			{ action: "set_reasoning", profile_name: "deepseek", reasoning_effort: "disable", reason: "speed" },
			task,
			cb,
		)
		expect(cb.results[0]).toContain("disable")
		expect(p.upsertProviderProfile).toHaveBeenCalledWith(
			"deepseek",
			expect.objectContaining({ enableReasoningEffort: false, reasoningEffort: "disable" }),
			false,
		)
	})

	it("set_reasoning high turns reasoning on", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks()
		await manageProviderProfileTool.execute(
			{ action: "set_reasoning", reasoning_effort: "high", reason: "hard task" },
			task,
			cb,
		)
		expect(p.upsertProviderProfile).toHaveBeenCalledWith(
			"deepseek",
			expect.objectContaining({ enableReasoningEffort: true, reasoningEffort: "high" }),
			false,
		)
	})

	it("rejects invalid reasoning level", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks()
		await manageProviderProfileTool.execute({ action: "set_reasoning", reasoning_effort: "ultra", reason: "x" }, task, cb)
		expect(cb.results[0]).toContain("Invalid reasoning_effort")
		expect(task.recordToolError).toHaveBeenCalled()
		expect(p.upsertProviderProfile).not.toHaveBeenCalled()
	})

	it("create stores provider-specific key/url/model fields", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks()
		await manageProviderProfileTool.execute(
			{
				action: "create",
				profile_name: "testprof",
				provider: "deepseek",
				model_id: "deepseek-reasoner",
				api_key: "sk-123",
				base_url: "https://api.test/v1",
				reason: "user asked",
			},
			task,
			cb,
		)
		expect(cb.results[0]).toContain("Created provider profile")
		expect(p.upsertProviderProfile).toHaveBeenCalledWith(
			"testprof",
			expect.objectContaining({
				apiProvider: "deepseek",
				apiModelId: "deepseek-reasoner",
				deepSeekApiKey: "sk-123",
				deepSeekBaseUrl: "https://api.test/v1",
			}),
			false,
		)
	})

	it("create rejects duplicate profile", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks()
		await manageProviderProfileTool.execute(
			{ action: "create", profile_name: "deepseek", provider: "deepseek", model_id: "m", reason: "x" },
			task,
			cb,
		)
		expect(cb.results[0]).toContain("already exists")
		expect(p.upsertProviderProfile).not.toHaveBeenCalled()
	})

	it("create rejects invalid provider", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks()
		await manageProviderProfileTool.execute(
			{ action: "create", profile_name: "x", provider: "not-a-provider", model_id: "m", reason: "x" },
			task,
			cb,
		)
		expect(cb.results[0]).toContain("must be a valid provider name")
	})

	it("update patches only provided fields", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks()
		await manageProviderProfileTool.execute(
			{ action: "update", profile_name: "deepseek", model_id: "deepseek-v3.2", reason: "user asked" },
			task,
			cb,
		)
		expect(cb.results[0]).toContain("Updated provider profile")
		expect(p.upsertProviderProfile).toHaveBeenCalledWith(
			"deepseek",
			expect.objectContaining({ apiModelId: "deepseek-v3.2", deepSeekApiKey: "sk-secret" }),
			false,
		)
	})

	it("update with no changes reports nothing to do", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks()
		await manageProviderProfileTool.execute({ action: "update", profile_name: "deepseek", reason: "x" }, task, cb)
		expect(cb.results[0]).toContain("No changes specified")
		expect(p.upsertProviderProfile).not.toHaveBeenCalled()
	})

	it("update rejects unknown profile", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks()
		await manageProviderProfileTool.execute({ action: "update", profile_name: "ghost", model_id: "m", reason: "x" }, task, cb)
		expect(cb.results[0]).toContain("not found")
	})

	it("rename saves under new name, deletes old, reactivates when active", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks()
		await manageProviderProfileTool.execute(
			{ action: "rename", profile_name: "deepseek", new_name: "ds-main", reason: "tidy" },
			task,
			cb,
		)
		expect(p.providerSettingsManager.saveConfig).toHaveBeenCalledWith(
			"ds-main",
			expect.objectContaining({ id: "id-deepseek" }),
		)
		expect(p.providerSettingsManager.deleteConfig).toHaveBeenCalledWith("deepseek")
		expect(p.activated).toContain("ds-main")
		expect(cb.results[0]).toContain('Renamed provider profile "deepseek" -> "ds-main"')
	})

	it("rename requires both names", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks()
		await manageProviderProfileTool.execute({ action: "rename", profile_name: "deepseek", reason: "x" }, task, cb)
		expect(cb.results[0]).toContain("requires both profile_name")
	})

	it("mutations require approval; denial aborts", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks({ approve: false })
		await manageProviderProfileTool.execute(
			{ action: "set_reasoning", profile_name: "deepseek", reasoning_effort: "low", reason: "x" },
			task,
			cb,
		)
		expect(cb.approvals).toHaveLength(1)
		expect(cb.approvals[0]).toMatchObject({ tool: "manageProviderProfile", action: "set_reasoning" })
		expect(p.upsertProviderProfile).not.toHaveBeenCalled()
	})

	it("list needs no approval", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks()
		await manageProviderProfileTool.execute({ action: "list" }, task, cb)
		expect(cb.approvals).toHaveLength(0)
	})

	it("parseLegacy parses settings JSON and optional params", () => {
		const parsed = manageProviderProfileTool.parseLegacy({
			action: "update",
			profile_name: "p",
			settings: '{"modelMaxTokens": 4096}',
			reason: "r",
		})
		expect(parsed).toMatchObject({
			action: "update",
			profile_name: "p",
			settings: { modelMaxTokens: 4096 },
			reason: "r",
		})
	})

	it("parseLegacy tolerates broken settings JSON", () => {
		const parsed = manageProviderProfileTool.parseLegacy({ action: "list", settings: "{broken" })
		expect(parsed.settings).toBeUndefined()
	})

	it("missing action reports missing param", async () => {
		const p = makeProvider()
		const task = makeTask({ provider: p })
		const cb = makeCallbacks()
		await manageProviderProfileTool.execute({ action: "" } as never, task, cb)
		expect(cb.results[0]).toContain("Missing required parameter: action")
		expect(task.recordToolError).toHaveBeenCalled()
	})
})
