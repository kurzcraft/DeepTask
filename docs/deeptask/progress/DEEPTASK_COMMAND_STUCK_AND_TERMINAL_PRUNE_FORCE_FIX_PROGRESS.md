# 命令卡死 + 终端超限强制裁剪 + webview 真打包修复

## Checklist

- [x] 查询记忆与既有修复
- [x] 定位：已安装 VSIX 的 webview 仍是旧清按钮逻辑
- [x] 定位：notifyTerminalProcessCompleted 在 hasCompletedCommand=false 时跳过 prune
- [x] 修复 TerminalRegistry 每次命令完成强制 mark+prune
- [x] 修复打包脚本强制重建 webview 并校验旧清按钮 marker
- [x] 回归测试
- [x] 打包安装 VSCodium
- [x] 写记忆

## 用户反馈

1. 长命令依旧卡死；就算不自动执行，也要有手动 Continue。
2. 任务结束后发消息不扩展任务列表。
3. 命令完成后终端数超过最大值，不是每次命令完成都检查清理。

## 根因

### A. Continue 按钮在安装包里仍被清掉

- 源码 `ChatView.tsx` 已有 recovery Continue + `activeCommandCount` 修复。
- 但 `scripts_package_deeptask_vsix.sh` 只跑 `pnpm bundle`，不强制重建 webview。
- 旧安装包 `webview-ui/build/assets/index.js` 仍是：
  - answered command / shell start → 清按钮
  - shell exit / command_output answered → 清按钮
- 结果：用户看到“什么都没有”。

### B. 终端 prune 被跳过

- `notifyTerminalProcessCompleted()` 原先先检查 `isCompletedVscodeTerminal()`。
- 该检查要求 `hasCompletedCommand && !busy && !running`。
- heredoc / stream-close 竞态下 continue 先于 shell end 到达时，`hasCompletedCommand=false`，函数直接 return，本轮不 prune。
- shell end early-return（`!running` / `!process`）路径也只清 busy，不 prune。

## 修复

### TerminalRegistry

- `notifyTerminalProcessCompleted`：对 vscode 集成终端强制 `busy=false`、`running=false`、`markTerminalCompleted`、`pruneCompletedVscodeTerminals`。
- shell end 的 early-return 路径同样 mark+prune。

### 打包脚本

- 强制 `turbo run build --force --filter=@roo-code/vscode-webview`。
- Python 校验 webview 含 `proceedWhileRunning` 且无旧 clear-button marker。
- VSIX 校验 extension 含 `notifyTerminalProcessCompleted`。

## 验证

```
TerminalRegistry: 18 passed
webview assets: proceedWhileRunning=7, old clear=false
VSIX: deeptask-5.5.0.vsix (42409529)
install: deeptask.deeptask@5.5.0
installed notify snippet:
notifyTerminalProcessCompleted(e){!(e instanceof dl)||e.provider!=="vscode"||e.isClosed()||(e.busy=!1,e.running=!1,this.markTerminalCompleted(e),this.pruneCompletedVscodeTerminals())}
```

## 文件

- [`src/integrations/terminal/TerminalRegistry.ts`](src/integrations/terminal/TerminalRegistry.ts)
- [`src/integrations/terminal/__tests__/TerminalRegistry.spec.ts`](src/integrations/terminal/__tests__/TerminalRegistry.spec.ts)
- [`scripts_package_deeptask_vsix.sh`](scripts_package_deeptask_vsix.sh)
- 既有前端/任务修复：[`webview-ui/src/components/chat/ChatView.tsx`](webview-ui/src/components/chat/ChatView.tsx)、[`src/core/webview/webviewMessageHandler.ts`](src/core/webview/webviewMessageHandler.ts)、[`src/core/task/Task.ts`](src/core/task/Task.ts)
