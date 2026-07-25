# Deeptask 上下文压缩提供商稳定性与 5.5 发布进度

## 发布后失败续查（2026-07-19）
- [x] 收集失败现场，区分旧 extension host、压缩 provider 与重发/工具协议故障
- [x] 复现并定位实际失败边界：普通 provider 流的后续块 60 秒 idle timeout 误杀长推理
- [x] 实施修复并增加回归测试：移除后续块应用层超时，保留首块超时与显式取消
- [x] 重打包并强制安装 VSCodium，核验源码 bundle 与安装 bundle 一致
- [x] 重载 VSCodium 后完成真实长推理验收：Node extension host 于 `00:21:22` 启动，晚于 `00:11:50` 安装时间
- [x] 覆盖 release：asset ID `482539671`，远端大小与 SHA-256 经认证 API 校验一致
- [x] 记录失败修正到 universe-memory，真实端到端置信度由 0.95 下调为 0.88
- [x] 质量审计：真实二次压缩提交成功，未发现截断、降级、provider error 或 reasoning 字段泄漏

### 本轮根因结论
- 真实失败任务 `019f7b14-b7e5-738e-a306-b72185745c9a` 在压缩前的普通 provider 请求记录了 `streaming_failed`，随后显示 `API stream timed out after 60000ms while waiting for the next chunk`。
- 同一任务随后压缩成功，`prevContextTokens=93028`、`newContextTokens=52448`，所以本轮不是压缩提交失败，也不是新 VSIX 未加载。
- `getApiStreamIdleTimeoutMs()` 与后续块 `nextChunkWithAbort()` 来自本地 `cd1a60b92`，不是 KiloCode 5.5 原版稳定流消费语义；长 reasoning 间隔被错误当成 provider 无响应。

### 本轮修复
- `src/core/task/Task.ts`：后续流块只与显式 abort 竞争，不再与 60 秒应用层 timeout 竞争；首块 timeout 保留，用于识别真正无响应的 provider 请求。
- 回归矩阵：4 files，174 passed，7 skipped；`pnpm check-types` 22/22；`pnpm lint` 18/18；`git diff --check` 通过。
- VSIX：42,415,184 bytes，SHA-256 `dea4b504fd1f4ba2f93eada2cacf6bbf1b35584493ddcc0bf39e9d631bb07f75`。
- 安装 bundle：27,569,195 bytes，SHA-256 `c559551203d435660e44aeed038ee37b5b231adf4d7e5d62e447d5b281b1f238`；已与源码 bundle 一致。
- 初始 host 早于安装时间；随后 VSCodium 于 `2026-07-20 00:21:21 +0800` 重启，Node extension host 于 `00:21:22 +0800` 启动，已确认真实运行时加载本轮修复。
- 修复提交 `9cee8eda` 已推送到 `origin/main`；GitHub Release `v5.5.0` 已覆盖，asset ID `482539671`、state `uploaded`、远端大小 42,415,184 bytes、SHA-256 `dea4b504fd1f4ba2f93eada2cacf6bbf1b35584493ddcc0bf39e9d631bb07f75`。

## 压缩速度观察校正（2026-07-20）
- [x] 对照当前 Deeptask 与 KiloCode 5.5 原版压缩实现
- [x] 量化真实压缩日志中的耗时、输入规模、摘要长度和 provider 差异
- [x] 用户复核确认前期低耗时样本来自上下文较短，长上下文压缩速度处于正常范围
- [x] 撤回“当前实现显著快于 KiloCode 原版”的未受控因果推断，不再继续无必要性能调查
- [x] 将校正结论、置信度和证伪条件记录到既有 Obsidian 项目记忆

### 校正结论
- 压缩耗时随实际输入上下文规模、摘要输出长度、模型、provider 负载和网络状态变化；短上下文样本不能与长上下文样本直接比较。
- 当前真实长上下文样本约 63.2 秒和 81.6 秒，符合正常压缩速度；现有证据只支持“功能和质量正常”，不支持“实现层产生数量级提速”。
- 当前非流式摘要和 reasoning 清洗确实减少协议复杂度与无效输入，但尚无同模型、同 provider、同输入、同输出约束下的 A/B 数据证明其带来显著端到端提速。
- 置信度：短上下文是前期速度较快的主要解释为 0.95；当前整体速度正常为 0.96；存在显著实现层提速不超过 0.45。
- 可证伪条件：受控 A/B 在固定模型、provider、输入 token 和摘要质量下稳定复现显著时延下降，或长上下文样本持续出现与输入规模不相称的极低耗时。

## 任务目标
- 继续修复上下文压缩期间的 API 提供商错误和隐藏推理泄漏。
- 对齐 Kilo Code 5.5 原版上下文压缩稳定性不变量。
- 打包、安装到 VSCodium，并发布 release。

## 检查清单
- [x] 查询 universe-memory 并恢复既有压缩修复边界
- [x] 审计当前源码、工作树和 5.5 原版差异
- [x] 复现并定位当前 provider error / reasoning leak 根因
- [x] 实施最小修复、回归测试和 changeset
- [x] 运行定向测试、类型检查、lint 和依赖状态检查
- [x] 打包 VSIX 并安装到 VSCodium 验证
- [x] 提交并发布 GitHub Release
- [x] 更新本文件并写入 universe-memory

## 当前已知事实
- 既有修复覆盖摘要非流式优先、错误 fallback、native tool 历史清洗、reasoning 隔离、上下文溢出恢复、压缩单飞、revision/stale 校验和 append-only rebase。
- 静态验证不能替代 VSCodium Reload Window 后的真实长会话验收；本轮已补充安装后真实长会话审计。
- 本轮未重新安装 Python 依赖前，不应无依据修改 requirements.txt；若确实重装依赖，必须同步更新。
- `v5.5.0` 原版使用流式摘要并注入 synthetic reasoning；这与本轮要解决的 provider idle timeout 和 reasoning 回灌风险直接相关。

## 发现与决策
- 当前非流式摘要 prompt 可能重复拼接最终“Summarize...”消息，需要回归测试确认并修正。
- 独立 condensing provider 的 token 计数使用主 handler，需用测试验证是否会造成错误的“压缩后增长”判断。

## 验证状态
- 压缩矩阵：4 files，180 passed，7 skipped。
- 压缩 + 编辑重发矩阵：5 files，228 passed，7 skipped。
- 类型检查：22/22 tasks successful。
- lint：18/18 tasks successful；仅既有 TypeScript 5.9.3 支持范围警告。
- `git diff --check`：通过。
- 未重装 Python 依赖，仓库无 `requirements.txt`，无需更新。
- VSIX：`deeptask-5.5.0.vsix`，42,415,224 bytes，SHA-256 `868ebcce919ade5ecbbb50a2ea5b00690b6ce0452ab2da2b8429b25a1f9a27a0`。
- VSCodium：强制安装成功，`deeptask.deeptask@5.5.0`；安装 bundle 27,569,257 bytes，SHA-256 `6d15146c9befb1347005c70383337b1fe48c5ad7ee9d1014384166fcb32dcc82`。
- 提交：`5ad0c496` (`fix(condense): restore provider-safe context compression`) 已在 `origin/main`。
- Release：`v5.5.0` 已覆盖发布；认证 API 确认 asset `482524692` 为 `uploaded`，远端大小 42,415,224 bytes，SHA-256 与本地一致。
- 安装后真实质量审计：第二次自动压缩耗时约 63.2 秒，`outcome=condensed`、`canCommit=true`、`reusedInFlight=false`；上下文从 205,842 降至 35,861 token，摘要长度 10,013 字符，压缩率约 82.6%。
- 安装后真实请求首个 token 基线为 37,889，随后自然增长至 90,434；16 次 API 请求均 `usageMissing=false`，无 retry、timeout、cancel、truncation 或 provider error。
- 新 summary 递归检查 reasoning、reasoning_details、reasoning_content、encrypted_content、thoughtSignature 字段命中 0；当前任务无 summary_reasoning、hidden_reasoning 或压缩 overlap。
- 针对性回归测试：2 个测试文件，132 passed、7 skipped；首次失败仅因测试路径多带 `src/`，纠正路径后通过。
- 质量结论：本次速度快来自约一分钟内完成的有效高比例摘要，不是空响应、截断或降级；当前压缩质量置信度 `0.96`，仍保留多 provider 长期观察这一残余边界。
