# Deeptask 中途新任务 / 命令完成后交互卡死彻底修复

## Checklist

- [x] 查询 universe-memory 与既有完成/续跑修复
- [x] 定位中途发送不听、完成后复读、命令完成卡死根因
- [x] 修复 live HTTP stream 中断续跑
- [x] 修复 isTaskLoopActive 误把命令/tool 等待当成应 cancel 的 stream
- [x] 回归测试
- [x] 打包 VSIX、安装 VSCodium、发布 GitHub release
- [x] 存储项目/错误记忆

## 用户问题

1. 模型不添加中途发送的新任务，完全无法交互、不听人话。
2. 任务结束后继续对话，模型不会看新内容，而是重复自己做过的工作。
3. 命令运行完卡住不自动继续，连发消息在队列卡死。
4. 打包安装到 VSCodium 并发布 release。

## 根因

### A. streaming 中途发送只 park 不 cancel
`isStreaming || cancelled` 时只 `setPendingCancelledTaskContinuation`，不 `cancelTask()`，pending 永不被 rehydrate 消费。

### B. soft completion 后 `hasCompletedTask` 抢占路由
历史里一旦出现 `completion_result`，后续消息优先 `continueTaskFromUserMessage`，绕过 pending tool/command ask。

### C. `isTaskLoopActive` 范围过宽（本轮关键）
命令/tool 等待期间 `isTaskLoopActive=true`。若用它触发 cancel+park，会：
- 打断 command_output 自动继续
- 把用户消息停在 pending 队列
- 表现为“命令跑完卡住、连发消息队列死”

## 修复

1. 仅在 **live HTTP streaming** 时 park + `cancelTask()`。
2. 命令/tool 等待：优先 answer pending ask / terminal feedback。
3. `continueTaskFromUserMessage` 仅在 `isStreaming && isActivelyRunningTaskLoop` 时 cancel，不因 loop flag 单独 cancel。
4. soft completion 续跑仅在非 streaming 且（无 pending ask 或 pending 是 completion）时生效。
5. `findMessageByTimestamp` 改为 public，供路由判断 pending ask 类型。

## Verification

- `webviewMessageHandler.spec.ts` + `Task.spec.ts`: 113 passed / 4 skipped
- `executeCommandTool.spec.ts`: 15 passed
- commits: `20a91c6c`, `e263f740`
- VSIX: `deeptask-5.5.0.vsix` size `42407888`
- VSCodium: `deeptask.deeptask@5.5.0`
- GitHub:
  - https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0
  - https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix

## Memory

- `/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-11-Deeptask中途发送与命令完成交互卡死修复.md`
- `/home/kurz/Obsidian/宇宙/记忆/错误记忆/2026-07-11-Deeptask-isTaskLoopActive误当stream中断.md`
