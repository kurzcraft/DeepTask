# DeepTask 任意状态发送不再卡死修复进度

## 检查清单

- [x] 确认命令执行前自动审批误判已修复并发布
- [x] 查询 universe-memory：未命中同主题记录
- [x] 恢复暂停发送、完成态发送、队列卡死、代办更新相关历史进度
- [x] 定位重复消息和“未找到该时间消息”的共性根因
- [x] 定位暂停后发送、命令完成后发送、更新代办中断后发送的卡死根因
- [x] 实现统一发送入口去重、解卡与状态恢复修复
- [x] 补充回归测试并运行聚焦测试
- [x] 打包安装到 VSCodium
- [-] 更新 GitHub Release
- [ ] 存储经验

## 用户反馈

- 命令卡在执行前。
- 命令执行完后暂停发送消息，消息队列卡死。
- 更新代办事项时中断，然后发送消息会卡死。
- 要求任何情况发送消息都不能卡死。
- 还出现两条消息，其中一条报“未找到该时间消息”的错误。

## 已完成部分

- 命令执行前卡住：已修复 `containsDangerousSubstitution()` 对 `node -e` 双引号内 JavaScript `=(...)` 的 zsh 进程替换误判，当前完整命令审批结果为 `{ dangerous: false, decision: "auto_approve" }`。
- 已提交并推送 `76ace122 fix: allow quoted inline script commands`。
- 已发布 `v5.5.0` Release 资产，`deeptask-5.5.0.vsix` 大小 42,402,575 bytes。

## 当前定位

- `webview-ui/src/components/chat/ChatView.tsx` 在 busy/streaming 下发送文本统一走 `askResponse: "messageResponse"`，并在本地插入乐观 `user_feedback`。
- `src/core/webview/webviewMessageHandler.ts` 的 `askResponse` 分支已有完成态、取消态、terminalProcess 和 pending ask 处理，但在“无 pending ask + 有用户文本 + 非 completion/cancel/terminal”时会落到最后 `else`，只清 stale 状态和 queue 并 `postStateToWebview()`，不会启动 continuation。这能解释用户看到发送后灰态/队列卡死。
- “未找到该时间消息”来自 edit/delete confirm 对旧 `messageTs` 调用 `showErrorMessage`，如果用户发送/中断导致消息已被重写或删除，确认回调应幂等忽略 stale ts 并刷新状态，而不是弹错误和保持旧 UI 心智状态。

## 修复记录

- `src/core/webview/webviewMessageHandler.ts`：对 `messageResponse + hasMessagePayload` 增加兜底 continuation 分支。即使没有 pending ask、没有 terminal process、不是 completion/cancel 特例，也会清理 stale ask/queue 并调用 `continueTaskFromUserMessage()`，避免用户文本被吞掉。
- `src/core/webview/webviewMessageHandler.ts`：完成态 continuation 不再要求最后一条消息必须是 `completion_result`，只要历史中存在非 partial 完成结果，非空用户输入就优先作为新 continuation。
- `src/core/webview/webviewMessageHandler.ts`：stale edit/delete confirm 对已经不存在的 `messageTs` 幂等忽略，清理 stale ask/queue 并刷新 webview，不再弹出“未找到该时间消息”。
- `src/core/task/Task.ts`：`stripCompletedAttemptCompletionFromHistory()` 截断最后一个 `attempt_completion` 之后的 API 尾部，避免完成后续发携带旧结束上下文。
- `src/core/task/Task.ts`：对 1.5 秒内完全相同的 continuation 请求做短窗口去重，防止同一次 UI 竞态触发两条重复消息/两轮任务循环。

## 验证记录

- `cd src && pnpm test core/webview/__tests__/webviewMessageHandler.spec.ts core/task/__tests__/Task.spec.ts`：通过，2 files passed，89 passed，4 skipped。
- `bash scripts_package_deeptask_vsix.sh`：通过，生成并验证 `deeptask-5.5.0.vsix`，大小 42,402,685 bytes。
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force && codium --list-extensions --show-versions | rg '^deeptask\.deeptask@'`：通过，确认 `deeptask.deeptask@5.5.0`。

## 发布记录

- 提交并推送：`3a8cf269 fix: keep user sends from stalling`。
- GitHub Release `v5.5.0` 已更新资产 `deeptask-5.5.0.vsix`，大小 42,402,685 bytes。
- Release 地址：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- 资产地址：`https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`。

## 待完成

- 存储 universe-memory 经验。
