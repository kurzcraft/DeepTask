# Deeptask 9.3.8

## Re-project after folding command/MCP sequences

Host already 8k-truncates each `command_output` chunk before IPC. ChatView then folded those chunks into the matching `command` / `use_mcp_server` row with no cap, and cached the concatenated string. A long wait-command session therefore grew after projection: each 8k chunk was joined back onto the command line, and incremental fold reuse pinned that joined text.

9.3.8 folds, then re-applies the display bound:

- Newest tail rows stay 8k-truncated.
- Historical rows cheap-preview to 120 chars.
- Cheap-preview is idempotent so a second projection keeps object identity.
- ChatView and Agent Manager cache the capped objects, not the joined fold.

Storage and model I/O stay full. Expand still loads command output by `ts`.

Falsification: a folded command row still exceeds 8k, or a historical folded command still exceeds 120 chars after leaving the tail.
