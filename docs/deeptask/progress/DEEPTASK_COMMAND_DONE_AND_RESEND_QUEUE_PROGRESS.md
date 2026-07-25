# Deeptask command completion and resend queue progress

- [x] Create progress file
- [x] Locate why model reasoning does not continue after command completion
- [x] Locate why resend first stays queued and then hard-stalls with disabled buttons
- [x] Fix command completion so it safely auto-continues and returns to user-input state when appropriate
- [x] Fix resend/queued send recovery without requiring message deletion plus empty forced-continue message
- [x] Add regression tests
- [x] Run focused verification
- [x] Commit, push, rebuild VSIX, and update release
- [ ] Store final learning in universe memory

## Reported Issues

1. After the reported command finishes, the model does not continue reasoning.
2. More severe: when resending, the message first stays in the queue; after sending, the session hard-stalls, both buttons become disabled, and recovery currently requires deleting the message, clicking force continue, and sending an empty message.
3. Desired behavior: regardless of whether a command is still executing or already completed, sending/resending should be able to safely trigger force-continue semantics and then pause in a normal user-input-capable state instead of disabling controls permanently.

## Findings

- Command completion root cause: `onCompleted()` wrote `say("command_output")` as an interactive message, which updated `lastMessageTs` while `ask("command_output")` was still pending. That self-superseded the command-output ask and could prevent the model turn from continuing cleanly after the command ended.
- Stale resend root cause: `askResponse` and legacy `queueMessage` transports wrote into `Task.askResponse` even when no ask was actively pending. A busy resend could therefore leave a stale `messageResponse` for the next ask to consume immediately, while the UI already disabled buttons and expected backend progress.
- Queue root cause: old tests and comments still described queued-message replay, but the safer Deeptask behavior is direct feedback/continue plus stale queue clearing. Queue replay can steal the response slot from the real prompt after edits/resends.

## Fixes

- Command output completion is now written as non-interactive `say("command_output")`, so it does not overwrite the ask timestamp that the running `ask("command_output")` is waiting on.
- Command completion only auto-answers the advisory `command_output` ask while that ask is still pending; it no longer writes a stale `yesButtonClicked` after the ask has already settled or been superseded.
- Added `Task.hasPendingWebviewAskResponse()` and `Task.clearStaleWebviewAskResponse()` so webview transports can distinguish a valid waiting ask from stale resend/busy-send traffic.
- `askResponse` now only calls `handleWebviewAskResponse()` when a pending ask exists; otherwise it clears stale response state and legacy queue state, then posts state back to the webview.
- Legacy `queueMessage` is now treated as stale transport: it clears the queue, shows feedback as non-interactive, and only consumes the response if an ask was pending before the feedback row was written.
- ChatView tests now assert busy sends use direct `askResponse` transport rather than legacy `queueMessage`.

## Verification

Ran focused backend tests from `src`:

```bash
pnpm exec vitest run core/tools/__tests__/executeCommandTool.spec.ts core/task/__tests__/ask-queued-message-drain.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts
```

Result: 3 test files passed, 36 tests passed.

Ran focused frontend tests from `webview-ui`:

```bash
pnpm exec vitest run src/components/chat/__tests__/ChatView.spec.tsx
```

Result: 1 test file passed, 6 tests passed, 12 skipped.

## Terminal Retention Follow-up

User reported completed terminal retention was still inconsistent with limit 3: it could trim the newest terminal instead of the oldest, and later allow more than 3 completed terminals. Re-check found two remaining instability points:

- The previous fix treated `vscode.window.terminals` order as visible oldest/topmost order. That order can be reversed or otherwise differ from Deeptask's own creation/completion order, so trimming by that list can close the newest terminal.
- Disposed legacy Deeptask terminals can still appear in `vscode.window.terminals` for a short window. Recounting them can make pruning behavior inconsistent and can produce apparent counts above the configured limit.

Fixes added:

- Registered Deeptask terminals are now sorted by Deeptask terminal ID for retention pruning, so the oldest Deeptask terminal is closed first even if VS Code reports terminals in a different order.
- Legacy untracked `Kilo Code` terminals discovered from `vscode.window.terminals` receive a stable discovery order and are recorded in a `WeakSet` after disposal so they are not counted repeatedly while VS Code still exposes them.

Ran focused terminal retention tests from `src`:

```bash
pnpm exec vitest run integrations/terminal/__tests__/TerminalRegistry.spec.ts
```

Result: 1 test file passed, 12 tests passed.

Final combined focused verification:

```bash
cd src && pnpm exec vitest run core/tools/__tests__/executeCommandTool.spec.ts core/task/__tests__/ask-queued-message-drain.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts integrations/terminal/__tests__/TerminalRegistry.spec.ts
cd webview-ui && pnpm exec vitest run src/components/chat/__tests__/ChatView.spec.tsx
```

Result: backend 4 test files passed, 48 tests passed; frontend 1 test file passed, 6 tests passed, 12 skipped.

## Memory Query

- Queried universe memory for Deeptask command completion, resend queue, force continue, and disabled-button stalls.
- Result: no direct matches found.

## Release

Commit pushed:

```text
666e58b fix: recover command continuation and retention
```

GitHub release updated:

```text
Release: https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0
VSIX: https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix
Asset size: 43,754,048 bytes
```
