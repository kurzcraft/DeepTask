// npx vitest run src/shared/__tests__/evolve-upgrade.spec.ts
import { describe, expect, it } from "vitest"

import { isEvolveSlug, parseEvolveVersion, resolveLatestEvolve } from "../evolve-upgrade"

describe("evolve-upgrade helpers", () => {
	it("isEvolveSlug matches the evolve family", () => {
		expect(isEvolveSlug("evolve")).toBe(true)
		expect(isEvolveSlug("evolve-3")).toBe(true)
		expect(isEvolveSlug("evolve-10")).toBe(true)
		expect(isEvolveSlug("code")).toBe(false)
		expect(isEvolveSlug(undefined)).toBe(false)
		expect(isEvolveSlug("ask")).toBe(false)
	})

	it("parseEvolveVersion prefers the NAME version over the slug digit", () => {
		// The real installed lineage: slug evolve-10 carries name "Evolve-12"
		// (newest) while slug evolve-11 carries name "Evolve-10" (older).
		expect(parseEvolveVersion("Evolve-12", "evolve-10")).toBe(12)
		expect(parseEvolveVersion("Evolve-10", "evolve-11")).toBe(10)
		// No name number -> fall back to the slug digit.
		expect(parseEvolveVersion(undefined, "evolve-4")).toBe(4)
		expect(parseEvolveVersion(undefined, "evolve")).toBe(0)
		// Non-evolve slug -> -1.
		expect(parseEvolveVersion("Code", "code")).toBe(-1)
	})

	it("resolveLatestEvolve picks the newest by NAME version, not slug digit", () => {
		const customModes = [
			{ slug: "evolve-11", name: "Evolve-10" }, // older lineage
			{ slug: "evolve-10", name: "Evolve-12" }, // NEWEST lineage
			{ slug: "evolve-9", name: "Evolve-9" },
			{ slug: "code", name: "Code" }, // not evolve family
		]
		expect(resolveLatestEvolve(customModes)).toEqual({ slug: "evolve-10", version: 12 })
	})

	it("resolveLatestEvolve ties on version break by slug string", () => {
		const customModes = [
			{ slug: "evolve-2", name: "Evolve-5" },
			{ slug: "evolve-7", name: "Evolve-5" },
		]
		expect(resolveLatestEvolve(customModes)?.slug).toBe("evolve-7")
	})

	it("resolveLatestEvolve returns undefined when no evolve modes exist", () => {
		expect(resolveLatestEvolve([{ slug: "code", name: "Code" }])).toBeUndefined()
		expect(resolveLatestEvolve([])).toBeUndefined()
	})
})
