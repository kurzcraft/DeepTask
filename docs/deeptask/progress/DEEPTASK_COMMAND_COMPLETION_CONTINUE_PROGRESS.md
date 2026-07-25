# Deeptask 命令完成后继续推理修复进度

- [x] 查询 universe-memory 相关记忆
- [x] 创建任务进度清单
- [x] 定位 execute_command/terminal 完成后的继续推理路径
- [x] 修复命令运行结束后模型不继续推理的问题
- [x] 修复 `command_output` ask 在命令完成前阻塞 `onLine` 的二次卡死路径
- [x] 补充聚焦测试覆盖命令输出 ask 自动继续
- [x] 运行测试验证
- [x] 重新打包并安装到 VSCodium
- [ ] 存储本次经验到宇宙记忆
- [ ] 检查 git 工作树并只暂存本次相关文件
- [ ] 提交修复并推送 GitHub
- [ ] 发布 GitHub VSIX release

## 用户反馈

- 一些命令运行结束后模型不继续推理。
- 复现命令包含较长 shell 诊断脚本，运行完应自动把结果交还模型继续分析。

## 初始假设

- 命令完成后需要向当前 pending `command_output` ask 提交 `messageResponse` 或等价的 terminal continue 操作。
- 之前为避免队列卡死做过队列和 stale ask 清理，可能导致命令完成输出反馈未被消费或被过早清掉。
- 需要检查 `execute_command` 工具、terminal process 完成事件、webview `command_output` 的 `askResponse`/`terminalOperation` 处理链路。

## 定位结果

- `command_output` 在 `packages/types/src/message.ts` 中是 non-blocking ask，只用于更新命令输出，不应在命令结束后成为长期等待点。
- `src/core/tools/ExecuteCommandTool.ts` 原逻辑只在 `hasAskedForCommandOutput && !commandOutputAskSettled` 时自动 `handleWebviewAskResponse("yesButtonClicked")`。
- 若 `task.ask("command_output", "")` 已本地 settled/superseded，但 UI/Task 仍存在 pending `command_output` ask，命令完成后不会再清理该 pending ask，容易导致模型不继续推理。
- 第一次修复为：命令结束后只要曾发出 `command_output` 且没有用户消息反馈，就等待短时间并检查真实 `task.hasPendingWebviewAskResponse()`；若仍 pending，则自动 `yesButtonClicked` 并显式 `process.continue()`，确保终端 Promise 释放、工具结果返回模型。
- 用户复测长 OBS 诊断命令仍会卡住，说明第一次修复发生得太晚：`onLine` 内部已经在等待 `task.ask("command_output", "")`，后续命令完成清理路径可能永远到不了。
- 第二次修复为：`onLine` 不再无限等待 `command_output` ask，而是通过 `waitForCommandOutputResponse()` 在 ask 与 250ms 自动继续之间竞速；超时后自动 `yesButtonClicked` 并 `process.continue()`，使 advisory ask 真正非阻塞。

## 验证记录

- `cd src && pnpm exec vitest run core/tools/__tests__/executeCommandTool.spec.ts` 通过：1 个测试文件、14 个测试通过。
- `cd src && pnpm exec vitest run core/webview/__tests__/webviewMessageHandler.spec.ts core/kilocode/agent-manager/__tests__/AgentManagerProvider.ipc.spec.ts core/kilocode/agent-manager/__tests__/message-handling.spec.ts core/tools/__tests__/executeCommandTool.spec.ts` 通过：4 个测试文件、43 个测试通过。
- `cd webview-ui && pnpm exec vitest run src/components/chat/__tests__/ChatView.spec.tsx src/components/chat/__tests__/ChatView.notification-sound.spec.tsx src/kilocode/agent-manager/components/__tests__/MessageList.spec.tsx` 通过：3 个测试文件、31 个测试通过、12 个跳过。
- `cd packages/agent-runtime && pnpm test src/__tests__/force-send.test.ts` 通过：1 个测试文件、3 个测试通过。
- `bash scripts_package_deeptask_vsix.sh` 通过，产物 `deeptask-5.5.0.vsix` 与 `bin/deeptask-5.5.0.vsix`，校验输出 `VSIX verified: deeptask-5.5.0.vsix 42399892`。
- `codium --install-extension deeptask-5.5.0.vsix --force && codium --list-extensions --show-versions | rg '^deeptask\\.deeptask@|deeptask'` 通过，确认 `deeptask.deeptask@5.5.0`。
