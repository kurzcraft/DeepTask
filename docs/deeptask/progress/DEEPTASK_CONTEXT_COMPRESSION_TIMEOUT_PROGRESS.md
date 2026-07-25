# DeepTask 上下文压缩 API 超时修复进度

## 检查清单

- [x] 查询上下文压缩超时相关记忆
- [x] 创建并更新本次上下文压缩超时进度文件
- [x] 定位 condenseContext API 请求与首块超时处理路径
- [x] 补充上下文压缩提供商超时回退测试
- [x] 实现压缩失败不阻断任务继续的修复
- [x] 运行相关测试
- [x] 定位命令不自动执行与运行按钮卡死路径
- [x] 定位结束任务后对话一直回答结束路径
- [x] 实现命令审批/结束任务回归修复
- [x] 补充并运行相关回归测试
- [x] 打包安装并发布 VSIX
- [x] 存储经验并完成汇报

## 用户反馈

上下文压缩时 API 请求失败：

```text
提供方终止了请求: API stream timed out after 60000ms while waiting for the next chunk; no model output was received.
提供商错误
```

## 初始判断

- 这是上下文压缩专用 API 调用的首块/下一块流式输出超时，不是普通终端或用户取消路径。
- 需要确认 `condenseContext()` 失败时是否会阻断当前任务继续，以及是否应改为保留原始上下文并继续执行用户请求。
- 记忆检索未命中已有明确方案。

## 当前发现

- `summarizeConversation()` 直接 `for await` 消费 `createMessage()` 流；当提供商首块超时抛出异常时，异常会绕过结构化 `SummarizeResponse.error`。
- `manageContext()` 已有“压缩失败后滑动窗口截断”的回退逻辑，但此前只覆盖 `summarizeConversation()` 返回 `error`，不覆盖 throw。
- 手动 `Task.condenseContext()` 对返回 `error` 能显示 `condense_context_error` 并返回；真正问题是流式异常没有被转换为 `error`。

## 当前修复

- `summarizeConversation()` 捕获 condensing stream 创建/消费异常，返回 `{ error }`，避免提供商超时冒泡为全局提供商错误。
- `manageContext()` 额外包裹 `summarizeConversation()`，即使未来有异常逃出，也会记录错误并继续走滑动窗口截断回退。
- 新增单测覆盖：流式压缩超时返回 error；自动上下文管理遇到 summarize 抛错时回退到截断。

## 追加用户反馈

- 仍然有命令不自动执行，点运行按钮卡死。
- 结束任务对话一直回答“结束”。

## 追加定位

- 前端 `askResponse` 消息没有携带来源 ask 行标识；后端只用 `lastMessageTs` 判断是否存在 pending ask。
- 旧运行按钮、旧结束按钮或延迟 UI 响应可能在下一轮 ask 已经出现后到达，导致旧按钮响应被当前 ask 消费。
- `completion_result` 的“开始新任务/结束”类旧响应如果误喂给当前 ask，会让模型继续围绕“结束”反馈反复 attempt_completion。

## 追加修复

- `WebviewMessage` 增加可选 `askTs`，用于绑定 ask 响应和来源 ask 行。
- `ChatView` 记录当前 ask 行的 `ts`，普通 `askResponse` 都随消息发送 `askTs`。
- `Task` 暴露 `getPendingWebviewAskTs()`；`webviewMessageHandler` 仅在 `askTs` 匹配当前 pending ask 时消费响应。
- 保留兼容：没有 `askTs` 的 CLI/agent/旧调用仍按 `hasPendingWebviewAskResponse()` 处理。

## 验证记录

- 上下文压缩测试通过：`cd src && pnpm test core/condense/__tests__/index.spec.ts core/context-management/__tests__/context-management.spec.ts`，2 个文件通过，80 passed，3 skipped。
- 回归测试通过：`cd src && pnpm test core/webview/__tests__/webviewMessageHandler.spec.ts core/tools/__tests__/executeCommandTool.spec.ts core/condense/__tests__/index.spec.ts core/context-management/__tests__/context-management.spec.ts`，4 个文件通过，122 passed，3 skipped。
- 打包通过：`bash scripts_package_deeptask_vsix.sh`，生成并验证 `deeptask-5.5.0.vsix`，大小 42,398,135 bytes。
- 安装通过：`codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force`。
- VSCodium 扩展列表确认：`deeptask.deeptask@5.5.0`。
- GitHub Release 已发布/更新：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- Release 资产：`deeptask-5.5.0.vsix`，大小 42,398,135 bytes，下载地址 `https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`。
- Git 提交并推送：`cca7572 fix: guard stale ask responses`。
- 经验已存储：`/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-06-Deeptask上下文压缩超时与旧按钮响应修复.md`。
