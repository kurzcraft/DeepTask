# Deeptask 长命令运行/继续按钮卡死修复进度

## 检查清单

- [x] 查询 universe-memory 与既有运行按钮卡死进度
- [x] 定位长命令运行按钮/继续点击卡死的完整状态链路
- [x] 实施最小修复并补回归测试
- [x] 聚焦测试、打包并安装到 VSCodium
- [x] 与软完成 keep-active 一并提交并更新 GitHub release
- [x] 存储经验并汇报

## 用户反馈

- 运行长命令时卡在“运行”按钮。
- 点击按钮后按钮消失，但任务卡死。
- 点击继续应该继续。
- 打包安装到 VSCodium。

## 根因

1. 已批准的 `ask: "command"` 在长命令输出到来前仍是 `lastMessage`。
2. `ChatView` 的 lastMessage effect 重新点亮“运行”。
3. 二次点击发送 stale `yesButtonClicked`。
4. 后端无 pending ask 时只清状态，不唤醒 terminal / 不续跑任务。
5. command/command_output 未持久化 `isAnswered`，前端无法识别已回答 ask。

## 已实施

- [`webview-ui/src/components/chat/ChatView.tsx`](webview-ui/src/components/chat/ChatView.tsx:448)
  - 已回答 command / 活跃 shell 期间不再显示 Run。
  - shell start/exit 时清理 stale Run/Continue。
  - 活跃 shell 下误点 Run 转 `terminalOperation: continue`。
- [`src/core/task/Task.ts`](src/core/task/Task.ts:1695)
  - command/command_output 响应时写 `isAnswered`。
- [`src/core/webview/webviewMessageHandler.ts`](src/core/webview/webviewMessageHandler.ts:651)
  - stale yes/no + live terminal → `handleTerminalOperation`。
  - stale empty button click → `continueTaskFromUserMessage("")`。
- 回归测试：
  - `webviewMessageHandler.spec.ts`
  - `ChatView.spec.tsx`
- changeset：`.changeset/fix-long-command-run-button-stuck.md`

## 验证

- `cd src && pnpm exec vitest run core/webview/__tests__/webviewMessageHandler.spec.ts core/task/__tests__/Task.terminal-operation.spec.ts core/task/__tests__/Task.spec.ts core/tools/__tests__/attemptCompletionTool.spec.ts`：126 passed，4 skipped。
- `cd webview-ui && pnpm exec vitest run src/components/chat/__tests__/ChatView.spec.tsx`：9 passed，12 skipped。
- `bash scripts_package_deeptask_vsix.sh`：`deeptask-5.5.0.vsix` 大小 `42407297`。
- `codium --install-extension deeptask-5.5.0.vsix --force`：成功，`deeptask.deeptask@5.5.0`。
- 安装目录 `/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0` 验证包含新 marker：
  - `Failed to save answered command ask state`
  - `continueTaskFromUserMessage("")`
- Git commit `4d643c50` 已推送 `origin/main`。
- GitHub release：https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0

## 记忆

- 已写入：`/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-11-Deeptask长命令运行继续按钮卡死修复.md`
- 软完成 keep-active：`/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-11-Deeptask软完成保持绿色并可续跑.md`

## 熵变化

任务前：长命令 Run/Continue 卡死路径不确定。  
任务后：根因、前后端最小修复、测试、VSCodium 安装与 release 均完成。净熵下降。
