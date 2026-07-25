# Deeptask 自动/手动上下文压缩质量审计

## 目标

- 检查自动压缩是否仍有状态、事务、provider、工具协议、焦点或 token 预算漏洞。
- 验证手动压缩是否使用与自动摘要相同的高质量输入清洗、摘要提示、焦点锚点和历史提交策略。
- 保留产品语义差异：自动摘要失败可安全滑窗 fallback；手动压缩失败应明确报告而非伪装成功。
- 修复后测试、提交、重打包安装并更新 GitHub Release。

## Checklist

- [x] 查询历史记忆与否证库
- [x] 审计自动/手动入口和共享摘要层
- [x] 建立质量等价与故障差异矩阵
- [x] 修复自动压缩漏洞
- [x] 统一手动压缩质量
- [x] 增加测试并联合验证
- [x] changeset、提交、推送
- [x] 打包、安装、发布
- [x] universe-memory

## 已知边界

- 自动路径职责是预算安全，摘要失败后允许 sliding-window fallback，fallback 成功应清除已处理 provider error。
- 手动路径职责是用户主动生成摘要，provider error 应显式显示，不能无声退化为截断。
- 两者的“摘要成功质量”应一致；允许差异的是失败策略与触发阈值，不是摘要内容、清洗、焦点或提交质量。

## 验收矩阵

| 维度                     | 自动压缩                      | 手动压缩                                           | 期望            |
| ------------------------ | ----------------------------- | -------------------------------------------------- | --------------- |
| 输入清洗                 | `summarizeConversation`       | 统一至 `condenseContext` → `summarizeConversation` | 相同            |
| 摘要 prompt              | custom/default shared         | custom/default shared                              | 相同            |
| provider/model           | configured condense profile   | configured condense profile                        | 相同            |
| 最新任务焦点             | commit 后 anchor              | commit 后 anchor                                   | 相同            |
| tool_use/result 完整性   | native sanitizer              | flush + native sanitizer                           | 相同/手动更安全 |
| reasoning 泄漏防护       | shared sanitizer              | shared sanitizer                                   | 相同            |
| token 计数有效性         | 先校验后提交（已修）          | 先校验后提交                                       | 相同            |
| 成功提交事务             | snapshot/rebase + valid token | snapshot + valid token                             | 同等级事务保证  |
| 失败策略                 | fallback                      | 报错                                               | 有意差异        |
| UI started/response 闭环 | try/finally                   | provider finally                                   | 都闭环          |

## 发现与修复

1. **自动压缩事务漏洞（高置信度 0.98）**：自动/forced 路径先覆盖历史，再检查 `newContextTokens`。当摘要返回 `0`/missing 时，UI 报错但坏摘要已经持久化。现改为校验成功后才提交，错误直接终止本次 provider attempt。
2. **模型调用手动压缩质量分叉（高置信度 0.99）**：`condenseTool` 直接调用 `summarizeConversation`，绕过 pending tool flush、custom prompt、condense provider、native protocol、stale transaction、token 校验、焦点 anchor、UI event。现统一调用 `Task.condenseContext()`。
3. **虚假成功回执（高置信度 0.98）**：旧 `condenseTool` 即使摘要未提交也可能返回成功。`condenseContext()` 现返回 `boolean`，工具只在 `true` 时确认成功。
4. **自动/手动成功质量结论**：工具栏手动与自动原本共享核心摘要层；修复模型工具入口后，三种入口在输入清洗、prompt/provider、协议、焦点与 token 验证上已经同质量。合理差异仅剩触发和失败策略。

## 验证

- 压缩联合测试：5 files，194 passed，7 skipped。
- 新增自动 invalid-token 不提交历史测试。
- 更新 condenseTool 测试，验证共享入口和失败不伪报成功。

## 发布

- commit：`48c74994`，已推送 `origin/main`。
- VSIX：`deeptask-5.5.0.vsix`，42,418,952 bytes，内容与品牌校验通过。
- VSCodium：已强制安装并确认 `deeptask.deeptask@5.5.0`。
- Release：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- Asset：`https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`。
- 日志：`DEEPTASK_CONDENSE_QUALITY_PACKAGE.log`、`DEEPTASK_CONDENSE_QUALITY_RELEASE.log`。
- 记忆：`宇宙/记忆/项目记忆/2026-07-24-Deeptask自动手动压缩质量等价与事务修复.md`。
