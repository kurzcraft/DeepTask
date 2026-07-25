# Deeptask 5.5.0 Release Notes

## Release Artifact

- VSIX: `deeptask-5.5.0.vsix`
- Mirror copy: `bin/deeptask-5.5.0.vsix`
- Package identity: `deeptask.deeptask@5.5.0`
- Size: 42,415,955 bytes
- SHA-256: `49a58e020dcf1513fab9829ecf77b9fdc266e6ceabe8ffc7a5ae27397667a392`
- Platform: universal VS Code extension package, no native platform-specific VSIX split required by the current build.

## Latest Hotfix (2026-07-20)

- Terminal command results now use the emitted `completed` event as an independent completion boundary. If a shell/provider loses the separate process `continue` event after a finite compound command such as `py_compile && python heredoc`, the tool result still returns to the model instead of waiting indefinitely.
- Added a regression test for completion without `continue`, covering compound Python validation and heredoc output.
- Manual context condensation is now transactional: a failed or timed-out condensing API call reports `condense_context_error`, preserves the original conversation history, and does not emit a successful condense result that could leak into ordinary reasoning. A successful result is acknowledged only after the condensed history is persisted.
- Added a regression test for the exact `API stream timed out after 60000ms while waiting for the next chunk` failure path.
- Automatic condensation failures now always attempt sliding-window recovery, including when the context is above the condensation threshold but below the fallback token limit.
- If automatic or forced recovery cannot reduce context, the current API attempt stops after the dedicated condensation error instead of sending unchanged history to the normal provider path.
- Added a regression test for the threshold-only condensation failure path.
- Post-completion follow-ups now enforce a single active task loop, preventing concurrent continuation loops from racing over shared history and ask state.
- Active ask/terminal routes still consume their dedicated responses directly, while other active-loop follow-ups are atomically parked and rebuilt with their continuation kind preserved.
- Added strict regression coverage for duplicate continuation suppression, ask/terminal routing, and cancellation rebuild behavior.
- Provider responses that finish with visible plain text but omit the required `attempt_completion` tool are now promoted in place to a green soft completion in DeepTask mode, instead of leaving a plain-text answer followed by a `resume_task` stop.
- The promotion reuses the existing message, keeps task history active, and does not affect responses that contain real tool calls.
- Completed shell command output is now persisted before the tool result is returned to the model. This prevents a delayed `command_output` UI message from racing the next API turn and incorrectly leaving the recovery **Continue** button visible after finite quoted-heredoc diagnostics.
- Added a regression test that delays the final command-output save and verifies the tool remains pending until that save completes.
- VS Code terminal output is now read immediately from the created shell execution, so a fast shell-completion event cannot win before the stream is published and replace readable output with an `output is unknown` placeholder.
- Added regression coverage for both early completion with recoverable output and completion where no valid async output stream exists.
- Terminal output streams now have one reader per `TerminalShellExecution`. The stream returned after `executeCommand()` is shared with `onDidStartTerminalShellExecution`, preventing competing `read()` consumers from splitting or losing output that remains visible in the integrated terminal.
- Added regression coverage that models the same execution object across both VS Code paths, asserts `read()` is called once, and captures a chained `chmod`, `py_compile`, `bash -n`, and quoted Python heredoc smoke test through completion.

## Previous Hotfix (2026-07-13)

- Soft-completion follow-ups no longer race the old loop: the soft boundary stays pending until the previous task loop fully exits, so post-completion messages wait instead of spinning once and producing no reply.
- Task-loop generation protection prevents an older loop's `finally` from clearing `isTaskLoopActive` after a newer continuation has already started.
- Post-completion continuation setup is serialized so multi-continue sequences do not start concurrent loops over shared history.
- Summary/recap-only todo expansions no longer release the progress-list gate after completion; the model must expand real unfinished milestones for the latest user instruction.
- Focused Task continuation regression suite covers soft-boundary settle, continuation serialization, and summary-todo rejection.

## Previous Hotfix (2026-07-11)

- Mid-task typed messages are no longer demoted to terminal-only "continue": after auto-continue settles a `command_output` ask, user text is still parked as command feedback so the model receives the real instruction.
- Force-continue that starts a fresher `api_req_started` no longer routes later typed text into `terminalOperation`; it interrupts via `askResponse` so the model sees the new instruction, and Cancel remains available during that reasoning turn.
- Home / history-list first sends never clear the input into a no-op: empty conversations always create a `newTask`, and leftover `activeCommandExecutionIds` are cleared when returning home or switching tasks.
- Soft-completion plain text no longer masquerades as `command_output`, so post-completion follow-ups stay editable and can re-open unfinished todos.
- Backend message responses without a current task now fall back to `createTask`, preventing silent drops from the history/home surface.
- Long-running shell commands keep a visible manual **Continue** button even when auto-execute is off or the shell lifecycle would previously clear UI controls.
- Empty Continue after a finished command resumes the task instead of no-op.
- Soft-completion follow-up messages hard-require progress/todo list expansion so the model cannot only restate old work.
- Every finished integrated terminal command now force-marks completion and prunes excess completed terminals to the configured max, including race paths where continue settles before shell end.
- Packaging now force-rebuilds the webview assets and rejects stale clear-button markers so the Continue UI actually ships in the VSIX.
- Package identity remains `deeptask.deeptask@5.5.0`.
- Current release VSIX size: `42,412,413` bytes (`42412413`).
- Current release VSIX SHA-256: `80405ad714079f9840727c87f447deb9488d1eefed27ac932263f04adecb48e3`.
- Installed to local VSCodium as `deeptask.deeptask@5.5.0` under `~/.vscode-oss/extensions/deeptask.deeptask-5.5.0`.

## Default Configuration

- New users start with an OpenAI Compatible provider profile.
- New users skip the onboarding screen and land directly in the normal Deeptask UI.
- The default profile intentionally does not embed `openAiBaseUrl` or `openAiApiKey`.
- Non-secret defaults include `openAiModelId: gpt-4o`, streaming enabled, max-token inclusion enabled, diff enabled, todo list enabled, default mistake limit, and native tool protocol.
- Fresh VS Code installs now synchronize the seeded provider profile into active webview state before `getState()` returns, so the first rendered state does not fall back to the old `kilocode` provider.
- The startup synchronizer refreshes the in-memory context secret cache after seeding the default profile, so the active state can see the profile written during the same extension activation.
- VS Code installs with existing active provider fields but missing profile metadata now repair `currentApiConfigName` and `listApiConfigMeta` from the seeded profile, fixing the case where the OpenAI Compatible configuration exists but is not shown as loaded.
- Existing Deeptask installs that still have the old bundled `kilocode` default profile using `minimax/minimax-m2.1:free` and no token are migrated to the new OpenAI Compatible default. User-provided Kilo token profiles are not overwritten.

## Settings and Branding

- OpenAI Compatible settings now include a context-window detect button beside the custom context-window field.
- The detect button requests the configured OpenAI Compatible `/models` endpoint and can fill editable custom model limits from returned model metadata; if metadata is unavailable, it falls back to bundled model metadata or Deeptask defaults.
- The detect flow no longer treats a plain model ID returned from `/models` as the `128000` sane default; missing metadata now falls back to Deeptask's `256000` default instead of writing `128000`.
- Plain model IDs returned from `/models` remain selectable in the OpenAI Compatible model dropdown even when the API does not provide context metadata.
- Agent Manager empty-state branding now uses the packaged Deeptask icon through a VS Code webview-safe resource URI, with an inline SVG fallback that avoids clipped text when the image cannot load.
- Checkpoint settings now include a first-position "Create task progress file" option. When enabled, Deeptask tells the model at task start to read an existing matching Markdown progress file or create a task-specific one, then keep it updated for cross-session progress recovery.
- Terminal settings now include a first-position completed integrated terminal retention control. When enabled, Deeptask keeps only the configured number of Deeptask-created completed VS Code integrated terminals, defaults to 3, and excludes running command terminals from the limit.
- Completed terminal retention now clears the completed marker when a terminal is selected for reuse, dynamically scans the current VS Code integrated terminal list after completion, counts simple cross-session Deeptask terminal leftovers, and closes the topmost visible completed Deeptask terminal first when the limit is exceeded.

## Agent Manager Reliability

- Agent Manager now shows approval controls for `completion_result`, so finished child agents can be released instead of staying blocked after task completion.
- Clicking a follow-up suggestion now sends the same message response as manual input and advances the local session state machine out of `waiting_input`, preventing stale repeated questions.
- Command output feedback prompts are cleared automatically when the terminal command exits before the user responds, preventing completed commands from leaving the UI in a waiting state.
- Re-sending or editing historical conversation while a model response is still streaming now abandons the old stream before rehydrating the task, preventing duplicate rehydration and stuck output state.
- Multi-line heredoc shell commands now stay grouped during command auto-approval parsing, so temporary script creation followed by execution can auto-run when allowed by command rules instead of being blocked by script body lines.
- Quoted heredoc script bodies are skipped during dangerous substitution scanning, so nested Python heredocs, Python f-strings, and literal shell text inside generated scripts do not force manual approval. Unquoted heredocs still remain scanned because the shell expands their bodies.
- Command parsing now keeps embedded command substitutions such as `latestLog=$(ls ... | head -1)` inside their parent assignment instead of exposing the inner pipeline as top-level commands, preventing shell-variable setup commands from entering mismatched approval or wait states.
- Completed command output is now recorded as non-interactive chat output, so it no longer supersedes the active command-output prompt and stalls model continuation after the terminal exits.
- Ask responses are now accepted only while an actual pending ask exists; stale resend or queued-message responses are cleared instead of being stored for a future prompt, preventing disabled-button deadlocks after resending edited history.
- Legacy queued feedback during busy states is cleared and mirrored as non-interactive user feedback, while direct pending asks still receive the response normally.
- Completed terminal retention now uses explicit command completion order for registered terminals and stable discovery order for legacy completed terminals, so it keeps the latest completed N terminals and prunes all earlier completed terminals even if VS Code reports the terminal list in a different order.
- Retained completed VS Code terminals are no longer selected for command reuse, so new commands create a fresh command terminal and older completed terminals naturally fall out of the retained set.
- Disposed legacy completed terminals are no longer counted again while VS Code is still removing them from its terminal list, preventing retention counts from drifting above the configured limit.
- Fast commands that exit while the advisory `command_output` ask is still being created now wait briefly for the pending ask to become observable before auto-continuing, preventing heredoc/no-output commands from leaving the model turn stuck.
- Message sending no longer uses the legacy queued-message UI or Agent Manager local queue. Sending while busy now routes through direct force-send paths instead of accumulating hidden queued text.
- Inline resend/edit now keeps only the context before the edited message, removes the edited message and all later messages, and restarts reasoning from the backend without waiting on a greyed-out frontend send button.
- Completed command output now clears any still-pending advisory `command_output` ask based on the real pending ask state and explicitly releases the terminal process, so the final command result returns to the model for the next reasoning step.
- Command output prompts now auto-continue from the output callback itself if no response arrives quickly, preventing long diagnostic commands from blocking before the command-completion cleanup path can run.

## Read File Safety

- Read file output now truncates individual overlong lines to protect the context window from single-line garbage logs, while preserving normal line-count limits and adding an explicit truncation notice.
- The long-line guard applies to full reads, explicit line ranges, max-line reads, and extracted text from supported binary document formats.

## Verification

- Ran focused tests from `src`:

```bash
pnpm test core/config/__tests__/ProviderSettingsManager.spec.ts shared/__tests__/checkExistApiConfig.spec.ts
pnpm test core/webview/__tests__/ClineProvider.spec.ts -t "initializes seeded OpenAI Compatible profile into active state|syncs default profile metadata even when provider settings already exist|refreshes context secrets after seeding the default provider profile"
```

- Result: provider/default-gate tests passed with 2 test files and 55 tests; the focused ClineProvider startup-sync, context-secret refresh, profile-metadata repair, and legacy bundled Kilocode default migration tests passed.
- Ran command execution focused test from `src`:

```bash
pnpm test core/tools/__tests__/executeCommandTool.spec.ts
```

- Result: 1 test file passed, 12 tests passed.
- Ran Agent Manager message list UI test from `webview-ui`:

```bash
pnpm exec vitest run src/kilocode/agent-manager/components/__tests__/MessageList.spec.tsx
```

- Result: 1 test file passed, 21 tests passed.
- Ran resend-history and read-file safety focused tests from `src`:

```bash
pnpm test core/webview/__tests__/ClineProvider.flicker-free-cancel.spec.ts core/tools/__tests__/readFileTool.spec.ts
```

- Result: 2 test files passed, 59 tests passed.
- Ran heredoc command auto-approval focused tests from `src`:

```bash
pnpm test core/auto-approval/__tests__/commands.spec.ts shared/__tests__/parse-command.spec.ts core/tools/__tests__/executeCommandTool.spec.ts
```

- Result: 3 test files passed, 35 tests passed.
- Replayed the reported nested quoted-heredoc command through `parseCommand()` and `getCommandDecision()`; the command is parsed as heredoc script creation plus `bash /tmp/ensure_disable_vscodium_kilocode.sh`, and the auto-approval decision is now `auto_approve`.
- Ran OpenAI Compatible settings UI test from `webview-ui`:

```bash
pnpm exec vitest run src/components/settings/providers/__tests__/OpenAICompatible.spec.tsx
```

- Result: 1 test file passed, 13 tests passed.
- Ran completed terminal retention focused tests from `src`:

```bash
pnpm test integrations/terminal/__tests__/TerminalRegistry.spec.ts
```

- Result: 1 test file passed, 8 tests passed.
- Re-ran completed terminal retention focused tests after preventing retained completed terminal reuse:

```bash
pnpm exec vitest run integrations/terminal/__tests__/TerminalRegistry.spec.ts
```

- Result: 1 test file passed, 14 tests passed.
- Ran terminal retention, command substitution parsing, and command auto-approval focused tests from `src`:

```bash
pnpm exec vitest run integrations/terminal/__tests__/TerminalRegistry.spec.ts shared/__tests__/parse-command.spec.ts core/auto-approval/__tests__/commands.spec.ts
```

- Result: 3 test files passed, 35 tests passed.
- Ran command completion, stale resend response, webview ask-response guard, and terminal retention focused tests from `src`:

```bash
pnpm exec vitest run core/tools/__tests__/executeCommandTool.spec.ts core/task/__tests__/ask-queued-message-drain.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts integrations/terminal/__tests__/TerminalRegistry.spec.ts
```

- Result: 4 test files passed, 50 tests passed.
- Ran final force-send, resend, command-output continuation, and Agent Manager regression tests from `src`:

```bash
pnpm exec vitest run core/webview/__tests__/webviewMessageHandler.spec.ts core/kilocode/agent-manager/__tests__/AgentManagerProvider.ipc.spec.ts core/kilocode/agent-manager/__tests__/message-handling.spec.ts core/tools/__tests__/executeCommandTool.spec.ts
```

- Result: 4 test files passed, 43 tests passed.
- Re-ran command-output continuation focused tests after fixing the output-callback wait path:

```bash
pnpm exec vitest run core/tools/__tests__/executeCommandTool.spec.ts
```

- Result: 1 test file passed, 14 tests passed.
- Ran final chat and Agent Manager UI regression tests from `webview-ui`:

```bash
pnpm exec vitest run src/components/chat/__tests__/ChatView.spec.tsx src/components/chat/__tests__/ChatView.notification-sound.spec.tsx src/kilocode/agent-manager/components/__tests__/MessageList.spec.tsx
```

- Result: 3 test files passed, 31 tests passed, 12 skipped.
- Ran final Agent Runtime force-send tests:

```bash
cd ../packages/agent-runtime && pnpm test src/__tests__/force-send.test.ts
```

- Result: 1 test file passed, 3 tests passed.
- Ran busy-send/resend chat UI focused test from `webview-ui`:

```bash
pnpm exec vitest run src/components/chat/__tests__/ChatView.spec.tsx
```

- Result: 1 test file passed, 6 tests passed, 12 skipped.
- Ran settings change-detection tests from `webview-ui`:

```bash
pnpm exec vitest run src/components/settings/__tests__/SettingsView.change-detection.spec.tsx src/components/settings/__tests__/SettingsView.unsaved-changes.spec.tsx
```

- Result: 2 test files passed, 3 tests passed, 5 skipped.
- Ran task progress file system prompt tests from `src`:

```bash
pnpm exec vitest run core/prompts/__tests__/system-prompt.spec.ts
```

- Result: 1 test file passed, 19 tests passed.
- Ran full monorepo type checks:

```bash
pnpm check-types
```

- Result: 22 tasks passed.
- Full `src/core/webview/__tests__/ClineProvider.spec.ts` still has unrelated edit-message/cleanup expectation failures outside this change area; the new startup-sync test passes in isolation.
- Built final VSIX with `./scripts_package_deeptask_vsix.sh`.
- Package script verified VSIX identity, required files, Deeptask branding resources, and absence of known Kilo residue patterns.
- Additional package checks confirmed:
    - extension bundle contains OpenAI Compatible default profile seed
    - extension bundle contains `gpt-4o` seed
    - extension bundle contains fresh-install onboarding skip logic
    - extension bundle contains startup synchronization from seeded provider profiles to active state
    - extension bundle contains OpenAI Compatible context-window fill control
    - extension bundle contains Agent Manager Deeptask icon URI injection
    - extension bundle contains `getState()` startup profile synchronization before active state is read
    - extension bundle contains default profile metadata repair logic for `listApiConfigMeta`
    - extension bundle contains context secret cache refresh before seeded profile activation is reflected in active state
    - extension bundle contains legacy bundled `kilocode/minimax-m2.1:free` default migration logic
    - webview bundle contains the Agent Manager image error handler and inline SVG fallback
    - extension bundle contains `taskProgressFileEnabled` and the `TASK PROGRESS FILE` system prompt section
    - webview bundle contains `taskProgressFileEnabled`, `Create task progress file`, and `创建任务进度文件`
    - VSIX contains the packaged Agent Manager icon target `assets/icons/logo-outline-black.png`
    - installed VS Code sourcemap contains the final OpenAI Compatible logic that keeps dropdown model IDs while using only real `openAiModelInfos` for context detection
    - packaged README contains release highlights and source layout
    - packaged README states no embedded model API base URI or API key
- Installed into VS Code with:

```bash
code --install-extension deeptask-5.5.0.vsix --force
```

- Final package script verified `deeptask-5.5.0.vsix` with size marker `42409529`.
- Installed final VSIX into VSCodium with:

```bash
codium --install-extension deeptask-5.5.0.vsix --force
```

- Confirmed installed VSCodium extension:

```text
deeptask.deeptask@5.5.0
```

- Confirmed installed extension:

```text
deeptask.deeptask@5.5.0
```

- Confirmed VS Code global storage after activation:

```text
currentApiConfigName: default
apiProvider: openai
kilocodeModel: undefined
openAiModelId: gpt-4o
listApiConfigMeta: [{"name":"default","id":"2dykdgofzn4","apiProvider":"openai","modelId":"gpt-4o"}]
```

## Notes

- Root `pnpm bundle` currently fails because `jetbrains/plugin/turbo.json` references `kilo-code#vsix:unpacked`; the successful release path uses `src` workspace bundling and the existing VSIX packaging script.
- No dependencies were reinstalled during this task, so no `requirements.txt` update was required.
