// kilocode_change - new file: evolve-series fork-on-update chain (evolve-N -> evolve-(N+1))
import { describe, it, expect, vi } from "vitest"

import { manageModeTool } from "../ManageModeTool"
import { getAllModes } from "../../../shared/modes"
import type { Task } from "../../task/Task"
import type { ToolCallbacks } from "../BaseTool"
import type { ModeConfig } from "@roo-code/types"

vi.mock("vscode", () => ({ window: {} }))

// Keep evolve-fork lineage writes inside a throwaway temp dir, never the real
// ~/.deeptask/MACHINE_LINEAGE.md during tests.
vi.mock("os", () => ({ homedir: () => "/tmp/deeptask-evolve-fork-test" }))
vi.mock("fs/promises", () => ({
	mkdir: vi.fn(async () => {}),
	appendFile: vi.fn(async () => {}),
}))

function makeTask(provider: unknown): Task {
	return {
		taskId: "t1",
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		recordToolError: vi.fn(),
		sayAndCreateMissingParamError: vi.fn(async (_t: string, p: string) => `Missing: ${p}`),
		ask: vi.fn(async () => {}),
		providerRef: { deref: () => provider },
	} as unknown as Task
}

function makeCallbacks() {
	const results: string[] = []
	return {
		askApproval: vi.fn(async () => true),
		handleError: vi.fn(async (a: string, e: Error) => results.push(`ERR(${a}): ${e.message}`)),
		pushToolResult: vi.fn((c: unknown) => results.push(typeof c === "string" ? c : JSON.stringify(c))),
		removeClosingTag: (_t: string, text: string) => text || "",
		toolProtocol: "xml" as const,
		results,
	}
}

function makeProvider(customModes: ModeConfig[], stateMode = "evolve-1") {
	const modes = customModes.map((m) => ({ ...m }))
	const updated: Array<{ slug: string; config: ModeConfig }> = []
	const switched: string[] = []
	const provider = {
		customModesManager: {
			getCustomModes: vi.fn(async () => modes.map((m) => ({ ...m }))),
			updateCustomMode: vi.fn(async (slug: string, config: ModeConfig) => {
				updated.push({ slug, config })
				const i = modes.findIndex((m) => m.slug === slug)
				if (i >= 0) modes[i] = config
				else modes.push(config)
			}),
		},
		getState: vi.fn(async () => ({ mode: stateMode })),
		handleModeSwitch: vi.fn(async (slug: string) => {
			switched.push(slug)
			provider.getState = vi.fn(async () => ({ mode: slug }))
		}),
		postStateToWebview: vi.fn(async () => {}),
		contextProxy: { setValue: vi.fn(async () => {}) },
	}
	return { provider, updated, switched }
}

const evolveBuiltIn = getAllModes([]).find((m) => m.slug === "evolve") as ModeConfig

describe("manage_mode evolve-series fork-on-update chain", () => {
	it("updating evolve-1 forks evolve-2 (never mutates evolve-1) and switches to it", async () => {
		const evolve1: ModeConfig = {
			...evolveBuiltIn,
			slug: "evolve-1",
			name: "Evolve",
			source: "global",
		}
		const { provider, updated, switched } = makeProvider([evolve1])
		const callbacks = makeCallbacks()

		await manageModeTool.execute(
			{
				action: "update",
				slug: "evolve-1",
				custom_instructions: "v2 improvement: always verify builds before release",
				reason: "validated improvement from evolution log",
			},
			makeTask(provider),
			callbacks as unknown as ToolCallbacks,
		)

		// Forked as evolve-2, original untouched.
		expect(updated).toHaveLength(1)
		expect(updated[0].slug).toBe("evolve-2")
		expect(updated[0].config.customInstructions).toBe("v2 improvement: always verify builds before release")
		expect(provider.customModesManager.updateCustomMode).not.toHaveBeenCalledWith("evolve-1", expect.anything())
		// Auto-switched to the fork.
		expect(switched).toEqual(["evolve-2"])
		expect(callbacks.results[0]).toContain("forked \"evolve-1\"")
	})

	it("updating evolve-2 with existing evolve-3 skips to evolve-4", async () => {
		const fork = (n: number): ModeConfig => ({
			...evolveBuiltIn,
			slug: `evolve-${n}`,
			name: `Evolve-${n}`,
			source: "global",
		})
		const { provider, updated, switched } = makeProvider([fork(1), fork(2), fork(3)])
		const callbacks = makeCallbacks()

		await manageModeTool.execute(
			{
				action: "update",
				slug: "evolve-2",
				custom_instructions: "next link in chain",
				reason: "chain continuation",
			},
			makeTask(provider),
			callbacks as unknown as ToolCallbacks,
		)

		expect(updated).toHaveLength(1)
		expect(updated[0].slug).toBe("evolve-4")
		expect(switched).toEqual(["evolve-4"])
	})

	it("updating the built-in evolve (no copy exists yet) forks evolve-1", async () => {
		const { provider, updated, switched } = makeProvider([])
		const callbacks = makeCallbacks()

		await manageModeTool.execute(
			{
				action: "update",
				slug: "evolve",
				custom_instructions: "first personalization",
				reason: "initial fork",
			},
			makeTask(provider),
			callbacks as unknown as ToolCallbacks,
		)

		expect(updated).toHaveLength(1)
		expect(updated[0].slug).toBe("evolve-1")
		expect(switched).toEqual(["evolve-1"])
	})

	// kilocode_change: copying a numbered series member continues the series
	// (evolve-3 -> evolve-4), never double-suffixes (evolve-3-1), and records
	// the delta description for the mode dropdown subtitle.
	it("copying evolve-3 forks evolve-4 with a delta description and switches to it", async () => {
		const fork = (n: number): ModeConfig => ({
			...evolveBuiltIn,
			slug: `evolve-${n}`,
			name: `Evolve-${n}`,
			source: "global",
		})
		const { provider, updated, switched } = makeProvider([fork(1), fork(2), fork(3)])
		const callbacks = makeCallbacks()

		await manageModeTool.execute(
			{
				action: "copy",
				copy_from: "evolve-3",
				role_definition: evolveBuiltIn.roleDefinition,
				reason: "popover ordering + evolve subtitle",
			},
			makeTask(provider),
			callbacks as unknown as ToolCallbacks,
		)

		expect(updated).toHaveLength(1)
		expect(updated[0].slug).toBe("evolve-4")
		expect(updated[0].config.name).toBe("Evolve-4")
		expect(updated[0].config.description).toContain("相比 evolve-3 的更新")
		expect(updated[0].config.description).toContain("popover ordering + evolve subtitle")
		expect(switched).toEqual(["evolve-4"])
	})
})
