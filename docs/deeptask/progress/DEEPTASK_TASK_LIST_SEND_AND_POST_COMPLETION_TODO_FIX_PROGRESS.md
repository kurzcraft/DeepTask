# Deeptask 任务列表发送被吞 + 完成后必须添加任务修复

## Checklist

- [x] 查询 universe-memory 与相关历史修复
- [x] 定位任务列表主界面发送消息被吞、不开新任务的根因
- [x] 定位任务结束后发消息未添加任务/未改未完成的根因
- [x] 实现修复并补回归测试
- [x] 验证 focused tests
- [x] 更新进度文件与记忆

## 用户问题

1. 任务列表主界面发送消息被吞，不开启动新任务
2. 任务结束后每次发消息必须添加任务，任务状态必须改为未完成

## Root Cause

### A. 主界面/历史列表发送被吞

1. [`ChatView.tsx`](webview-ui/src/components/chat/ChatView.tsx) 在 `sendingDisabled || isStreaming` 时统一走 `askResponse`，**不判断是否已有对话**。
2. 首页 `messages.length === 0` 时若残留 sticky `sendingDisabled`（例如上一轮 `handleChatReset` / `newChat`），首条消息被发成 `askResponse`。
3. 后端 [`webviewMessageHandler.ts`](src/core/webview/webviewMessageHandler.ts) 在 `getCurrentTask()` 为空时只清队列，**不 createTask** → 消息被吞。

### B. 普通 text 被误当成 command_output

上一轮 Continue 修复把 `text/api_req_finished/error/...` 与 `command_output` 写在同一 case 组，导致 soft completion 后的普通 text 也设置：

- `clineAsk = "command_output"`
- Continue 按钮

进而污染发送路由与后续交互。

### C. 任务结束后必须添加未完成任务

续跑路径已有：

- `continueTaskFromUserMessage` → 清空旧 todo、`requiresProgressListExpansion=true`、status→active
- `normalizeTodoListForActiveContinuation` 把全 completed 列表最后一项改为 `in_progress`
- 工具门闩拒绝 `update_todo_list` 之外的首动作

本轮补齐前端误路由，避免续跑/新建任务根本进不了这些路径。

## Fix

1. **ChatView**：仅 `say:command_output` 保留 Continue；`text/error/api_req_finished/...` 恢复为可输入、无伪 command ask。
2. **ChatView**：busy 路径仅在 `messagesRef.current.length > 0` 时使用 `askResponse`；首页空消息始终 `newTask`。
3. **webviewMessageHandler**：无 current task 且 `messageResponse` 有内容时 `createTask`。
4. 回归测试：首页 newTask、soft completion 后 text 不伪 command、无 task 时 askResponse 创建任务。

## Files

- [`webview-ui/src/components/chat/ChatView.tsx`](webview-ui/src/components/chat/ChatView.tsx)
- [`src/core/webview/webviewMessageHandler.ts`](src/core/webview/webviewMessageHandler.ts)
- [`webview-ui/src/components/chat/__tests__/ChatView.spec.tsx`](webview-ui/src/components/chat/__tests__/ChatView.spec.tsx)
- [`src/core/webview/__tests__/webviewMessageHandler.spec.ts`](src/core/webview/__tests__/webviewMessageHandler.spec.ts)
- [`.changeset/fix-home-send-and-post-completion-todo.md`](.changeset/fix-home-send-and-post-completion-todo.md)

## Verification

- `webviewMessageHandler.spec.ts`: 47 passed
- `Task.spec.ts`: 71 passed / 4 skipped
- `ChatView.spec.tsx`: 14 passed / 12 skipped

## Memory

- `/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-11-Deeptask首页发送被吞与完成后未完成任务修复.md`
- `/home/kurz/Obsidian/宇宙/记忆/错误记忆/2026-07-11-Deeptask首页askResponse吞消息与text伪command_output.md`

## Entropy

任务前：首页首条消息可能被 askResponse 吞掉；soft completion 后 text 伪 command_output 污染发送；续跑路径进不去。  
任务后：首页强制 newTask，无 task 后端兜底 createTask，text 不再伪 command；续跑仍强制扩展未完成 todo。净熵下降。
