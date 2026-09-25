export function getManageModeDescription(): string {
	return `## manage_mode
Description: Create, copy, update, list, or switch agent modes. Copying a mode duplicates it with a "-1"/"-2" style slug suffix so the original stays untouched. Unless switch_after is "false", the new/updated mode is activated immediately.
Parameters:
- action: (required) One of: list | create | copy | update | switch
- slug: Mode slug (letters/numbers/dashes). Required for create/update/switch; optional base slug for copy (gets -1/-2 suffix automatically)
- name: Human-readable display name (defaults to slug, or copied name)
- role_definition: Role definition / system persona (required for create; defaults from copy source)
- when_to_use: Short guidance on when this mode should be used
- description: Description shown in the mode picker
- custom_instructions: Extra custom instructions appended for this mode
- groups: JSON array of tool groups, e.g. ["read","edit","command"] or [["edit",{"fileRegex":"\\\\.md$"}]]; valid groups: read, edit, browser, command, mcp, modes
- icon_name: Optional codicon icon name
- copy_from: Source mode slug to copy from (required for action=copy)
- switch_after: Set "false" to skip the immediate switch after create/copy/update (default switches)
- reason: Why this mode change is needed
Usage:
<manage_mode>
<action>copy</action>
<copy_from>code</copy_from>
<name>Reviewer</name>
<role_definition>You are a strict code reviewer.</role_definition>
<groups>["read","edit"]</groups>
<reason>Need a review variant without command execution</reason>
</manage_mode>

Example: Create a brand-new mode and switch to it immediately
<manage_mode>
<action>create</action>
<slug>doc-writer</slug>
<name>Doc Writer</name>
<role_definition>You are a technical documentation writer.</role_definition>
<groups>["read","edit"]</groups>
<reason>User asked for a dedicated documentation mode</reason>
</manage_mode>`
}
