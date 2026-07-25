# DeepTask 发送消息卡死全面深入审计进度

## 目标

继续全面深入修复各种情况下发送消息可能导致的卡死问题。重点不是单一复现，而是建立发送状态机不变量：任何携带用户意图的输入都必须被消费、排队、续跑或显式拒绝，不能被静默丢弃，也不能卡在 stale ask/queue/optimistic UI 状态。

## 检查清单

- [-] 创建/恢复本轮全面发送卡死审计进度
- [ ] 审计前端发送入口和乐观消息去重
- [ ] 审计后端 askResponse/queueMessage/newTask/terminalOperation 状态分支
- [ ] 审计 Task continuation、abort、queue、ask 生命周期不变量
- [x] 补齐可复现竞态和边界回归测试
- [x] 实现必要修复并运行聚焦测试
- [x] 打包安装 VSCodium 并更新 GitHub Release
- [-] 存储 universe-memory 经验

## 已恢复上下文

- 已查询 universe-memory，命中 `2026-07-08-Deeptask任意状态发送不丢消息修复.md`。
- 已知上轮修复：后端 `messageResponse + hasMessagePayload` 兜底 continuation、completion 历史判断、stale edit/delete 幂等忽略、短窗口 continuation 去重。

## 本轮审计假设

- 仍可能存在其它入口绕过上述兜底，例如 `queueMessage`、`newTask`、terminal operation、前端 optimistic feedback 或 stale askTs 分支。
- 需要把“用户 payload 必须被消费”的原则转成测试矩阵，而不是只覆盖已知两个分支。

## 审计发现

- 前端按钮/忙碌发送路径会在发送后 `setSendingDisabled(true)`，因此后端必须消费 payload 或显式刷新状态，否则 UI 容易灰态。
- `askResponse + hasMessagePayload` 上轮已兜底到 `continueTaskFromUserMessage()`。
- 新发现：`queueMessage` legacy 分支在无 cancel/terminal/pending ask 时只调用 `say("user_feedback")`，不会启动 continuation。若前端、命令面板、旧扩展消息或自动化仍发 `queueMessage`，用户会看到反馈但模型不继续，表现为发送后卡住。
- `handleTerminalOperation("continue")` 只负责当前 terminal process；没有 terminal process 时清 stale ask 是合理的，但 `queueMessage` 不应把普通用户意图降级为纯显示消息。

## 修复记录

- `src/core/webview/webviewMessageHandler.ts`：`queueMessage` legacy 分支在无 cancel/terminal/pending ask 且携带非空 payload 时，改为清 stale ask 后调用 `continueTaskFromUserMessage()`，不再只写 `user_feedback`。
- `src/core/webview/__tests__/webviewMessageHandler.spec.ts`：新增 legacy `queueMessage` 回归测试，覆盖非空 payload 必须续跑、空 payload 只清理状态两种边界。
- `.changeset/fix-legacy-queue-send-stall.md`：记录用户可见修复。

## 验证记录

- `pnpm exec prettier --write src/core/webview/webviewMessageHandler.ts src/core/webview/__tests__/webviewMessageHandler.spec.ts DEEPTASK_SEND_STUCK_DEEP_AUDIT_PROGRESS.md`：通过。
- `cd src && pnpm test core/webview/__tests__/webviewMessageHandler.spec.ts core/task/__tests__/Task.spec.ts`：通过，2 files passed，91 passed，4 skipped。
- 提交并推送：`1921e07a fix: resume legacy queued sends`。
- `bash scripts_package_deeptask_vsix.sh`：通过，生成并验证 `deeptask-5.5.0.vsix`，大小 42,402,675 bytes。
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force`：通过，确认 `deeptask.deeptask@5.5.0`。
- `node scripts_publish_github_release.mjs`：通过，更新 GitHub Release `v5.5.0` 资产 `deeptask-5.5.0.vsix`，大小 42,402,675 bytes。

## 当前阻塞

- 无。
