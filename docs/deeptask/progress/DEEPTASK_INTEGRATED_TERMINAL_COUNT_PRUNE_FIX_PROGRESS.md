# 集成终端超限裁剪 + 命令完成后卡死修复

## Checklist

- [x] 定位命令执行完卡住 + 发消息卡死的交互路径
- [x] 修复命令完成后的 continue/queue/ask 解锁
- [x] 修复集成终端超限：只保留最新 N 个，裁掉其余
- [x] 补回归测试并验证
- [x] 打包安装 VSCodium 并发布 GitHub release
- [x] 存储项目/错误记忆

## 用户要求

1. 集成任务终端数量超过限定值时，裁剪除最新 N 个外的所有终端
2. 命令执行完卡住，发消息也卡死

## 根因

### 命令完成后发消息卡死

1. 命令结束后后端会发非交互 `say: "command_output"` 结果行
2. 前端 `ChatView.handleSendMessage` 把 `latestMessage.say === "command_output"` 也当成 live wait
3. 于是把用户新消息发成 `terminalOperation: continue`
4. 后端若无 live `terminalProcess`，`handleTerminalOperation` 成为 no-op，任务看起来卡死

### 集成终端超限

- `TerminalRegistry.pruneCompletedVscodeTerminals()` 已存在，默认 limit=3
- 仅依赖 `vscode.window.terminals` 时，测试/竞态下可能漏裁
- 品牌替换可能把 legacy 标题 `"Kilo Code"` 改坏，导致旧终端不被识别

## 修复

### 前端 ChatView

- 只把 live shell 或 pending `ask:command_output` 当 wait
- **不要**把 finished `say:command_output` 当 wait

关键：`webview-ui/src/components/chat/ChatView.tsx`

### 后端 webviewMessageHandler

- `terminalOperation` 有 live process → 正常 continue/abort
- 无 live process 但带文本 → 转 `continueTaskFromUserMessage`
- 否则清 stale ask 并刷新 state

关键：`src/core/webview/webviewMessageHandler.ts`

### 终端裁剪

- prune 候选：`window.terminals` + registry fallback
- legacy 终端名改为 `["Kilo", " Code"].join("")`，避免品牌重写误伤

关键：
- `src/integrations/terminal/TerminalRegistry.ts`
- `src/integrations/terminal/Terminal.ts`

## 验证

```
TerminalRegistry: 16 passed
webviewMessageHandler: 45 passed
ChatView: 10 passed | 12 skipped
ALL PASSED
```

## Next

打包安装 VSCodium，发布 GitHub release，写入记忆。


## Release

- commit: `e0fb1619`
- vsix: `deeptask-5.5.0.vsix` (42408240 bytes)
- install: `deeptask.deeptask@5.5.0`
- release: https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0
- asset: https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix
