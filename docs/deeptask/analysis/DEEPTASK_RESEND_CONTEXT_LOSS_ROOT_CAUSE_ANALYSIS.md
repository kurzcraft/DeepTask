# Deeptask 编辑重发上下文卡死专项进度

## 检查清单

- [x] 查询重发、取消重建和压缩相关 universe-memory
- [x] 从真实 VSCodium 任务存储提取 UI/API 历史
- [x] 审计 rewind、取消重建、工具协议和 continuation 语义
- [x] 建立编辑重发语义回归测试
- [x] 实施编辑重发与普通 continuation 分流
- [x] 通过定向测试、类型检查、lint 和 bundle
- [x] 构建、强制安装并核验新 VSIX
- [ ] 重载 VSCodium extension host 后完成一次真实编辑重发验收
- [x] 修订 universe-memory 中过高置信度结论

## 用户症状

> 重新发送加入不了上下文，模型看不到，卡死。

关联现象：第一次重发显示 `Deeptask 说 ...` 后停住，第二次重发才恢复。

## 真实运行证据

失败任务：`019f5512-cd5e-7646-97c6-2b864eb9bb6c`

持久化目录：
`/home/kurz/.config/VSCodium/User/globalStorage/deeptask.deeptask/tasks/019f5512-cd5e-7646-97c6-2b864eb9bb6c`

关键时间线：

1. UI `user_feedback` 索引 `1820`、时间戳 `1784455951677` 包含完整重发文本。
2. API user 索引 `98` 同时包含前一个中断工具调用的 `tool_result` 和完整重发文本。
3. API assistant 索引 `99` 不是空响应，而是仅调用 `update_todo_list`。
4. API user 索引 `100` 包含与该调用 ID 匹配的 `tool_result`。
5. 因此消息已进入上下文，native `tool_use` / `tool_result` 协议也完整。

完整提取结果保存在 `resend-context-loss-evidence.txt`。

## 根因

编辑重发在 rewind 后错误复用了普通 `continueTaskFromUserMessage()` 语义。该路径会：

- 把重发包装为 `task_continuation`；
- 清空旧 todo；
- 设置 `requiresProgressListExpansion = true`；
- 强制模型首个动作调用 `update_todo_list`。

模型确实看到了重发文本，但第一轮被强制进度门禁占用，不能直接处理重发内容。工具结果进入下一轮后，UI 又可能只收到字面量 `...`，形成“第一次卡住、第二次才恢复”的用户体验。

## 已否证假设

### 重发消息没有加入 API 历史

置信度降为 `0.01`。真实 `api_conversation_history.json` 已逐字包含重发文本。

### `addOrMergeUserContent()` 过滤文本导致空 user message

置信度降为 `0.01`。源码确认它只合并或追加 block，不执行该过滤。

### `finalUserContent` 为空是主要根因

置信度降为 `0.05`。当前失败请求中的 user 内容完整，不应增加 `forceAddNextUserMessage` 一类状态。

### pending 100ms 消费竞态是完整根因

置信度降为 `0.25`。原子消费修复是必要的稳定性保护，但安装后真实症状仍存在，不能解释首轮被 todo 工具占用。

## 实施方案

新增 `UserContinuationOptions`：

```ts
interface UserContinuationOptions {
  kind?: "continuation" | "edited_resend"
}
```

编辑重发路径传递 `kind: "edited_resend"`，并保证该标记跨取消重建保留。

`edited_resend` 的行为：

- 保留 rewind 边界之前的 API 历史；
- 使用独立 `edited_resend` 包装说明替换原消息；
- 不注入 `task_continuation` 强制指令；
- 不清空已有 todo；
- 不激活 `requiresProgressListExpansion`；
- 允许首轮直接调用实际工作工具。

普通中途发送和完成后新指令仍使用原 continuation 语义，保持现有进度门禁。

## 测试覆盖

- `webviewMessageHandler.spec.ts`：直接重发和取消重建分支均传递 `edited_resend`。
- `ClineProvider.flicker-free-cancel.spec.ts`：pending continuation 跨 Task 重建保留语义标记并原子消费。
- `Task.spec.ts`：编辑重发保留 todo、不触发进度门禁、不包含新任务包装；普通 continuation 测试保持通过。

验证结果：

- 定向 Vitest：`136 passed, 4 skipped`
- `pnpm check-types`：`22/22` 成功
- `pnpm lint`：`18/18` 成功
- extension bundle：成功
- `git diff --check`：成功
- VSIX：`deeptask-5.5.0.vsix`，`42,414,628` 字节
- SHA-256：`3e0921ce8a8b9cf4f20037d87b5a678f9236185aa5e525ab9f84747a81a14e87`
- VSCodium 强制安装：`deeptask.deeptask@5.5.0` 成功
- 已安装 bundle：`27,568,544` 字节，包含 `edited_resend` 和独立重发提示标记

## 2026-07-19 续作审计

- [x] 重新核验安装 bundle：`27,569,257` bytes，安装时间 `2026-07-19 23:35:22 +0800`
- [x] 确认安装 bundle 包含 `edited_resend`、独立重发提示、压缩单飞和 stale 丢弃 marker
- [x] 检查最新 globalStorage 任务尾部，确认没有新的用户编辑重发样本
- [x] 重跑重发、取消重建与压缩定向测试：3 files，107 passed，3 skipped
- [ ] 重载 VSCodium extension host 后完成一次真实编辑重发验收

最新任务目录 `019f7ae4-42d4-72cf-a02e-03ae5ea1e855` 记录的是代理恢复和审计流程，不是用户执行编辑重发后的样本。因此静态产物核验只能证明修复已安装到磁盘，不能证明当前 extension host 已加载，也不能替代真实 UI 验收。

本次续作尝试通过命令面板和 VSCodium CLI 执行窗口重载，但 extension host 的启动时间仍为 `2026-07-19 23:23:58 +0800`，早于安装 bundle 时间。两种无侵入重载方式都没有使当前 host 重新启动；根据“不终止工作目录之外进程”的安全约束，未强杀 VSCodium 进程。真实验收仍需在用户可控窗口完成一次 Reload Window 后执行编辑重发。

## 剩余验收

1. 重载 VSCodium extension host，使当前窗口加载新安装的 bundle。
2. 在真实会话中编辑并重发旧消息一次，确认首轮直接处理且不先调用 `update_todo_list`。
3. 若仍失败，从该次新任务目录重新提取 UI/API 历史，不再复用旧任务证据猜测。

## 记忆结晶

- 项目记忆已更新：编辑重发与新任务 continuation 必须类型分离，综合置信度 `0.88`。
- 错误记忆已更新：pending timer 竞态是必要修复但不是当前症状的充分根因，置信度修正为 `0.72`。
- 诊断原则：UI 卡住不等于用户消息未进 API；先比较持久化 UI/API 历史，再判断传输、协议、语义门禁或渲染边界。
