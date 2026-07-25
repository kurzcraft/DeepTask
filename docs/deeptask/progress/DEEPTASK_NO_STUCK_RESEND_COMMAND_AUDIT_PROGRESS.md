# DeepTask 防卡死复查：重发、取消续写、命令等待

## 目标

全面复查用户消息入口与命令执行等待状态，避免以下场景卡死或灰态停滞：

- 暂停/取消模型推理后立刻发送新消息
- 重发、继续任务、完成后追加消息
- 执行命令等待输出或终端事件丢失时
- 旧版/残留 `queueMessage` 消息进入后端

## 当前发现

- 前端主发送路径已经不再主动使用 legacy `queueMessage`：
  - 命令输出等待态发送走 `terminalOperation: "continue"`
  - 流式/忙碌态发送走 `askResponse: "messageResponse"`
  - 普通继续任务同样走 `askResponse`
- 后端 `askResponse` 分支已有优先级保护：完成续写、取消续写、当前 pending ask。
- 仍存在一个残留风险：legacy `queueMessage` 分支先检查 pending ask，可能把取消后的续写消息或命令等待反馈吞进旧 ask，导致灰态或终端等待无法唤醒。
- 命令工具已有防卡死兜底：`command_output` ask 自动继续、shell exit fallback 唤醒 process、命令结束后清理 pending ask。

## 已实施修复

- 修改 `src/core/webview/webviewMessageHandler.ts` legacy `queueMessage` 分支：
  - `queueMessage` 只作为即时反馈兼容入口，不再保留到 `MessageQueueService`。
  - 分支优先级改为：取消/流式/abandoned 续写 -> 终端等待唤醒 -> 当前 pending ask -> 非交互反馈。
  - 在取消续写和终端等待路径中主动清理 stale ask 与 legacy queue。
- 修正 `src/core/tools/ExecuteCommandTool.ts` 中 `waitForCommandOutputResponse()` 的缩进格式，保持命令输出自动继续逻辑清晰。
- 新增回归测试：
  - legacy `queueMessage` 在取消态不会被 stale pending ask 吞掉，会写入 pending cancelled continuation。
  - legacy `queueMessage` 在终端等待态优先走 `handleTerminalOperation("continue")`，不会被 stale pending ask 吞掉。
  - 前端 `command_output` 等待态按 Enter 直接发送 `terminalOperation`，不走 `queueMessage` 或 `askResponse`。
- 新增 changeset：`.changeset/fix-legacy-queue-stuck-priority.md`。

## 验证状态

- 已通过：`pnpm --dir src test core/webview/__tests__/webviewMessageHandler.spec.ts core/tools/__tests__/executeCommandTool.spec.ts`
  - 2 个测试文件通过
  - 48 个测试通过
- 已通过：`pnpm --dir webview-ui exec vitest run src/components/chat/__tests__/ChatView.spec.tsx`
  - 1 个测试文件通过
  - 8 个测试通过，12 个既有 skipped 用例保持跳过
- 已通过：`pnpm lint`
  - 18 个 lint task 通过
  - 仅有既有 TypeScript 版本兼容警告，无 lint failure
- 已通过：`pnpm check-types`
  - 22 个 typecheck task 通过
- 已通过：`bash scripts_package_deeptask_vsix.sh`
  - 产出并校验 `deeptask-5.5.0.vsix`
- 已通过：`codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force`
  - 安装确认：`deeptask.deeptask@5.5.0`

## 决策

- 不恢复旧的可见消息队列。所有用户发送入口都应即时路由到明确的状态机分支。
- 任何可能唤醒取消续写或终端等待的消息，优先级必须高于 pending ask，因为 pending ask 可能来自旧任务或旧 UI 状态。
- legacy `queueMessage` 只能保留兼容能力，不能拥有排队语义。

## 阻塞

- 无。
