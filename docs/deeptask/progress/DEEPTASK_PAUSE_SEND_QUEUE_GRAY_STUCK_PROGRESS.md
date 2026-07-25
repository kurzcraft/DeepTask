# DeepTask 暂停推理后发送消息队列灰态卡死修复

## 检查清单

- [x] 建立问题进度文件并恢复相关背景
- [x] 定位暂停/取消推理入口与 UI 灰态条件
- [x] 定位发送消息队列与 backend 处理路径
- [x] 复盘历史强制中断/继续循环修复是否引入状态不一致
- [x] 修复暂停后发送消息进入队列但不恢复的问题
- [x] 补充回归测试
- [x] 运行 focused tests、lint、type
- [x] 打包安装到 VSCodium 并存储经验

## 用户报告

现在出现了更严重的问题：暂停模型推理后发送消息出现消息队列，卡死变灰。

## 初始假设

- 已知：问题发生在“暂停模型推理”之后，再发送新消息时出现 queued message 且 UI 变灰卡死。
- 假说 A：abort/cancel 后后台 `ClineProvider` 或 `Task` 仍保留 busy/active task 状态，导致新消息只入队不执行。
- 假说 B：webview UI 根据 `isStreaming`、`isDisabled`、`isQueueing` 或 `task` 状态进入灰态，但取消路径没有收到最终 state update。
- 假说 C：已有强制中断、取消后继续、消息队列直发等修复之间存在竞态，暂停后 queued message 没有被 drain。

## 定位结果

- UI 侧 `webview-ui/src/components/chat/ChatView.tsx` 在 busy/streaming 状态发送用户输入时，会走 `askResponse: "messageResponse"`，避免 legacy visible queue。
- 后端 `src/core/webview/webviewMessageHandler.ts` 的 `askResponse` 分支原先先判断 `hasPendingAsk && isAskResponseForCurrentAsk`，再判断 `isCancelledStreamingContinuation`。
- `ClineProvider.cancelTask()` 会设置 `task.abortReason = "user_cancelled"` 并启动 rehydrate。这个窗口内旧 task 可能仍保留 stale pending ask。
- 因此用户在“暂停模型推理”后立刻发送新消息时，新消息可能被旧 pending ask 消费，而不是被保存到 `pendingCancelledTaskContinuation` 给 rehydrated task 继续执行，表现为消息队列/灰态/卡死。

## 修复

- 调整 `src/core/webview/webviewMessageHandler.ts` 的分支顺序：
  - `completion_result` continuation 仍优先作为完成后续写处理。
  - cancelled/abandoned/streaming continuation 现在优先于 pending ask 消费。
  - 取消中的新消息会清理 stale ask 和 legacy queue，并写入 `provider.setPendingCancelledTaskContinuation()`。
  - rehydrated task 会在 `createTaskWithHistoryItem()` 后消费该 continuation。
- 新增回归测试 `does not feed cancelled-task continuations into a stale pending ask`，覆盖取消中仍有 pending ask 且 askTs 匹配时，新消息也不能进入旧 `handleWebviewAskResponse()`。
- 新增 changeset：`.changeset/fix-paused-send-queue-stuck.md`。

## 验证记录

- `cd src && pnpm test core/webview/__tests__/webviewMessageHandler.spec.ts`
  - 结果：1 个测试文件通过，31 passed。
- `pnpm lint`
  - 结果：通过。
- `pnpm check-types`
  - 结果：通过。

## 待完成

- 运行 `bash scripts_package_deeptask_vsix.sh`。
- 安装 `deeptask-5.5.0.vsix` 到 VSCodium 并确认版本。
- 写入 universe memory。

## 2026-07-20 复发审计：命令后取消推理再发送

### 精确操作序列

1. 运行命令并等待命令结束。
2. Deeptask 已开始命令后的下一轮模型推理。
3. 点击取消按钮暂停该轮模型推理。
4. 在取消结算窗口内继续发送一条用户消息。
5. 消息显示为进入队列，但没有被后端任务循环消费，随后发送链路卡死。

### 本轮验收条件

- [x] 查询相关 universe-memory 与历史进度，恢复旧修复边界。
- [-] 审计取消、发送路由、队列准入和任务循环结算的完整状态转换。
- [ ] 构造“命令后下一轮推理 → 取消 → 立即发送”的自动化回归。
- [ ] 确认用户消息只进入模型历史一次，且不会滞留在无消费者队列。
- [ ] 确保旧 provider 流结算后，恰好一个 task loop 获得 continuation 所有权。
- [ ] 保持 live ask、terminal feedback、edited resend 和完成态续写语义不回归。
- [ ] 运行聚焦测试、类型检查和差异检查。
- [ ] 打包、强制安装、真实运行时验收并覆盖 GitHub Release `v5.5.0`。
- [ ] 提交推送，完成进度记录并存储 universe-memory 原理。

### 当前判断

- 已知：历史修复调整了 cancelled continuation 与 stale pending ask 的分支优先级。
- 不确定：本次消息是否在 UI 层再次进入 legacy queue，或已到后端但因取消重建窗口没有消费者。
- 待证伪假说 A：取消后 UI 仍以 busy 状态发送，但使用了只适用于 live ask 的 queued 路由。
- 待证伪假说 B：`pendingCancelledTaskContinuation` 在旧 task 结算与新 task rehydrate 之间被提前清除或错过消费。
- 待证伪假说 C：命令后下一轮 API 请求改变了 pending ask / generation 状态，使旧回归未覆盖该窗口。
