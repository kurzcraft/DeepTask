# Deeptask 强制中断发送修复进度

- [x] 查询 universe-memory 相关记忆
- [x] 创建任务进度清单
- [x] 定位发送消息与队列机制代码
- [x] 修改发送逻辑为强制中断当前任务后继续对话
- [x] 根据暂停状态仍卡死反馈修正第一轮方案
- [x] 移除 Agent Manager 前端本地队列机制
- [x] 移除普通 ChatView 可见队列 UI 与队列阻塞条件
- [x] 补充或更新测试覆盖
- [x] 运行验证命令并记录结果
- [x] 根据重发仍卡死反馈修正内联重发路径
- [x] 按“需要前文上下文，不要后文”修正截断语义
- [x] 重新打包并安装到 VSCodium 验证
- [ ] 存储本次经验到宇宙记忆

## 验证记录

- `cd src && pnpm test core/kilocode/agent-manager/__tests__/AgentManagerProvider.ipc.spec.ts core/kilocode/agent-manager/__tests__/message-handling.spec.ts` 曾失败于 pretest bundle 阶段。
- 失败原因是既有 `packages/types/src/global-settings.ts` 存在重复 `taskProgressFileEnabled` key，tsup DTS 构建报 TS1117；未进入本次相关测试执行。
- `cd src && pnpm exec vitest run core/kilocode/agent-manager/__tests__/AgentManagerProvider.ipc.spec.ts core/kilocode/agent-manager/__tests__/message-handling.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts` 通过：3 个测试文件、29 个测试通过。
- `cd packages/agent-runtime && pnpm test src/__tests__/force-send.test.ts` 通过：1 个测试文件、3 个测试通过。
- `cd webview-ui && pnpm exec vitest run src/components/chat/__tests__/ChatView.spec.tsx src/components/chat/__tests__/ChatView.notification-sound.spec.tsx src/kilocode/agent-manager/components/__tests__/MessageList.spec.tsx` 通过：3 个测试文件、31 个测试通过、12 个跳过。
- Webview 测试仍提示 `webview-ui/src/context/ExtensionStateContext.tsx` 里 `taskProgressFileEnabled` 与 `setTaskProgressFileEnabled` 重复 key warning，非本次发送队列链路阻塞。
- 已新增 `.changeset/fix-deeptask-force-send.md`，按用户可见 bug fix 记录 patch changeset。
- 第三轮 `cd src && pnpm exec vitest run core/webview/__tests__/webviewMessageHandler.spec.ts core/kilocode/agent-manager/__tests__/AgentManagerProvider.ipc.spec.ts core/kilocode/agent-manager/__tests__/message-handling.spec.ts` 通过：3 个测试文件、29 个测试通过。
- 第三轮 `cd webview-ui && pnpm exec vitest run src/components/chat/__tests__/ChatView.spec.tsx src/components/chat/__tests__/ChatView.notification-sound.spec.tsx src/kilocode/agent-manager/components/__tests__/MessageList.spec.tsx` 通过：3 个测试文件、31 个测试通过、12 个跳过。
- 第三轮 `cd packages/agent-runtime && pnpm test src/__tests__/force-send.test.ts` 通过：1 个测试文件、3 个测试通过。
- 第三轮 `bash scripts_package_deeptask_vsix.sh` 通过，产物 `deeptask-5.5.0.vsix` 与 `bin/deeptask-5.5.0.vsix`，校验输出 `VSIX verified: deeptask-5.5.0.vsix 42399635`。
- 第三轮 `codium --install-extension deeptask-5.5.0.vsix --force && codium --list-extensions --show-versions | rg '^deeptask\\.deeptask@|deeptask'` 通过，确认 `deeptask.deeptask@5.5.0`。

## 定位结果

- 前端主要通过 `agentManager.sendMessage` 直接发送消息。
- 后端 `AgentManagerProvider` 仍保留 `sendingMessageMap` 和 queued message status 机制，存在繁忙时拒绝后续输入的风险。
- agent-runtime 收到普通 `sendMessage` 仅透传 webview message；当前任务不在 ask 状态时，`askResponse` 会被 stale-response 防护丢弃。
- 第一轮固定 150ms cancel-then-send 方案被用户反馈证伪：暂停/等待输入状态本来已有 pending ask，先 cancel 会破坏可消费 ask，随后过早 `askResponse` 仍可能被 stale 防护丢弃。
- 第二轮稳定修复点：runtime 强制发送先检查是否已有 pending ask；有则直接发送，没有才 cancel 并轮询等待 pending ask 后再发送。
- Agent Manager 前端本地 `messageQueue` atom 和 `useMessageQueueProcessor` 已删除，普通 ChatView 的可见 `QueuedMessages` 组件与 `messageQueue.length` 阻塞条件也已删除。
- 后端旧 `queueMessage/removeQueuedMessage/editQueuedMessage` 兼容入口现在只清空队列，不再保留或编辑队列项。
- 内联重发 `submitEditedMessage` 不再进入确认弹窗路径，直接清队列、按被编辑消息时间戳截断、保存前文，然后调用后端 `continueTaskFromUserMessage` 立即续跑，避免依赖前端按钮状态。
- 非 checkpoint 编辑不再向前寻找最近 `user_feedback` 作为截断点；截断点固定为被编辑消息本身，因此保留前文、删除该消息及全部后文。

## 约束

- 不使用复杂队列导致消息在任务列表/繁忙状态下无响应。
- 发送消息时应优先保证用户输入被快速处理。
- core extension 代码修改需要按项目规则添加 `kilocode_change` 标记。
