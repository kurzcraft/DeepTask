// kilocode_change - new file
/**
 * Shared evolve-mode lineage helpers.
 *
 * The evolve family has TWO numbering schemes that have drifted apart:
 * - the NAME, e.g. "Evolve-12" — the real lineage version (source of truth)
 * - the SLUG, e.g. "evolve-10" — a filesystem-safe id whose digit comes from
 *   whatever slug the copy chain happened to produce (manage_mode appends
 *   -1/-2 suffixes when a slug collides, so slug digits can go DOWN while the
 *   name version goes UP).
 *
 * Consequence: picking the "latest" evolve mode by max(slug digit) silently
 * picks an OLDER mode (slug evolve-11 = name "Evolve-10" outranks slug
 * evolve-10 = name "Evolve-12"). Always rank by the NAME's version first and
 * only fall back to the slug digit when the name carries no number.
 */

export interface EvolveVersionInfo {
	slug: string
	version: number
}

/** Parse the lineage version of one evolve mode. Returns -1 for non-evolve slugs. */
export function parseEvolveVersion(name: string | undefined, slug: string): number {
	if (!/^evolve(?:-(\d+))?$/.test(slug)) {
		return -1
	}
	// Prefer the name's "Evolve-N" digit — that is the real version.
	const nameMatch = /evolve[\s_-]*(\d+)/i.exec(name ?? "")
	if (nameMatch) {
		return Number(nameMatch[1])
	}
	// Fall back to the slug digit (base "evolve" counts as 0).
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
