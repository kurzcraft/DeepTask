# Deeptask 9.3.5

## Compact host→webview transcripts

9.3.4 tombstoned historical rows before `postState`, but a 13k-row wait-command transcript still became a 16k tombstone array (~6.2MB). 9.3.5 projects a compact shape instead:

- Keep row 0, two collapsed stubs, and an 800-row tail.
- Cheap historical rows drop text / images / reasoning.
- The tail still caps command and tool payloads.

Field 13k/22MB wait-command transcripts now project as that compact shape, not a tombstone dump.

## Do not slice raw JSON at char 3000

Cutting tool/api JSON at character 3000 injected a raw newline into a string literal. ChatView `JSON.parse` then crashed the webview (`SyntaxError` at position 3000). Oversized JSON payloads now shrink string fields and re-stringify. ChatView uses `safeJsonParse` for tool and `api_req_started` rows.

## EXTRA/task cap is a growth gate, not a freeze gate

Host-enforce the 30-line / 4-level cap on active `EXTRA/task` Markdown:

- Creating or growing an over-limit file is rejected immediately. Split into `EXTRA/task/<title>/` light files first.
- Shrinks and status-only updates on an already-over-limit file are allowed, even while the result is still over 30.
- Freezing the current file, omitting new milestones, or rejecting item-by-item shrinks would lock the checklist. That freeze gate is rejected.

Native `update_todo_list` must project the file exactly and must not invent extra items.

## Also in 9.3.5

- `manage_mode` can delete a custom mode. Built-in modes stay immutable. Deleting the currently active custom mode switches to the newest remaining evolve copy, or the default mode if none remain.
- Tool-use prompts always require exactly one tool call per assistant response. The multiple-native-tool-calls experiment wording is removed from the system prompt.

Falsification condition: a 13k/22MB wait-command transcript still ships a 16k tombstone array, ChatView still dies on a char-3000 JSON cut, or item-by-item shrinks of an already-over-limit checklist are still rejected.

**Full Changelog**: https://github.com/kurzcraft/DeepTask/compare/v9.3.3...v9.3.5
