# Deeptask Green Completion Keep Active Progress

## Checklist

- [x] Query universe memory and prior completion-state fixes
- [x] Audit attempt_completion / Task completion / continue paths
- [x] Reproduce root cause of non-green text + no continuation
- [x] Implement fix: green completion UI without lifecycle end; later user messages continue work
- [x] Add/update regression tests
- [x] Run focused tests
- [x] Package VSIX, install into VSCodium, publish GitHub release
- [x] Store project/error memory

## Current Status

- 2026-07-11: User reports previous fix is still insufficient:
    1. Ending text is not green
    2. Sending another message does not continue work
    3. Without an explicit user end instruction, the agent must not end the task
- 2026-07-11 15:56 CST: User instructed to package, install into VSCodium, and push GitHub release.
- 2026-07-11 16:18 CST: Fix verified, packaged, installed, committed, pushed, and released.

## Current Findings

- Green text is rendered only for `completion_result` in [`ChatRow.tsx`](webview-ui/src/components/chat/ChatRow.tsx).
- DeepTask previously downgraded every `attempt_completion` to ordinary `say("text")` via [`shouldDowngradeCompletionToActiveResponse()`](src/core/task/Task.ts), then called `markActiveResponseCompletionHandled()` which ended the current task loop without a settled ask.
- Ending the loop without an `ask("completion_result")` leaves no pending ask. UI `sendingDisabled` can remain true after `handleChatReset()`, because a final `say:text` does not reset button/send state.
- User still wants continuation after a final-looking answer. Therefore the correct invariant is:
    - Visual/final answer boundary: may use green `completion_result`
    - Lifecycle completion: must remain forbidden unless the user explicitly ends
    - Subsequent user messages must resume work
- Long-command Run/Continue stuck shares the same “stale UI control after settled ask” failure class and was fixed together.

## Decisions

- In DeepTask mode, treat `attempt_completion` as a soft completion:
    1. Render green `completion_result`
    2. Do not emit `TaskCompleted` / completion telemetry
    3. Keep history status `active`
    4. End only the current response loop via `endCurrentLoopAfterActiveCompletion`
    5. User typed feedback continues the task; only explicit end/new-task paths end the session
- Keep premature-completion rejection when continuation work tools have not run yet.
- Fix UI send-state so a settled non-ask final text/completion does not leave the chat stuck.
- Package/install/release uses repository scripts:
    - `bash scripts_package_deeptask_vsix.sh`
    - `codium --install-extension ... --force`
    - `node scripts_publish_github_release.mjs` targeting `v5.5.0`

## Changes

- [`src/core/tools/AttemptCompletionTool.ts`](src/core/tools/AttemptCompletionTool.ts): DeepTask soft completion uses green `completion_result` without TaskCompleted telemetry.
- [`src/core/task/Task.ts`](src/core/task/Task.ts): keep history status `active`, mark soft completion handled, end current loop only after soft completion is rendered.
- [`src/core/webview/webviewMessageHandler.ts`](src/core/webview/webviewMessageHandler.ts) + [`ChatView.tsx`](webview-ui/src/components/chat/ChatView.tsx): ensure post-completion user messages continue; stale Run/Continue with live terminal resume work.
- Regression tests updated in Task / AttemptCompletion / ChatView / webviewMessageHandler specs.
- Changesets:
  - `.changeset/fix-soft-completion-keep-active.md`
  - `.changeset/fix-long-command-run-button-stuck.md`

## Verification

- 2026-07-11: focused tests passed:
  - `cd src && pnpm exec vitest run core/task/__tests__/Task.spec.ts core/tools/__tests__/attemptCompletionTool.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts core/task/__tests__/Task.terminal-operation.spec.ts`
    - 4 files, 126 passed, 4 skipped
  - `cd webview-ui && pnpm exec vitest run src/components/chat/__tests__/ChatView.spec.tsx`
    - 1 file, 9 passed, 12 skipped
- Package: `bash scripts_package_deeptask_vsix.sh` → `deeptask-5.5.0.vsix` size `42407297`
- Install: `codium --install-extension deeptask-5.5.0.vsix --force` → `deeptask.deeptask@5.5.0`
- Installed markers present under `/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0`:
  - `Failed to save answered command ask state`
  - `endCurrentLoopAfterActiveCompletion`
  - soft-completion / continue paths
- Git: already on `main` at `4d643c50` (`fix(task): DeepTask 软完成保持绿色并可续跑`), clean working tree, synced with `origin/main`
- GitHub release updated:
  - https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0
  - asset: `deeptask-5.5.0.vsix` (`42407297`)

## Entropy

任务前：软完成展示与生命周期完成纠缠，续跑与长命令 Run 卡死路径不确定。  
任务后：软完成保持绿色且 active，续跑与 Run/Continue 卡死均有代码/测试/安装/发布闭环。净熵下降。
