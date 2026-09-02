# Deeptask 9.1.8 发布说明（覆盖更新）

发布日期：2026-09-02（本文件为 9.1.8 覆盖发布版，含追加修复）

> 本版本覆盖了首发 9.1.8 的 Release 资产与说明。若你已安装首发 9.1.8，请重新下载本 VSIX 覆盖安装以获得追加修复。

## 本版修复

### 1. 无按钮卡死 + 发消息卡死（双层控制看门狗，首发内容）

点击"强制继续/恢复"后若宿主在 4 秒宽限窗内无任何真实进展（无新流式输出、无新提问、消息列表未推进），界面强制渲染"继续 + 取消"兜底控制行；挂起提问或命令运行中即使按钮文本被清空也保留兜底行；滚动到底按钮不再被误判为任务控制而掩盖卡死；看门狗的终端继续指令优先路由到焦点会话任务，历史重开的后台任务无法吞掉恢复操作。

### 2. 任务结束后追问永远无回复的 agent 死循环（追加修复）

**复现链路**（复现.md 实证）：工具被中断 → 用户发送新消息（如"有没有固定网址的长期的免费方法？"）→ 模型用旧总结尝试 `attempt_completion` → 宿主拒绝门返回 "Do not claim the continued task is complete yet" → 循环烧尽 mistake limit → 用户的新消息永远得不到回复。

**根因**：拒绝门不区分"可执行工作续轮"与"纯对话续轮"。纯提问/确认/闲聊类消息的答复本身就是交付物，没有工作工具可调用，拒绝门把它困在一个"任何路径都无法收尾"的回合里。

**修复**：
- 双 gate：拒绝门现在额外要求 `requiresProgressListExpansion`（由宿主 actionable 启发式判定）。非 actionable 的纯对话续轮直接放行收尾。
- 断路器：同一续轮内连续 3 次被拒后，gate 强制放行，模型必定能收尾并回复用户。执行任何真实工作工具会重置计数；每个新用户回合恢复完整重试预算。计数只在真实拒绝点递增（`recordPrematureCompletionRejection`），流式 `handlePartial` 中的查询不产生副作用。

### 3. 点击取消后按钮灰死 + 发消息卡死（追加修复）

**根因**：点击 Cancel/Terminate 后 `didClickCancel`/`sendingDisabled` 置位，若宿主 `cancelTask()` 内部（abortTask / 重水化）永久挂起，`finally` 中的状态广播永不执行——前端既无按钮恢复也无输入框自愈。且原死信看门狗把"仍在流式中"当作宿主进展，取消卡死时被短路永不触发。

**修复**：
- 前端取消专用看门狗：取消点击武装 cancel 模式死信看门狗；该模式下"isStreaming 仍为真"被视为卡死状态本身而非进展，只有流式真正结束（或新消息/新提问到达）才解除。触发时强制渲染兜底"继续 + 取消"行，并自愈 composer（重置 sendingDisabled/didClickCancel）。
- 宿主侧有界取消：`cancelTaskAndRestoreUi` 用 `Promise.race` 给 `cancelTask()` 加 10 秒硬超时——abort/重水化挂起不再吞掉最终状态广播，webview 必然收回控制权。

## 测试证据

- `Task.spec.ts`：142 通过（含 4 个新回归测试：非 actionable 放行 / 断路器 3 次熔断放行 / 工作工具重置计数 / 旧测试语义修正）
- `attemptCompletionTool.spec.ts`：21 通过（含断路器放行测试）
- `webview-ui`：`tsc -b` 类型检查通过

## 安装

```bash
codium --install-extension ./deeptask-9.1.8.vsix --force
```
