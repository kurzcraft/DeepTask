# Deeptask 9.3.8

## Bind native todos to EXTRA/task Markdown

Native todos no longer accept a checklist payload. `bind_task_progress` binds them to an EXTRA/task Markdown file and projects that file. Call it once after the authoritative checklist exists. Call it again only to rebind a different root pointer or a light file under `EXTRA/task/<title>/`. `update_todo_list` remains an alias.

Falsification: native todos still require a `todos` payload, or a second call is needed after the same file is already bound.

## Keep the OpenAI Compatible chat selector usable

Catalogs come from `requestOpenAiModels` instead of a failing router directory. The chat picker seeds the configured `openAiModelId`, settings auto-open the local dropdown after credentials settle, and catalogs fetched for an inactive profile cannot overwrite the active chat list.

Falsification: the OpenAI Compatible chat picker stays gray with an `openai:` prefix, or an inactive profile's `/models` response overwrites the active chat list.

## Re-project after folding command/MCP sequences

Host already 8k-truncates each `command_output` chunk before IPC. ChatView then folded those chunks into the matching `command` / `use_mcp_server` row with no cap, and cached the concatenated string. A long wait-command session therefore grew after projection: each 8k chunk was joined back onto the command line, and incremental fold reuse pinned that joined text.

9.3.8 folds, then re-applies the display bound:

- Newest tail rows stay 8k-truncated.
- Historical rows cheap-preview to 120 chars.
- Cheap-preview is idempotent so a second projection keeps object identity.
- ChatView and Agent Manager cache the capped objects, not the joined fold.

Storage and model I/O stay full. Expand still loads command output by `ts`.

Falsification: a folded command row still exceeds 8k, or a historical folded command still exceeds 120 chars after leaving the tail.

## Keep execute_command running without OSC 633;A

A late Linux/VSCodium handshake, a broken default profile (`fast-bash` → `/tmp/fast-vscode-bash.sh` exit 1), or `shellIntegrationDisabled` used to abort with "Command was not executed". 9.3.8 treats OSC `633;A` as an enhancement, not a license:

- `runCommand()` times out into `runCommandViaChildProcess()` on every platform.
- Deeptask terminals pin `shellPath: getShell()` so a broken user profile cannot prevent creation.
- `createTerminal()` failures fall back to Execa.
- The tool-layer retry writes `terminalShellIntegrationDisabled` onto `Terminal.setShellIntegrationDisabled()` before `runCommand()`, so the second attempt actually skips the 5s wait.

Tests: `executeCommand.spec.ts` 14/14, `executeCommandTool.spec.ts` 33/33, `TerminalCmdFallback.spec.ts` 12/12.

Falsification: after reload, a broken integrated terminal still returns "Command was not executed" instead of output plus an exit code.
