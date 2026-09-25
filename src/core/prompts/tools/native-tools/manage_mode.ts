// kilocode_change - new file: agent-managed modes (native tool definition)
import type OpenAI from "openai"

// kilocode_change: shared governance constant (single source of truth with the
// built-in evolve prompt and the XML tool description).
import { MODE_FILE_GOVERNANCE_RULE } from "@roo-code/types"

export function createManageModeTool(): OpenAI.Chat.ChatCompletionTool {
	return {
		type: "function",
		function: {
			name: "manage_mode",
			description:
				"Create, copy, update, list, or switch agent modes — the ONLY sanctioned way to change modes. " +
				MODE_FILE_GOVERNANCE_RULE +
				" " +
				'list: all modes with slug/name/groups/source. ' +
				'create: brand-new mode from scratch (requires slug+role_definition; name/groups/when_to_use/description/custom_instructions/icon_name optional). ' +
				'copy: duplicate an existing mode with edits (copy_from required); the new slug automatically gets a "-1"/"-2" style suffix so the original stays untouched; every provided field overrides the copied value. ' +
				'update: modify an existing mode by value; built-in modes are overridden via a same-slug custom copy; to keep the original intact use "copy" instead. ' +
				'switch: activate a mode. ' +
				"Unless switch_after is exactly \"false\", the newly created/updated mode is activated immediately so the running task picks it up in real time. " +
				'groups is a JSON array like ["read","edit","command"] or with restrictions [["edit",{"fileRegex":"\\\\.md$","description":"markdown only"}]]; valid groups: read, edit, browser, command, mcp, modes.',
			strict: true,
			parameters: {
				type: "object",
				properties: {
					action: {
						type: "string",
						enum: ["list", "create", "copy", "update", "switch"],
						description: "Operation to perform",
					},
					slug: {
						type: ["string", "null"],
						description:
							"Mode slug (letters/numbers/dashes). Required for create/update/switch. For copy: optional base slug; the final slug gets a -1/-2 suffix automatically.",
					},
					name: {
						type: ["string", "null"],
						description: "Human-readable display name (defaults to slug, or copied name)",
					},
					role_definition: {
						type: ["string", "null"],
						description: "Role definition / system persona for the mode (required for create)",
					},
					when_to_use: {
						type: ["string", "null"],
						description: "Short guidance on when this mode should be used",
					},
					description: {
						type: ["string", "null"],
						description: "Description shown in the mode picker",
					},
					custom_instructions: {
						type: ["string", "null"],
						description: "Extra custom instructions appended for this mode",
					},
					groups: {
						type: ["string", "null"],
						description:
							'JSON array of tool groups, e.g. ["read","edit","command"] or [["edit",{"fileRegex":"\\\\.md$"}]]. Valid groups: read, edit, browser, command, mcp, modes.',
					},
					icon_name: {
						type: ["string", "null"],
						description: "Optional codicon icon name for the mode",
					},
					copy_from: {
						type: ["string", "null"],
						description: "Source mode slug to copy from (required for action=copy)",
					},
					switch_after: {
						type: ["string", "null"],
						enum: ["true", "false", null],
						description: 'Set "false" to skip the immediate switch after create/copy/update (default switches)',
					},
					reason: {
						type: ["string", "null"],
						description: "Why this mode change is needed (shown to the user for approval)",
					},
				},
				required: [
					"action",
					"slug",
					"name",
					"role_definition",
					"when_to_use",
					"description",
					"custom_instructions",
					"groups",
					"icon_name",
					"copy_from",
					"switch_after",
					"reason",
				],
				additionalProperties: false,
			},
		},
	}
}

export default createManageModeTool()
