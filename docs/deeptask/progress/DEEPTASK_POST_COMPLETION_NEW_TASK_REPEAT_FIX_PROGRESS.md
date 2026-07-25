# Deeptask 任务结束后新消息被忽略/重复交付修复

## Checklist

- [x] 查询 universe-memory 与既有 soft completion / 中途发送修复
- [x] 审计 post-completion 用户消息路由与 API 历史投递
- [x] 定位“重复交付最终结果与发布链接”根因
- [x] 修复：soft completion 后立即剥离 attempt_completion API 尾巴
- [x] 补回归测试并验证
- [x] 打包安装 VSCodium 并发布 GitHub release
- [x] 存储项目/错误记忆

## 用户问题

1. 任务结束后发送新内容，模型重复交付最终结果与发布链接
2. 不是添加用户告诉它的新任务条目并修改任务完成条件
3. 怀疑消息没成功发给模型
4. 打包安装到 VSCodium，发布 release

## Root Cause

Soft completion 路径：

1. DeepTask `attempt_completion` 渲染绿色 `completion_result`（UI 正确）
2. `markActiveResponseCompletionHandled()` 结束当前 loop（状态正确）
3. **但** `recursivelyMakeClineRequests` 在 tool 执行后仍把带 `attempt_completion` 的 assistant 消息写入 `apiConversationHistory`
4. soft completion 不 push tool_result，只 `return true` 清 `userMessageContent`
5. 下一轮用户消息虽走 `continueTaskFromUserMessage`，若 strip 时机/内容不充分，模型上下文仍被“上一轮最终结果 + 发布链接”主导，表现为重复交付

## Fix

在 soft completion 结束当前 loop 时立刻：

1. 清空 `userMessageContent`（阻止 synthetic tool_result 再进模型）
2. `stripCompletedAttemptCompletionFromHistory()` 去掉 `attempt_completion` 尾巴
3. 持久化 API history

文件：[`src/core/task/Task.ts`](src/core/task/Task.ts)

## Tests

- 扩展：soft completion 后 API history 不含 attempt_completion
- 扩展：后续用户消息 continuation 含新指令，不含旧 release 链接

## Next

- 跑 focused tests
- package / install / release
- 写记忆


## Release

- commit: `278fb319`
- vsix: `deeptask-5.5.0.vsix` (42407896 bytes)
- install: `deeptask.deeptask@5.5.0`
- release: https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0
- asset: https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix
