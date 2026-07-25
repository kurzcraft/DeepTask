# Deeptask 命令执行消息继续任务进度

## 目标

修复 Deeptask 插件在执行命令时，用户发送消息显示为队列而不是插入用户对话/继续任务的问题；随后打包并重新安装，供用户重启 VSCodium 检查。

## 进度清单

- [x] 查询宇宙记忆，读取 Deeptask 命令输出/队列相关历史修订。
- [x] 创建本进度清单文件。
- [x] 定位当前仍可能进入队列或不显示的源码/dist/安装包入口。
- [x] 修复源码与 `src/dist/extension.js` 等实际运行时代码。
- [~] 打包 Deeptask VSIX 并重新安装到 VSCodium/VS Code：`vsce` 在当前终端环境未产出 VSIX，已改用备用方案直接同步到已安装扩展目录。
- [x] 验证安装目录关键特征。
- [x] 保存本次经验到宇宙记忆。
- [x] 用户复测发现：重新发送已有消息会先变队列、已有消息变黑并卡住；普通发送消息也可能偶发进入同类问题。
- [x] 修复主 ChatView：旧队列项不再自动重发为当前 `askResponse`，也不再渲染 `QueuedMessages` 可见队列。
- [x] 重新构建 webview 并同步安装目录。
- [x] 验证安装目录主聊天 bundle 队列渲染/重发特征已移除。
- [x] 用户复测发现：命令运行时前端显示“我发送了消息”，但模型实际没有看到 prompt；重新发送已有消息后，后续自己发送的消息仍堆在队列并卡住。
- [x] 定位根因：`Task.handleTerminalOperation()` 只设置 askResponse 并 `terminalProcess.continue()`，没有设置 `ExecuteCommandTool` 内部 `message` 变量；同时后端 `Task.ask()` / `processQueuedMessages()` 仍会重放旧队列。
- [x] 修复后端：新增 `pendingCommandOutputFeedback` 槽，`ExecuteCommandTool` 兜底消费；`Task.ask()` 与 `processQueuedMessages()` 改为清空旧队列而非重放；`editMessageConfirm` 开始前清空队列。
- [x] 已重建 `src/dist/extension.js` 并同步到 VSCodium/VS Code 安装目录，验证安装目录包含 `pendingCommandOutputFeedback` / `consumePendingCommandOutputFeedback`，且不再含 `Failed to submit queued message` 队列重放路径。

## 当前认知

- 已知：历史修复已经覆盖主 ChatView 队列、后端 queueMessage fallback、Agent Manager 前端直接发送、后端 messageQueued 兼容入口、Agent Manager panel viewType 命名空间。
- 已定位：Agent Manager 源码仍保留 `QueuedMessageItem` 渲染分支；`sendMessage()` 只写 stdin，不主动把旧入口/建议入口发送的用户文本写入 `sessionMessages` 并回推 webview。
- 已修复：后端 `sendMessage()` 现在会追加/去重 `say: "user_feedback"` 并回推 `agentManager.chatMessages`；Agent Manager 消息列表不再渲染队列项，旧队列只由处理器 drain。
- 已验证：`/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0` 与 `/home/kurz/.vscode/extensions/deeptask.deeptask-5.5.0` 均包含 `agentManagerServerUserFeedback`、`deeptask.AgentManagerPanel`、`agentManagerOptimisticUserFeedback`、无 `QueuedMessageItem`，且保留 `terminalOperationText` / `terminalOperationImages`。
- 打包异常：`vsce package` 在本环境中无明确错误输出但未生成 `deeptask-5.5.0.vsix`；`src/package.json` 的 `vscode:prepublish` 已恢复为 `pnpm bundle --production`。
