# Deeptask 9.1.6 发布说明

## 并行会话运行图标缺失修复

任务完成后再次续聊重启时，侧边栏并行会话栏（Parallel Rail）不再丢失运行中转圈图标。

### 根因

1. 任务完成时 [`markConversationCompleted`](src/core/kilocode/parallel/ParallelManager.ts) 写入 `completedAt`。
2. 续聊重启走 [`ensureTaskConversation`](src/core/kilocode/parallel/ParallelManager.ts) 复用已有会话，但不清除 `completedAt`（仅缺标题时才经 `bindConversation` 清除）。
3. [`ParallelRail.runningConversationIds`](webview-ui/src/components/kilocode/parallel/ParallelRail.tsx) 与 broadcast 的 live-task 补录双双排除带 `completedAt` 的会话 → 运行中无转圈图标。

### 修复内容

- **reopen 清 stale 完成标记**：`ensureTaskConversation` 复用已有会话时若存在 `completedAt` 则调用新增 `clearConversationCompleted` 清除并广播。
- **broadcast 补录不再跳过**：live-task 补录不再跳过带 stale `completedAt` 的活跃运行任务。
- **running session 优先**：`ParallelRail.runningConversationIds` 改为 running session 优先于 stale `completedAt`。

### 测试

- ParallelManager.spec 32/32（含新增「reopen 清 stale completedAt」）、ParallelRail.spec 23/23（含新增「stale completedAt 仍显示 spinner」；旧「stale running session 不转圈」测试改为 completed session 语义）、Task.spec 139/139、`pnpm check-types` 通过。

## 短负反馈被忽略（"模型不理人"）修复

用户在修复尝试后回复「没有用」「不行」「didn't work」等极短负反馈时，9.1.5 及之前版本的代理会无视反馈继续推进旧计划：重述旧状态、重复已失败的方案、甚至要求用户重新确认已失败的方案——表现为"发消息它不理我"。

### 根因（四因叠加）

1. [`buildUserContinuationText`](src/core/task/Task.ts) 注入的续聊指令采用死二分：question/acknowledgement/discussion → 仅对话式回复；concrete work → 立里程碑。裸负反馈被语义判入前者。
2. 注入文本声称 "It supersedes any earlier state or conclusion"，压过系统规则中「negative feedback is executable work」。
3. [`isLikelyActionableContinuation`](src/core/task/Task.ts) 正则缺少裸否定模式（「没有用」「没用」「不行」均不匹配），进度清单扩展门不触发。
4. 中断时工具结果填 "Tool execution was interrupted before completion." + 模型惯性 → 重述旧状态。

### 修复内容

- **聊天优先的语义引导**：每条用户消息必须先得到自然聊天式回复（用用户的语言表明理解了所说内容），对任何类型消息强制；诊断/新方案/里程碑等机制在同一回复内跟随，绝不替代回复本身。
- **负反馈=缺陷报告**：短负反馈在同回复中说明失败原因、转向实质不同的新方案、并记录新里程碑；禁止重述旧状态、重复失败方案、要求用户再确认失败方案。
- **supersedes 边界收紧**：仅压过历史 assistant 轮，永不覆盖系统规则。
- **host 门扩展**：中英裸否定模式（没有用/没用/不行/没效果/还是没/didn't work/still broken 等）现在触发进度清单扩展门；纯确认与闲聊保持非 actionable，语义判断仍归模型。
- **回复与工具可同响应**（本次补强）：明确回复是响应中的纯文本，文本与工具调用可在同一响应中，回复在前工具在后；禁止因要调工具而跳过回复、禁止裸工具调用无文字；被中断的工具工作只能在回复用户之后恢复，不能替代回复。

### 测试

- 新增回归：裸否定判定（7 组负反馈触发 gate、4 组确认/闲聊不触发）+ 负反馈注入框架验证。
- Task.spec 139/139、task 全套 17 文件 257 过、ClineProvider sticky 套件 4 文件 11 过、`pnpm check-types` 通过。
