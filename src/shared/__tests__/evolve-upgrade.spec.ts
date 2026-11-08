// npx vitest run src/shared/__tests__/evolve-upgrade.spec.ts
import { describe, expect, it } from "vitest"

import {
	evolveDisplayName,
	filterModesForSystemPrompt,
	isEvolveSlug,
	parseEvolveVersion,
	resolveLatestEvolve,
	shouldPreserveProviderOnModeSwitch,
} from "../evolve-upgrade"

describe("evolve-upgrade helpers", () => {
	it("isEvolveSlug matches the evolve family", () => {
		expect(isEvolveSlug("evolve")).toBe(true)
		expect(isEvolveSlug("evolve-3")).toBe(true)
		expect(isEvolveSlug("evolve-10")).toBe(true)
		expect(isEvolveSlug("code")).toBe(false)
		expect(isEvolveSlug(undefined)).toBe(false)
		expect(isEvolveSlug("ask")).toBe(false)
	})

	it("evolveDisplayName matches the slug digit", () => {
		expect(evolveDisplayName("evolve")).toBe("Evolve")
		expect(evolveDisplayName("evolve-14")).toBe("Evolve-14")
		expect(evolveDisplayName("code")).toBe("code")
	})

	it("parseEvolveVersion uses the slug digit and ignores a drifted display name", () => {
		expect(parseEvolveVersion("Evolve-12", "evolve-10")).toBe(10)
		expect(parseEvolveVersion("Evolve-10", "evolve-11")).toBe(11)
		expect(parseEvolveVersion(undefined, "evolve-4")).toBe(4)
		expect(parseEvolveVersion(undefined, "evolve")).toBe(0)
		expect(parseEvolveVersion("Code", "code")).toBe(-1)
	})

	it("resolveLatestEvolve picks the newest by slug digit", () => {
		const customModes = [
			{ slug: "evolve-11", name: "Evolve-10" },
			{ slug: "evolve-10", name: "Evolve-12" },
			{ slug: "evolve-9", name: "Evolve-9" },
			{ slug: "code", name: "Code" },
		]
		expect(resolveLatestEvolve(customModes)).toEqual({ slug: "evolve-11", version: 11 })
	})

	it("resolveLatestEvolve ties on version break by slug string", () => {
		const customModes = [
			{ slug: "evolve-2", name: "Evolve-2" },
			{ slug: "evolve-7", name: "Evolve-7" },
		]
		expect(resolveLatestEvolve(customModes)?.slug).toBe("evolve-7")
	})

	it("resolveLatestEvolve returns undefined when no evolve modes exist", () => {
		expect(resolveLatestEvolve([{ slug: "code", name: "Code" }])).toBeUndefined()
		expect(resolveLatestEvolve([])).toBeUndefined()
	})

	it("shouldPreserveProviderOnModeSwitch only for evolve-family hops", () => {
		expect(shouldPreserveProviderOnModeSwitch("evolve-17", "evolve-18")).toBe(true)
		expect(shouldPreserveProviderOnModeSwitch("evolve", "evolve-1")).toBe(true)
		expect(shouldPreserveProviderOnModeSwitch("evolve-17", "evolve-17")).toBe(false)
		expect(shouldPreserveProviderOnModeSwitch("code", "architect")).toBe(false)
		expect(shouldPreserveProviderOnModeSwitch("evolve-17", "code")).toBe(false)
		expect(shouldPreserveProviderOnModeSwitch("code", "evolve-17")).toBe(false)
		expect(shouldPreserveProviderOnModeSwitch(undefined, "evolve-18")).toBe(false)
	})

	it("filterModesForSystemPrompt keeps non-evolve modes plus the newest evolve copy", () => {
		const modes = [
			{ slug: "code", name: "Code" },
			{ slug: "evolve", name: "Evolve" },
			{ slug: "evolve-16", name: "Evolve-16" },
			{ slug: "evolve-17", name: "Evolve-17" },
			{ slug: "ask", name: "Ask" },
		]
		expect(filterModesForSystemPrompt(modes).map((m) => m.slug)).toEqual(["code", "evolve-17", "ask"])
	})

	it("filterModesForSystemPrompt is a no-op when no evolve modes exist", () => {
		const modes = [
			{ slug: "code", name: "Code" },
			{ slug: "ask", name: "Ask" },
		]
		expect(filterModesForSystemPrompt(modes)).toEqual(modes)
	})
})
