// kilocode_change - new file
/**
 * Shared evolve-mode lineage helpers.
 *
 * One number, two surfaces: slug `evolve-N` MUST display as `Evolve-N`.
 * Dual numbering (name Evolve-12 vs slug evolve-10) was a bug, not a design.
 * Ranking and display both use the slug digit. `manage_mode` copy/update
 * must force the display name to match; never inherit a predecessor name.
 */

export interface EvolveVersionInfo {
	slug: string
	version: number
}

/** Display name that matches the slug digit: evolve -> Evolve, evolve-14 -> Evolve-14. */
export function evolveDisplayName(slug: string): string {
	const match = /^evolve(?:-(\d+))?$/.exec(slug)
	if (!match) {
		return slug
	}
	return match[1] ? `Evolve-${match[1]}` : "Evolve"
}

/** Parse the lineage version of one evolve mode. Returns -1 for non-evolve slugs. */
export function parseEvolveVersion(name: string | undefined, slug: string): number {
	if (!/^evolve(?:-(\d+))?$/.test(slug)) {
		return -1
	}
	// Slug digit is the only version. Ignore a drifted display name.
	void name
	const slugMatch = /^evolve(?:-(\d+))?$/.exec(slug)
	return Number(slugMatch?.[1] ?? 0)
}

/**
 * Find the newest installed evolve mode across custom + built-in entries.
 * Returns undefined when no evolve-family mode is installed.
 */
export function resolveLatestEvolve(
	customModes: Array<{ slug: string; name?: string }>,
): EvolveVersionInfo | undefined {
	let best: EvolveVersionInfo | undefined
	for (const mode of customModes) {
		const version = parseEvolveVersion(mode.name, mode.slug)
		if (version < 0) {
			continue
		}
		if (!best || version > best.version || (version === best.version && mode.slug > best.slug)) {
			best = { slug: mode.slug, version }
		}
	}
	return best
}

/** True when `slug` belongs to the evolve family (evolve, evolve-1, evolve-12, ...). */
export function isEvolveSlug(slug: string | undefined | null): boolean {
	return !!slug && /^evolve(?:-(\d+))?$/.test(slug)
}
