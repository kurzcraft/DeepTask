# DeepTask 命令运行按钮卡死修复进度

## 检查清单

- [x] 新建并维护运行按钮卡死专项进度
- [x] 定位命令完成后运行按钮仍显示的数据链路
- [x] 定位点击按钮后消失但任务卡死的状态链路
- [x] 设计最小修复并保留现有命令反馈改进
- [x] 实施修复
- [x] 补充回归测试
- [x] 运行聚焦测试
- [x] 打包安装并发布
- [-] 存储经验并汇报

## 用户反馈

- 运行命令完毕后仍保持“运行”按钮。
- 点击按钮后按钮消失，但任务卡死。
- 需要修复所有潜在问题。

## 启动记忆查询

- 已查询 universe-memory：`Deeptask 运行按钮 命令完成 卡死 execute_command run button`。
- 结果：未命中同类记忆。

## 用户指定诊断命令结果

命令：

```bash
git status --short --branch && printf '\n--- latest commits ---\n' && git log --oneline --decorate -5 && printf '\n--- tracked check ---\n' && git ls-files -- "宇宙/记忆/项目记忆/2026-07-06-Deeptask-provider上下文0与终端完成通知修复.md" "脚本集合/安全提交并推送VSCode-Deeptask修复-20260706.sh"
```

结果摘要：

- 当前分支：`main...origin/main`，与远端对齐。
- 工作树已有多项未提交改动。
- 最近提交：`f8c88e9f fix(deeptask): 彻底修复队列消息问题并优化用户反馈`。
- `git ls-files` 对两个检查路径无输出，说明这两个路径不在当前仓库跟踪范围内。

## 初始假设

- “运行按钮仍显示”可能来自 webview 工具状态没有收到或没有消费 `command`/`command_output` 完成状态。
- “点击按钮后消失但卡死”可能来自 pending ask/approval 状态被清掉，但后端队列没有继续 drain，或命令完成回调没有触发 `continueTaskFromUserMessage()`/`processMessageQueue()`。
- 需要同时检查：`ExecuteCommandTool`、`Task.terminal-operation`、webview message handler、前端命令执行块/工具按钮状态。

## 定位结论

- `Task.handleTerminalOperation()` 已经有 stale command_output 点击保护：只有当前 pending ask 仍是 `command_output` 时才喂给 ask 状态机；否则只唤醒/终止终端并清理过期响应。
- `ChatView` 的 `activeCommandExecutionIdsRef` 会把 `fallback` 状态加入 active 集合。
- `fallback` 表示当前命令状态流结束并切到回退执行路径，不应继续被视为 active；否则后续输入会被 `handleSendMessage()` 误判为 command output 等待，发送成命令反馈路径，表现为按钮消失但任务不继续。

## 已实施

- 修改 `webview-ui/src/components/chat/ChatView.tsx`：只有 `started` 和 `output` 加入 active command 集合；`fallback` 与 `exited`、`timeout` 一样清理 active 状态。
- 新增 `webview-ui/src/components/chat/__tests__/ChatView.spec.tsx` 回归：模拟 `started` 后收到 `fallback`，再发送文本必须走普通 `askResponse`，不能走 `terminalOperation`。

## 验证记录

- `cd webview-ui && pnpm test src/components/chat/__tests__/ChatView.spec.tsx --runInBand` 失败：项目 pretest 调用 `turbo run kilo-code#bundle --cwd ..`，当前 workspace 找不到 `kilo-code` package。
- `cd webview-ui && pnpm exec vitest run src/components/chat/__tests__/ChatView.spec.tsx` 通过：1 个文件，7 passed，12 skipped。
- `cd src && pnpm exec vitest run core/task/__tests__/Task.terminal-operation.spec.ts` 通过：1 个文件，3 passed；Vite 输出既有 dynamic-import-vars warning。
- `bash scripts_package_deeptask_vsix.sh` 通过，生成并验证 `deeptask-5.5.0.vsix`，大小 42,398,433 bytes。
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force` 安装成功。
- `codium --list-extensions --show-versions | rg '^deeptask\.deeptask@'` 确认 `deeptask.deeptask@5.5.0`。
- `node scripts_publish_github_release.mjs` 发布/更新 GitHub Release：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`，资产 `deeptask-5.5.0.vsix`，大小 42,398,433 bytes。
