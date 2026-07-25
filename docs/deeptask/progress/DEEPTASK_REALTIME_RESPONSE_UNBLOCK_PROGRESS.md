# DeepTask 实时响应与命令卡死系统疏通进度

## 检查清单

- [x] 查询 universe-memory 中命令卡死与实时响应相关记忆
- [x] 创建并维护本进度文件
- [x] 查找早期正常 Kilo/Roo 的终端命令与用户消息响应实现
- [x] 对比当前 Task/message queue/terminal operation 改动找阻塞点
- [x] 设计并实现用户操作实时回执与命令完成解耦修复
- [x] 补充回归测试覆盖命令卡住时新消息仍响应
- [-] 运行聚焦测试并打包安装验证
- [ ] 存储经验并汇报

## 用户最新现象

- 命令再次卡住。
- 用户继续发消息也卡死，说明不只是单个 terminal process 未 resolve，而是用户输入到任务/队列的响应链路也被阻塞。
- 用户明确要求参考早期正常 Kilo Code 做工业级系统疏通。

## 当前硬约束

- 用户操作必须实时有回执，不能因为命令、provider、压缩或工具等待导致前端无响应。
- 命令执行完成、终端剪枝、provider 请求、上下文压缩、消息队列应互相解耦，任何一个子系统卡住都不应吞掉用户新消息。
- 之前针对 stale command_output 按钮、shell 完成通知、OpenAI maxTokens sentinel 的修复仍有价值，但用户复测说明它们不是完整根因。

## 初始判断

- 如果“发消息也卡死”，重点不再是 TerminalRegistry 剪枝，而是 Task/ClineProvider/messageQueue/webview ask-response 的主循环等待模型。
- 早期正常实现很可能采用更直接的用户消息入队/打断路径；当前自定义队列、自动继续、终端操作反馈或上下文压缩可能把用户输入排在一个永不完成的 await 后面。
- 需要用 git 历史对比 `Task.ts`、`ClineProvider.ts`、`MessageQueueService.ts`、`ExecuteCommandTool.ts`、`Terminal.ts` 的旧实现。

## 验证记录

- 记忆搜索 `DeepTask KiloCode 命令卡死 实时响应 终端 队列 早期正常` 未命中。
- git 历史锚点：`bf6f117 fix(deeptask): 彻底修复队列消息问题并优化用户反馈` 是早期正常队列/响应链路参考点。
- 与 `bf6f117` 对比后确认：当前实现禁用了可见 message queue，并在无 pending ask 时清理 stale ask 后仅刷新状态；完成态续写会 `await continueTaskFromUserMessage()`，而该方法会继续 `await initiateTaskLoop()`。
- 新修复：当无 pending ask 但当前任务存在 `terminalProcess` 且用户发来文本/图片时，webview handler 立即走 `handleTerminalOperation("continue", ...)`，并且使用 `void` 非阻塞调用后立即 `postStateToWebview()`。
- 新修复：完成态续写仍会调度 `continueTaskFromUserMessage()`，但 webview handler 不再等待主任务 loop 完成，确保用户操作先返回。
- 新增回归：卡住终端时用户文本会立刻路由到终端继续路径；完成态续写不会阻塞 webview 状态刷新。
- 聚焦测试通过：`cd /media/kurz/aleber/vscode/deeptask/src && pnpm test core/webview/__tests__/webviewMessageHandler.spec.ts`，1 个测试文件通过，29 passed。
- 组合测试通过：`cd /media/kurz/aleber/vscode/deeptask/src && pnpm test core/webview/__tests__/webviewMessageHandler.spec.ts core/task/__tests__/Task.terminal-operation.spec.ts core/tools/__tests__/executeCommandTool.spec.ts integrations/terminal/__tests__/TerminalRegistry.spec.ts api/providers/__tests__/openai.spec.ts`，5 个测试文件通过，112 passed。
