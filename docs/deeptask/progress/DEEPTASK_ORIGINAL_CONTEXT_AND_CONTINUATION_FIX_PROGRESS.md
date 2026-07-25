# DeepTask 原版上下文压缩与任务继续修复进度

## 检查清单

- [x] 查询/记录本次用户纠正与任务范围
- [x] 对照原版完整上下文压缩实现
- [x] 对照当前实现的压缩触发、进度 UI、错误处理与历史写入
- [x] 对照任务结束后继续任务链路
- [x] 推演自动压缩、手动压缩、压缩失败 fallback、任务完成后继续四条路径
- [x] 修复所有确认问题
- [x] 补充回归测试
- [x] 运行聚焦测试
- [x] 打包安装验证
- [x] 重新发布 GitHub Release
- [x] 存储修正经验并汇报

## 用户反馈

- 当前实现不能做到和原版一样的上下文压缩。
- 压缩几乎瞬间结束，看不到正常压缩过程。
- 任务结束后不能继续任务。
- 需要查看原版完整系统实现，详细修复所有会出现问题的地方，并推演一遍。

## 初始判断

- 前两轮修复边界过窄，只处理了 provider error 表面传播，没有完整恢复原版压缩状态机。
- 需要同时检查 `summarizeConversation()`、`manageContext()`、`Task.attemptApiRequest()`、`Task.condenseContext()`、webview 压缩状态事件、完成后继续任务入口。
- 重点不是“隐藏错误”，而是恢复原版语义：真正进行摘要压缩、UI 显示压缩过程、压缩失败时按原版 fallback、完成任务后仍能继续。

## 对照结论

- 原版语义中，手动压缩直接走 `summarizeConversation()`，不应由 `manageContext()` 的自动 fallback 伪装成成功摘要。
- 自动压缩中，`manageContext()` 在摘要失败后可以返回 sliding-window truncation，但仍应保留 `error`，由上层记录真实失败原因；上一轮隐藏错误的做法已撤回。
- 压缩进度 UI 由 `condenseTaskContextStarted` 打开、`condenseTaskContextResponse` 关闭；如果摘要路径提前失败或被 fallback 吞掉，用户会看到“几乎瞬间结束”。因此应保留 provider/摘要错误，不把失败表现成正常摘要完成。
- 任务完成后继续任务不能用 `lastMessageTs` 判断是否有 live ask。`lastMessageTs` 可能仍指向历史 `completion_result` 行；这会把新输入误送入已经没人等待的 `handleWebviewAskResponse()`，导致继续任务丢失。

## 四条路径推演

- 自动压缩：`Task.attemptApiRequest()` 判断接近上下文上限后发送 `condenseTaskContextStarted`，调用 `manageContext()`；成功时写入摘要并发送 `condense_context`，失败 fallback 时写入 `sliding_window_truncation` 且保留 `error`，最后发送 `condenseTaskContextResponse` 关闭 UI。
- 手动压缩：webview 发 `condenseTaskContextRequest`，`ClineProvider.condenseTaskContext()` 调 `Task.condenseContext()`，`Task.condenseContext()` 直接调用 `summarizeConversation()`；成功写摘要，失败发送 `condense_context_error`，不覆盖历史。
- 压缩失败 fallback：摘要 provider 报错或超时后，自动路径允许 truncation 兜底继续任务，但不隐藏错误；手动路径不 fallback 成截断，避免用户以为已经完成原版摘要压缩。
- 完成后继续：活跃 `completion_result` ask 仍按原 ask 响应回到工具；历史完成行不再算 pending ask。后续用户输入优先走 `continueTaskFromUserMessage()`，恢复完成后继续任务。

## 修复记录

- `Task` 增加显式 live ask 状态 `pendingWebviewAskTs`，只在真正进入 blocking ask 时设置，并在 ask 返回、被 supersede 或清理 stale response 时清除。
- `getPendingWebviewAskTs()` 改为读取 `pendingWebviewAskTs`，避免把历史 `completion_result` 或 `command_output` 行误判为当前等待输入。
- `webviewMessageHandler` 中 `completion_result` 继续任务分支优先于普通 pending ask 消费，防止完成后新输入被历史完成行吞掉。
- `manageContext()` 恢复原版失败 fallback 语义：truncation 可以继续，但 `error` 仍返回给上层。
- 终端操作测试桩补充 live ask 状态，保证只在当前 `command_output` ask 下转发 continue feedback。

## 验证记录

- 聚焦测试通过：`cd src && pnpm test core/task/__tests__/Task.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts core/context-management/__tests__/context-management.spec.ts core/condense/__tests__/index.spec.ts core/condense/__tests__/condense.spec.ts core/task/__tests__/Task.terminal-operation.spec.ts`，6 个测试文件通过，164 个用例通过，7 个跳过。
- 打包通过：`bash scripts_package_deeptask_vsix.sh` 生成并验证 `deeptask-5.5.0.vsix`，大小 42,398,460 bytes。
- 安装通过：`codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force`。
- VSCodium 扩展列表确认：`deeptask.deeptask@5.5.0`。
- GitHub Release 已重新发布：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- Release 资产：`deeptask-5.5.0.vsix`，大小 42,398,460 bytes，下载地址 `https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`。
- 经验已存储到 Obsidian：`宇宙/记忆/项目记忆/2026-07-06-Deeptask原版压缩与完成续写修复.md`。

