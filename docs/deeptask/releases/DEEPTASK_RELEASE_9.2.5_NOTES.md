# Deeptask 9.2.5 版本说明

发布日期：2026-10-03
版本类型：Patch（多对话独立性大修 + 工作区挤出策略精细化 + 消息投递可靠性）

## 一、修复清单

### 修复 1：evolve 模式自动升级 + 对话间模式独立性

- **根因 A**：`ModeRouter.resolveEvolveAlias` 的正则 `^evolve-(\d+)$` 只匹配带数字后缀的别名，新对话选择基础 `evolve` 模式（无后缀）时不会自动升级到最新 evolve-N。已改为同时匹配 `^evolve$` 与 `^evolve-(\d+)$`，都解析到最新副本。
- **根因 B**：子代理未指定 mode 覆写时读取全局 `state.mode` 而非父任务实际运行模式，导致父任务用 evolve-N 时子代理落到别的模式。已改为继承父任务锁定的模式。
- **根因 C**：`focusTask` 重建对话时不恢复该对话保存的模式，切回对话后模式显示/运行错乱。已在栈内路径与重建路径都恢复对话自身模式。

### 修复 2：运行按钮闪现 + 切换对话吞文本框文本

- **吞文本根因**：切换对话 `invoke:newChat` → `handleChatReset` 无条件清空 `inputValue`。已改为切换场景保留草稿文本与已选图片，仅真正新建对话时清空。
- **按钮闪现根因**：`task.ts` 切换 effect 不同步清 `primaryButtonText`，旧对话的 Run/审批按钮要等 messages 异步到达才消失，期间闪现在其他对话的开始界面。已改为切换时同步清除。
- **连带修复**：`askResponse` 路由跟随当前聚焦对话，栈顶后台任务不再抢走按钮响应。

### 修复 3：工作区多进程占用只挤子代理，不挤父代理

- **根因**：`workspaceOccupancy` 把与父代理共享 cwd 的只读子代理也计入占用者，父代理触发 `ensureUnoccupiedWorkspace` 时反被自己的子代理挤出原工作区。
- **修复**：占用计算区分读写语义——只读子代理（`needs_workspace:false`）不计入占用、直接共享父目录；写型子代理（未指定或 `true`）才挤出到独立工作区。`dispatch_subagents` 工具描述已注明"只读子代理用 false，写代理不指定或指定 true"。

### 修复 4：手动停止子代理后发送消息的幽灵对话

- **根因**：`rescuePendingContinuation` 用 `getCurrentTask()`（栈顶）而非聚焦对话定位投递目标，子代理停止后从发送框发消息会重建错误任务，形成后台幽灵对话（文件夹栏不可见）且父代理进度丢失。
- **修复**：聚焦对话任务不在栈内时先 `focusTask` 重建（对话一定显示在文件夹栏）再投递；`queueMessage` 兜底 `createTask` 同样走聚焦路由。

### 修复 5：工具调用（尤其归档）后发送消息首次不可见

- **根因**：rescue/deliver 路由不跟随聚焦对话，park 后 10 秒兜底投递落到错误任务，模型看不见，只能手动重发。
- **修复**：`handleTerminalOperation` continue 分支与 `rescuePendingContinuation` 全部跟随聚焦对话任务，确保任何时刻首次发送即被目标模型看见。

### 修复 6（发布前追加）：切回对话恢复 Run/Kill/Continue 控制

- **根因**：`commandExecutionStatus` 是瞬态事件，切换对话时被正确清除，但切回时没有重放源，命令运行中等待审批的控制按钮消失。
- **修复**：`ClineProvider` 增加每任务活跃命令注册表，`focusTask` 时 `replayFocusedTaskLiveCommands` 重放到 webview；所有命令状态事件携带 `taskId`，webview 按 `currentTaskItem.id` 过滤，杜绝跨对话串扰。

### 修复 7（发布前追加）：模式切换污染其他对话 + 切换对话变慢

- **根因 A**：`handleModeSwitch` 用 `getCurrentTask()`（栈顶）定位任务，pending 新对话主页选模式会写进其他对话的任务。已改用 `resolveStickyTaskTarget()`：focused 优先，pending 时不动任何任务。
- **根因 B**：`focusTask` 链路 broadcast 执行两次（`postStateToWebview` 内部已调度一次）。已移除显式 `await broadcast`，切换对话提速约一半。

## 二、验证

- `src` / `webview-ui` check-types 全部 PASS。
- 目标测试 58/58 通过，含新增 `ClineProvider.liveCommandReplay.spec.ts` 6 用例、`workspaceOccupancy.spec.ts` 只读/写子代理占用用例、`webviewMessageHandler.parallel.spec.ts` 聚焦路由用例。
- 全量回归 8459 用例：198 个失败经 `git stash` 基线对照确认全部为预存失败（.kilocode→.deeptask 目录迁移遗留），本次零新增失败。

## 三、涉及文件

- `src/core/kilocode/ModeRouter.ts` — evolve 别名解析兼容无后缀形式
- `src/core/kilocode/parallel/workspaceOccupancy.ts` — 读写语义区分的占用计算
- `src/core/kilocode/parallel/ParallelManager.ts` — 子代理 spawn 模式继承父任务
- `src/core/tools/ParallelTools.ts` — dispatch_subagents 工具描述注明 needs_workspace 语义
- `src/core/webview/ClineProvider.ts` — focusTask 模式恢复/命令重放/聚焦路由/草稿保留/广播去重
- `src/core/webview/webviewMessageHandler.ts` — askResponse/continue/queueMessage 聚焦路由
- `src/core/webview/App.tsx`、`webview-ui/src/context/ExtensionStateContext.tsx` — commandExecutionStatus taskId 过滤
- `webview-ui/src/components/chat/ChatView.tsx`（task 切换同步清按钮）等
