# Deeptask Completed Continuation Final Fix Progress

## Checklist

- [x] Restore context from memories and prior progress files
- [x] Audit current continuation and completion-status paths
- [x] Identify the real trigger chain behind summary/result messages ending the task
- [x] Implement robust fix so every new user send reactivates the task before model execution
- [x] Downgrade continuation-turn `attempt_completion` output to normal assistant text
- [x] Prevent continuation-turn `update_todo_list` from marking every item completed
- [x] Add or update regression tests
- [-] Run focused tests and type-safe verification
- [ ] Package VSIX, install into VSCodium, and publish GitHub release
- [ ] Store corrected project/error memory

## Current Status

- 2026-07-10 04:04 CST correction: user clarified the task is still in the testing stage. Treat packaging, VSCodium installation, GitHub Release publication, and final memory storage as pending until the current verification pass is explicitly completed.
- 2026-07-10 04:19 CST: new user counterexample shows the prior continuation-only guard is still insufficient because Deeptask must never report `completion_result` for any user send. Current fix implemented: make DeepTask mode downgrade every `attempt_completion` to normal assistant text and keep history status active.
- 2026-07-10 04:23 CST: focused regression tests passed after correcting the mode-read race in the new test. Still pending: package/install/release only if requested after this verification stage.

## Current Findings

- User provided a new counterexample after the resume-path fix: message content such as "汇总安装位置、skill 内容和测试结论" still leads Deeptask to answer "已完成" with a summary, which means the remaining bug is not only completed-history resume state.
- Root cause now identified with high confidence: `attempt_completion` is overloaded as both "show a final-looking answer" and "end the task". The prompt/tool loop forces tool use, so ordinary continuation replies such as summaries can be emitted through `attempt_completion`, and `AttemptCompletionTool` then sends `completion_result`, emits `TaskCompleted`, and moves Agent state to completed.
- State repairs are still necessary: prior memory says prompt-only fixes were insufficient because task history metadata can remain `completed`.
- `ClineProvider.updateTaskHistory()` merges old and new history items, so a later metadata save without `status` preserves stale `completed`.
- `Task.saveClineMessages()` uses `taskMetadata()` and previously passed only `initialStatus`, so continued completed tasks could lose explicit active status on routine saves.
- Resuming a completed task from history uses `resumeTaskFromHistory()`, not `continueTaskFromUserMessage()`, so the active-status/todo-cleanup/continuation-prompt repairs must apply to both paths.
- `handlePartial()` also needed the same downgrade because streamed `attempt_completion` blocks could otherwise send `completion_result` before final execution.
- New counterexample after the completion downgrade: the model can first call `update_todo_list` to mark the final checklist item completed, then announce that it will give the final result. This means the completion chain also includes todo state: all-completed reminders push the model into finalization even if `attempt_completion` is downgraded.
- New root cause for "任务结束后模型空调用工具": after active-continuation `attempt_completion` is downgraded to normal text, the tool still pushes a synthetic `tool_result` into `userMessageContent`. If the loop sends that synthetic result back to the model, the protocol expects another assistant tool call, producing the empty-tool-call behavior after the user-visible answer.
- Latest counterexample implies the invariant must be scoped to Deeptask mode itself, not just to `shouldKeepNextCompletionActive`; otherwise any path that reaches `attempt_completion` outside the continuation flag can still emit `completion_result` and end the task.

## Decisions

- Treat the previous resume-path fix as necessary but insufficient; the real completion bug is the `attempt_completion` -> `completion_result` -> `TaskCompleted` coupling during active continuations.
- Treat status repair as a state-machine invariant, not only a prompt change.
- Before a continuation send reaches model execution, task history metadata must explicitly become `active`.
- After continuation starts, ordinary metadata saves must keep writing `status: "active"` so stale `completed` cannot reappear through merge semantics.
- In active continuation turns, `attempt_completion` must render as normal assistant `text` and stop the current loop without emitting `completion_result`, telemetry completion, or `TaskCompleted`.
- Apply the downgrade in both final execution and streaming partial paths.
- During active continuation turns, reject the semantic effect of an all-completed todo list by keeping the last item `in_progress`. This prevents the model from using `update_todo_list` as a pre-completion step.
- Keep API history cleanup of old `attempt_completion` before model execution.
- When an active-continuation completion has already been rendered as normal text, end the current task loop locally and clear the synthetic tool result instead of sending it into a second model turn.
- Strengthened invariant: in DeepTask mode, `attempt_completion` must never emit `completion_result`/`TaskCompleted`; it is only a visible answer boundary. This is broader than the previous active-continuation predicate and directly matches the user's requirement that any later message must not receive “任务完成”.

## Changes

- `src/core/task/Task.ts`: added `continuationStatusOverride` and set it when user continuation starts.
- `src/core/task/Task.ts`: `saveClineMessages()` now passes the continuation override to `taskMetadata()` so follow-up saves persist `active`.
- `src/core/task/Task.ts`: clears an all-completed `todoList` before continuation so the next environment details cannot inject stale all-completed `REMINDERS` that make the model summarize instead of working.
- `src/core/task/__tests__/Task.spec.ts`: strengthened completed-continuation regression to assert both immediate and subsequent metadata saves write `active`.
- `src/core/task/__tests__/Task.spec.ts`: added a regression test for clearing all-completed todos on continuation.
- `.changeset/fix-completed-continuation-active-status.md`: added release note.
- `src/core/task/Task.ts`: centralized continuation instruction text and strengthened it to forbid treating new input as completion approval or calling `attempt_completion` before the new instruction is actually done.
- `src/core/task/Task.ts`: `resumeTaskFromHistory()` now marks completed-history tasks active and clears all-completed todos when the user provides a new message through `resume_completed_task`.
- `src/core/task/Task.ts`: sets `shouldKeepNextCompletionActive` for continuation paths and stops the current loop after an active-response completion is handled.
- `src/core/tools/AttemptCompletionTool.ts`: downgrades continuation-turn `attempt_completion` results to normal `text` messages and avoids `completion_result`, `TaskCompleted`, and completion telemetry.
- `src/core/tools/AttemptCompletionTool.ts`: applies the same downgrade in `handlePartial()` so streamed completion blocks cannot flip UI/Agent state to completed.
- `src/core/task/__tests__/Task.spec.ts`: added regression coverage for completed-task resume with fresh user input and the downgrade flag.
- `src/core/tools/__tests__/attemptCompletionTool.spec.ts`: added regression coverage for final and streamed active-continuation completions.
- `src/core/task/Task.ts`: added `normalizeTodoListForActiveContinuation()` to keep the last todo `in_progress` when an active continuation tries to mark every item completed.
- `src/core/tools/UpdateTodoListTool.ts`: applies continuation todo normalization before saving the todo list and returns a tool result that tells the model the continued task is still active.
- `src/core/task/__tests__/Task.spec.ts`: added regression coverage for continuation all-completed todo normalization and non-continuation behavior.
- `src/core/tools/__tests__/updateTodoListTool.spec.ts`: added regression coverage for the reported sequence where the model marks the final todo completed before presenting a final result.
- `src/core/task/Task.ts`: clears pending `userMessageContent` and returns from the current request loop when `endCurrentLoopAfterActiveCompletion` is set, preventing downgraded completion `tool_result` feedback from forcing another tool call.
- `src/core/task/__tests__/Task.spec.ts`: added regression coverage that a downgraded completion's synthetic tool result is discarded and does not trigger another API/tool-call turn.
- `src/core/task/Task.ts`: made `shouldDowngradeCompletionToActiveResponse()` async and return `true` for DeepTask mode, so any `attempt_completion` renders as normal text instead of ending the task.
- `src/core/tools/AttemptCompletionTool.ts`: awaits the strengthened downgrade predicate in both final execution and streaming partial handling.
- `src/core/task/__tests__/Task.spec.ts`: added coverage for DeepTask-mode unconditional completion downgrade.
- `src/core/tools/__tests__/attemptCompletionTool.spec.ts`: added coverage that DeepTask-style downgrade avoids `completion_result`, `TaskCompleted`, and tool-result feedback even outside active continuation.
- `src/core/task/Task.ts`: corrected the mode check to use the already-initialized `_taskMode` before awaiting `getTaskMode()`, preventing async initialization from overwriting the test/runtime DeepTask mode with default `code`.

## Verification

- `pnpm test core/task/__tests__/Task.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts` (cwd: `src`): passed, 2 files passed, 93 passed, 4 skipped.
- `pnpm test core/task/__tests__/Task.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts core/environment/__tests__/getEnvironmentDetails.spec.ts` (cwd: `src`): passed after stale completed reminders fix, 3 files passed, 117 passed, 4 skipped.
- `pnpm exec prettier --write src/core/task/Task.ts src/core/task/__tests__/Task.spec.ts .changeset/fix-completed-continuation-active-status.md DEEPTASK_COMPLETED_CONTINUATION_FINAL_FIX_PROGRESS.md`: passed, unchanged.
- `bash scripts_package_deeptask_vsix.sh`: passed, generated and verified `deeptask-5.5.0.vsix`, final size 42,403,183 bytes.
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force && codium --list-extensions --show-versions | rg '^deeptask\\.deeptask@'`: passed, confirmed `deeptask.deeptask@5.5.0`.
- Stored project memory: `/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-10-Deeptask完成态历史恢复续跑最终修复.md`.
- Stored error memory: `/home/kurz/Obsidian/宇宙/记忆/错误记忆/2026-07-10-Deeptask完成态续跑漏修resume路径.md`.
- `node scripts_publish_github_release.mjs`: passed, updated GitHub Release `v5.5.0` asset `deeptask-5.5.0.vsix`, final size 42,403,183 bytes.
- Release URL: `https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`.
- Asset URL: `https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`.
- `pnpm test core/task/__tests__/Task.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts` (cwd: `src`): initially failed because the new test expected the first metadata write to be active, but `resumeTaskFromHistory()` legitimately performs an earlier ordinary history save before user input. Updated the test to assert an active write exists and the final save remains active.
- `pnpm test core/task/__tests__/Task.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts` (cwd: `src`): passed after test correction, 2 files passed, 95 passed, 4 skipped.
- `pnpm exec prettier --write src/core/task/Task.ts src/core/task/__tests__/Task.spec.ts DEEPTASK_COMPLETED_CONTINUATION_FINAL_FIX_PROGRESS.md`: passed, unchanged.
- `bash scripts_package_deeptask_vsix.sh`: passed, generated and verified `deeptask-5.5.0.vsix`, final size 42,403,229 bytes.
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force && codium --list-extensions --show-versions | rg '^deeptask\\.deeptask@'`: passed, confirmed `deeptask.deeptask@5.5.0`.
- `pnpm test core/task/__tests__/Task.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts core/tools/__tests__/attemptCompletionTool.spec.ts` (cwd: `src`): passed after active-response completion downgrade, 3 files passed, 108 passed, 4 skipped.
- `pnpm exec prettier --write src/core/tools/AttemptCompletionTool.ts src/core/tools/__tests__/attemptCompletionTool.spec.ts src/core/task/Task.ts src/core/task/__tests__/Task.spec.ts DEEPTASK_COMPLETED_CONTINUATION_FINAL_FIX_PROGRESS.md .changeset/fix-completed-continuation-active-status.md`: passed, unchanged.
- `bash scripts_package_deeptask_vsix.sh`: passed, generated and verified `deeptask-5.5.0.vsix`, final size 42,403,578 bytes.
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force && codium --list-extensions --show-versions | rg '^deeptask\\.deeptask@'`: passed, confirmed `deeptask.deeptask@5.5.0`.
- `pnpm exec prettier --write src/core/task/Task.ts src/core/tools/UpdateTodoListTool.ts src/core/task/__tests__/Task.spec.ts src/core/tools/__tests__/updateTodoListTool.spec.ts`: passed.
- `pnpm test core/task/__tests__/Task.spec.ts core/tools/__tests__/updateTodoListTool.spec.ts core/tools/__tests__/attemptCompletionTool.spec.ts` (cwd: `src`): passed after todo-finalization guard, 3 files passed, 92 passed, 4 skipped.
- `pnpm exec prettier --write src/core/task/Task.ts src/core/tools/UpdateTodoListTool.ts src/core/task/__tests__/Task.spec.ts src/core/tools/__tests__/updateTodoListTool.spec.ts DEEPTASK_COMPLETED_CONTINUATION_FINAL_FIX_PROGRESS.md .changeset/fix-completed-continuation-active-status.md && bash scripts_package_deeptask_vsix.sh`: passed, generated and verified `deeptask-5.5.0.vsix`, final size 42,403,991 bytes.
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force && codium --list-extensions --show-versions | rg '^deeptask\\.deeptask@'`: passed, confirmed `deeptask.deeptask@5.5.0`.
- `pnpm exec prettier --write src/core/task/__tests__/Task.spec.ts && cd src && pnpm test core/task/__tests__/Task.spec.ts core/tools/__tests__/attemptCompletionTool.spec.ts core/tools/__tests__/updateTodoListTool.spec.ts`: passed after empty-tool-call guard, 3 files passed, 93 passed, 4 skipped.
- `bash scripts_package_deeptask_vsix.sh && codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force && codium --list-extensions --show-versions | rg '^deeptask\\.deeptask@'`: passed, generated `deeptask-5.5.0.vsix` size 42,404,032 bytes and confirmed `deeptask.deeptask@5.5.0`.
- `pnpm exec prettier --write src/core/task/Task.ts src/core/tools/AttemptCompletionTool.ts src/core/task/__tests__/Task.spec.ts src/core/tools/__tests__/attemptCompletionTool.spec.ts DEEPTASK_COMPLETED_CONTINUATION_FINAL_FIX_PROGRESS.md && cd src && pnpm test core/task/__tests__/Task.spec.ts core/tools/__tests__/attemptCompletionTool.spec.ts core/tools/__tests__/updateTodoListTool.spec.ts`: initially failed because the new DeepTask-mode unit test set `_taskMode` while `taskModeReady` async initialization later overwrote it with default `code`.
- `pnpm test core/task/__tests__/Task.spec.ts core/tools/__tests__/attemptCompletionTool.spec.ts core/tools/__tests__/updateTodoListTool.spec.ts` (cwd: `src`): passed after making `shouldDowngradeCompletionToActiveResponse()` prefer current `_taskMode`, 3 files passed, 98 passed, 4 skipped.
