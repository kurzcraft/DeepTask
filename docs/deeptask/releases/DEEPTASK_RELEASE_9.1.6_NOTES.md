# Deeptask 9.1.6 发布说明

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

### 测试

- 新增回归：裸否定判定（7 组负反馈触发 gate、4 组确认/闲聊不触发）+ 负反馈注入框架验证。
- Task.spec 139/139、task 全套 17 文件 257 过、ClineProvider sticky 套件 4 文件 11 过、`pnpm check-types` 通过。
