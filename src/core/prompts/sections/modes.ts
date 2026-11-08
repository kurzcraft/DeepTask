import * as vscode from "vscode"

import type { ModeConfig } from "@roo-code/types"

import { getAllModesWithPrompts } from "../../../shared/modes"
import { filterModesForSystemPrompt } from "../../../shared/evolve-upgrade"
import { ensureSettingsDirectoryExists } from "../../../utils/globalContext"

export async function getModesSection(
	context: vscode.ExtensionContext,
	skipXmlExamples: boolean = false,
): Promise<string> {
	// Make sure path gets created
	await ensureSettingsDirectoryExists(context)

	// Get all modes with their overrides from extension state
	const allModes = await getAllModesWithPrompts(context)
	// kilocode_change: system-prompt MODES lists the newest evolve copy only.
	// Historical Evolve-N entries live in ~/.deeptask/PROMPT_EVOLUTION_LOG.md.
	const listedModes = filterModesForSystemPrompt(allModes)

	let modesContent = `====

MODES

- These are the currently available modes:
${listedModes
	.map((mode: ModeConfig) => {
		const source = (mode.whenToUse?.trim() || mode.roleDefinition.split(/[.。]/)[0] || mode.name)
			.replace(/\s+/g, " ")
			.trim()
		const description = source.length > 120 ? `${source.slice(0, 117)}...` : source
		return `  * "${mode.name}" (${mode.slug}) - ${description}`
	})
	.join("\n")}
- Historical evolve copies are omitted here. Read ~/.deeptask/PROMPT_EVOLUTION_LOG.md for lineage.`

	if (!skipXmlExamples) {
		modesContent += `
If the user asks you to create or edit a new mode for this project, you should read the instructions by using the fetch_instructions tool, like this:
<fetch_instructions>
<task>create_mode</task>
</fetch_instructions>
`
	} else {
		modesContent += `
If the user asks you to create or edit a new mode for this project, you should read the instructions by using the fetch_instructions tool.
`
	}

	return modesContent
}
