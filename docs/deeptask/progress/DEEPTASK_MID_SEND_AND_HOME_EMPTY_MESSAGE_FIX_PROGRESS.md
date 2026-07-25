# Deeptask 中途发送只收到继续 + 主页消息变空修复

## Checklist

- [x] 查询 universe-memory 与相关历史修复
- [x] 定位中途发送只被当作 continue / 模型收不到新消息的根因
- [x] 定位主页发送无响应、消息变空的根因
- [x] 实现修复并补回归测试
- [x] 验证 focused tests
- [x] 打包 VSIX、安装 VSCodium、发布 GitHub release
- [x] 存储项目/错误记忆

## 用户问题

1. 中途发送消息模型接收不到，只能收到“继续”
2. 有时候在主页发送消息没有任何响应，消息变空
3. 打包安装到 VSCodium，发布 release

## Root Cause

### A. 主页消息变空

1. [`ChatView.tsx`](webview-ui/src/components/chat/ChatView.tsx) 发送时优先判断 `activeCommandExecutionIdsRef.size > 0`。
2. 上一任务 shell 若未收到 exited，或回首页后未清理 active command set，则首页 `messages.length === 0` 仍走 `terminalOperation continue`。
3. `handleChatReset()` 清空输入框，后端又无 live terminal → 表现为“消息变空、无响应”。

### B. 中途发送只收到继续

1. 命令输出 250ms 自动 `yesButtonClicked` 后，`command_output` ask 已结算。
2. 用户再发文字时前端仍可能走 `terminalOperation continue`。
3. [`Task.handleTerminalOperation`](src/core/task/Task.ts) 仅在 **pending command_output ask 仍在** 时设置 `pendingCommandOutputFeedback`。
4. ask 已结算 → 只 `say user_feedback` + `process.continue()`，[`ExecuteCommandTool`](src/core/tools/ExecuteCommandTool.ts) 最终 tool result **不带用户反馈** → 模型只看到“命令已执行/继续”，收不到真实指令。

## Fix

1. 首页 / 任务切换时清空 `activeCommandExecutionIds`。
2. 发送路径：`messages.length === 0` 永远 `newTask`，绝不 terminal。
3. 强制继续后若已有更新的 `api_req_started`，中途文本走 askResponse 中断，不走 terminal。
4. `handleTerminalOperation`：有文本时始终写入 `pendingCommandOutputFeedback`。
5. 回归测试 + 打包安装 + 覆盖发布 v5.5.0。

## Verification

- `webview-ui` ChatView.spec: 17 passed / 12 skipped
- `src` Task.terminal-operation + webviewMessageHandler: 51 passed
- commits:
  - `42c5c90d` fix: 修复中途发送只当继续与主页消息变空
  - `edea1b2b` docs: 更新 v5.5.0 release notes
- VSIX: `deeptask-5.5.0.vsix` size `42410924`
  - sha256 `53e8e211f63f78e1e193dc2d541e1fb7fb0e2d35cfcd65118d9c1a5afd2d44b1`
- VSCodium: `deeptask.deeptask@5.5.0`
- GitHub release:
  - https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0
  - https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix
  - remote asset size matches local (`42410924`)

## Files

- [`webview-ui/src/components/chat/ChatView.tsx`](webview-ui/src/components/chat/ChatView.tsx)
- [`webview-ui/src/components/chat/__tests__/ChatView.spec.tsx`](webview-ui/src/components/chat/__tests__/ChatView.spec.tsx)
- [`src/core/task/Task.ts`](src/core/task/Task.ts)
- [`src/core/task/__tests__/Task.terminal-operation.spec.ts`](src/core/task/__tests__/Task.terminal-operation.spec.ts)
- [`.changeset/fix-mid-send-and-home-empty-message.md`](.changeset/fix-mid-send-and-home-empty-message.md)
- [`DEEPTASK_RELEASE_5.5.0_NOTES.md`](DEEPTASK_RELEASE_5.5.0_NOTES.md)

## Entropy

任务前：中途文本可能只唤醒终端、不进模型；首页残留 shell ID 会把首条消息清空成 no-op。  
任务后：首页强制 newTask 并清理 shell 追踪；terminal feedback 始终进 tool result；强制继续后的新 API 轮次优先 askResponse/Cancel。净熵下降。
