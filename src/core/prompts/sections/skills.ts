import type { SkillsManager } from "../../../services/skills/SkillsManager"

type SkillsManagerLike = Pick<SkillsManager, "getSkillsForMode">

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&apos;")
}

const SKILL_DESCRIPTION_LIMIT = 180

function compactSkillDescription(description: string): string {
	const compact = description.replace(/\s+/g, " ").trim()
	const first = compact.split(/(?<=[.!?。])\s+/)[0] || compact
	if (first.length <= SKILL_DESCRIPTION_LIMIT) {
		return first
	}
	return `${first.slice(0, SKILL_DESCRIPTION_LIMIT - 3)}...`
}

/**
 * Generate the skills section for the system prompt.
 * Only includes skills relevant to the current mode.
 * Format matches the modes section style.
 *
 * @param skillsManager - The SkillsManager instance
 * @param currentMode - The current mode slug (e.g., 'code', 'architect')
 */
export async function getSkillsSection(
	skillsManager: SkillsManagerLike | undefined,
	currentMode: string | undefined,
): Promise<string> {
	if (!skillsManager || !currentMode) return ""

	// Get skills filtered by current mode (with override resolution)
	const skills = skillsManager.getSkillsForMode(currentMode)
	if (skills.length === 0) return ""

	const skillsXml = skills
		.map((skill) => {
			const name = escapeXml(skill.name)
			const description = escapeXml(compactSkillDescription(skill.description))
			// Per the Agent Skills integration guidance for filesystem-based agents,
			// location should be an absolute path to the SKILL.md file.
			const location = escapeXml(skill.path)
			return `  <skill>\n    <name>${name}</name>\n    <description>${description}</description>\n    <location>${location}</location>\n  </skill>`
		})
		.join("\n")

	return `====

AVAILABLE SKILLS

<available_skills>
${skillsXml}
</available_skills>

Before any user-facing response, match the request against skill descriptions. If one skill clearly applies, read its SKILL.md at <location> and follow it; otherwise proceed without loading SKILL.md. Do not load every SKILL.md up front. Descriptions are compact triggers; full instructions stay in SKILL.md. List already filtered for mode "${currentMode}".
`
}
