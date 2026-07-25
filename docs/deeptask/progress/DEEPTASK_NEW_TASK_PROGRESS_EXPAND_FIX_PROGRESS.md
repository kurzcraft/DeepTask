# Deeptask 新任务复读完成内容与进度扩展修复进度

## Checklist

- [x] 检索相关记忆与完成态续跑上下文
- [x] 定位新任务时复读“已完成内容”的根因
- [x] 实现续跑提示词与 todo/进度扩展修复
- [x] 补充回归测试并验证
- [x] 打包 VSIX、安装 VSCodium、发布 GitHub
- [x] 存储项目/错误记忆

## Current Findings

- 用户新任务反馈：给新指令时模型一直重复自己完成了什么，而不是主动扩展进度列表并开始新工作。
- 已有完成态续跑修复：DeepTask 模式下 `attempt_completion` 会降级为普通文本；续跑会清 all-completed todos，并拒绝未做真实工作就 completion。
- 根因确认：
  1. 续跑提示词虽禁止总结旧任务，但未强制“立刻扩展进度列表并只服务新指令”。
  2. DeepTask 把 completion 降级为普通 `text` 后，`stripCompletedAttemptCompletionFromHistory()` 只能删 `attempt_completion` tool_use，旧完成摘要文本仍留在 API 历史，模型容易复读。
  3. 仅在 todos 全部 completed 时清空 todoList；半完成旧列表会继续作为 REMINDERS 注入，诱导复述旧进度。
  4. 进度列表扩展要求不够硬：新任务到来时应主动 `update_todo_list` 扩展/重置为新任务里程碑，而不是复述旧完成项。

## Decisions

- 强化 `buildUserContinuationText`：禁止复述旧完成内容；要求先扩展进度列表，再执行新指令。
- 续跑时更积极清理旧 todo 状态，避免旧 REMINDERS 污染新任务。
- 续跑时清理最近“完成态风格”的 assistant 摘要残留，避免模型复读。
- 完成后打包安装 VSCodium 并发布 GitHub Release。

## Changes

- [`src/core/task/Task.ts`](src/core/task/Task.ts):
  - `stripCompletedAttemptCompletionFromHistory()` 在无 `attempt_completion` tool_use 时，继续剥离 trailing text-only assistant 摘要。
  - `clearCompletedTodoListForContinuation()` 改为清空任意旧 todoList，避免半完成 REMINDERS 污染。
  - `buildUserContinuationText()` 强制禁止复述旧完成，并要求立即 `update_todo_list` 扩展新进度。
- [`src/core/task/__tests__/Task.spec.ts`](src/core/task/__tests__/Task.spec.ts):
  - 覆盖半完成 todo 清理、text-only 摘要剥离、新提示词约束。
- [`.changeset/fix-new-task-progress-expand.md`](.changeset/fix-new-task-progress-expand.md): 发布说明。

## Verification Log

- 2026-07-11: 已读取 `Task.ts` 续跑/completion 降级路径、`UpdateTodoListTool.ts`、进度文件提示词与相关记忆。
- 2026-07-11: `cd src && pnpm test core/task/__tests__/Task.spec.ts core/tools/__tests__/attemptCompletionTool.spec.ts core/tools/__tests__/updateTodoListTool.spec.ts` 通过：3 files passed，100 passed，4 skipped。


## Release Log
- 2026-07-11 14:28 CST: commit `1886f2c2` (`fix(task): 新任务续跑禁止复述旧进度并强制扩展清单`)
- 2026-07-11 14:29 CST: `bash scripts_package_deeptask_vsix.sh` 生成 `deeptask-5.5.0.vsix` (42,404,788 bytes)
- 2026-07-11 14:29 CST: VSCodium 安装确认 `deeptask.deeptask@5.5.0`；VSIX/installed 均包含强制进度扩展与禁止复述旧完成文案
- 2026-07-11 14:30 CST: `git push origin main` → `a39bb9a6..1886f2c2`
- 2026-07-11 14:30 CST: GitHub release `v5.5.0` 更新成功
  - release: https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0
  - asset: https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix
