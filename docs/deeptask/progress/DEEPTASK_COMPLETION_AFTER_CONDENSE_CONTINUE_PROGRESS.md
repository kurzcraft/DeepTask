# DeepTask 完成后上下文切割再发送续跑修复进度

## 目标

修复任务完成后继续发送任务，在上下文切割/condense 后模型只根据 summary 询问下一步或输出结束总结，而不执行用户新任务的问题。

## 检查清单

- [x] 查询 universe-memory 与历史进度文件
- [x] 恢复相关发送卡死、完成态续跑、legacy queue 修复上下文
- [x] 定位上下文切割后续跑提示缺陷
- [x] 修改续跑提示，明确用户新消息必须立即执行
- [x] 补充 condense 后完成态续跑回归测试
- [x] 运行定向测试与格式检查
- [x] 打包 VSIX 并安装到 VSCodium
- [x] 发布 GitHub Release
- [x] 更新 changeset 与 universe-memory

## 当前发现

- 既有修复已覆盖完成态 UI 历史仍有 `completion_result` 的发送路由，以及 API 历史中 `attempt_completion` 尾部清理。
- 第一轮假设是上下文压缩语义污染：condense 后有效 API 历史只保留 summary，模型可能认为应该“询问下一步”或“总结完成”。该假设不完整。
- 用户复测反馈“还是把我标记成完成”后，真正根因定位到 task history metadata：`ClineProvider.updateTaskHistory()` 会合并旧字段，`taskMetadata()` 的普通保存不带 `status`，因此旧 `status: "completed"` 会在 continuation 后继续保留。
- 所以必须在 `continueTaskFromUserMessage()` 启动续跑时显式把当前 history item 从 `completed` 改回 `active`，否则 UI/历史仍显示完成。

## 决策

- 在续跑提示中明确：`user_message` 是当前最高优先级新指令，必须继续执行；不要把它当作对已完成任务的确认、摘要请求或要求询问下一步。
- 在 continuation 启动前显式 re-activate 已完成历史项，防止 `updateTaskHistory()` 合并旧 `completed` 状态。
- 保持已有 `attempt_completion` 尾部截断逻辑，避免旧 completion 工具结果污染新轮。

## 修复记录

- `src/core/task/Task.ts`：增强 `continueTaskFromUserMessage()` 注入的新用户消息，明确新消息优先于旧 completion、summary、condense-response 指令，必须立即执行。
- `src/core/task/Task.ts`：新增 `reactivateCompletedHistoryForContinuation()`，在 continuation 启动时若当前 task history 是 `completed`，先更新为 `active`。
- `src/core/task/__tests__/Task.spec.ts`：新增 summary-only 完成后续发回归测试，覆盖上下文切割后只剩总结时，新用户消息仍作为 actionable continuation。
- `src/core/task/__tests__/Task.spec.ts`：新增 completed history reactivation 回归测试，防止续发后仍被标记完成。
- `.changeset/fix-condensed-completion-continuation.md`：记录用户可见修复。

## 验证记录

- `pnpm test core/task/__tests__/Task.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts`（cwd: `src`）：通过，2 files passed，93 passed，4 skipped。
- `pnpm exec prettier --write src/core/task/Task.ts src/core/task/__tests__/Task.spec.ts DEEPTASK_COMPLETION_AFTER_CONDENSE_CONTINUE_PROGRESS.md`：通过。
- `bash scripts_package_deeptask_vsix.sh`：通过，生成并校验 `deeptask-5.5.0.vsix`，大小 42,403,057 bytes。
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force && codium --list-extensions --show-versions | rg '^deeptask\\.deeptask@'`：通过，确认 `deeptask.deeptask@5.5.0`。
- `node scripts_publish_github_release.mjs`：通过，更新 GitHub Release `v5.5.0` 资产 `deeptask-5.5.0.vsix`，大小 42,403,057 bytes。
- Release 地址：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- 资产地址：`https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`。
