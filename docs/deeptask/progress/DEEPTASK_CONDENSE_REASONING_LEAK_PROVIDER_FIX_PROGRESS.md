# DeepTask 压缩 reasoning 泄漏与 provider 错误修复进度

## 当前检查清单

- [x] 定位压缩输入、摘要输出和普通 provider 请求的完整 reasoning 数据路径
- [x] 为压缩输入、摘要输出和 provider 请求增加回归测试
- [x] 修复所有会把隐藏推理或 provider 专用 reasoning 错送到压缩/普通请求的路径
- [x] 运行定向测试、类型检查并检查依赖清单
- [x] 更新 universe-memory，打包安装 VSCodium 并覆盖发布修复版本

## 根因

上一轮只修复了摘要结果和后续普通请求历史，但遗漏了压缩请求入口：
`summarizeConversation()` 仍将原始 `sourceMessages` 映射为 `requestMessages`，其中 assistant 的 plain `reasoning` block、standalone reasoning item 和 `reasoning_details` 都可能被送入压缩 provider。这样即使最终 summary 不含 reasoning，泄漏已经发生在压缩请求本身。

## 修复

- 新增 `sanitizeMessagesForCondensing()`，在构造压缩请求前删除 standalone reasoning、assistant content 中的 plain reasoning，以及 `reasoning_details`、`reasoning_content`、`encrypted_content`、`thoughtSignature`、`reasoning` 字段。
- 保留普通请求的 provider-native reasoning 策略；压缩输入使用更严格的独立边界。
- 保留 summary 输出只含可见 summary text 和必要的 native `tool_use` 配对。
- 新增 provider 入参回归测试，覆盖 plain、metadata、interleaved、encrypted 和 thought signature 泄漏。

## 验证

- 压缩测试：2 个文件通过，59 项通过，3 项跳过。
- 扩展定向测试：4 个文件通过，143 项通过，7 项跳过。
- `pnpm check-types`：22 个任务通过。
- `pnpm lint`：18 个任务通过；仅有 TypeScript 5.9.3 不在 `@typescript-eslint` 官方支持范围内的既有警告。
- 根目录及三层子目录没有 `requirements.txt`，本轮未重装 Python 依赖，无需更新依赖清单。
- VSIX 已重新打包，大小 42,412,994 bytes，SHA-256：`77eae27946be9d6f94c5ecd4dd5aade7371fa72b271b5dd3520581ba80b8bf33`。
- VSCodium 强制安装成功，确认 `deeptask.deeptask@5.5.0`。
- GitHub Release 已覆盖发布：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- Release asset：`https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`。

## 已确认的边界

- 压缩模型只需要可总结的用户内容、assistant 可见文本和必要的 native tool 配对。
- 压缩请求不应携带隐藏 plain reasoning、provider-native reasoning metadata 或独立 encrypted reasoning item。
- 普通 provider 请求仍需按模型能力保留合法的 provider-native reasoning；压缩输入清洗不能复用普通请求的保留策略。

## 2026-07-19 深度复查

- [x] 审计压缩输入、压缩写回、effective history 与 provider 转换完整链路
- [x] 修复非 native 压缩路径重复读取已被 summary 覆盖的原始历史
- [x] 修复 legacy summary 在普通请求中重放 reasoning block / reasoning_details
- [x] 新增旧 summary 隐藏推理与 legacy summary 请求清洗回归测试
- [x] 定向链路测试：6 文件，210 通过，7 跳过
- [x] 完成类型检查、lint、打包安装与覆盖发布

### 新根因

1. `summarizeConversation()` 过去仅在 native-tools 分支调用 `getEffectiveApiHistory()`；非 native 路径会把已经由 summary 替换、但因非破坏性压缩仍保存在磁盘中的旧消息再次发送给压缩 provider。
2. `buildCleanConversationHistory()` 会把旧版本生成的 summary 当普通 assistant 回合处理。在 `preserveReasoning=true` 或存在 `reasoning_details` 时，legacy summary 的隐藏推理可能在压缩后的下一次普通请求中被重新注入。
3. 因而“summary 输出没有 reasoning”并不足够；必须同时保证压缩输入使用 effective history，并在最终 provider 请求边界把 `isSummary` 强制降级为可见内容与必要 tool-use 结构。

### 修复边界

- 所有压缩协议统一从 effective API history 开始。
- `isSummary` 请求构建不继承任何 reasoning 元数据；数组内容删除 `reasoning` block。
- 原始、非 summary 的 provider 回合仍保留既有 reasoning 兼容行为，避免破坏 DeepSeek/Z.ai/OpenRouter 的原生工具协议。

### 深度复查交付证据

- `pnpm check-types`：22 个任务通过。
- `pnpm lint`：18 个任务通过；仅保留仓库既有 TypeScript 版本范围警告。
- VSIX 大小：42,413,185 bytes。
- SHA-256：`2bebdc8218abcb7505cc6093c6b2867f85fb324a8535f3755686e4717010bd98`。
- VSCodium 强制安装成功：`deeptask.deeptask@5.5.0`。
- GitHub Release 已覆盖：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- Release asset：`https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`。
- 远端资产大小与本地 VSIX 一致：42,413,185 bytes。

## 2026-07-19 历次经验统一复盘与第五边界审计（完成）

### 新检查清单

- [x] 汇总压缩请求输入、摘要写回、普通 provider 出口和异步提交四类历史修复
- [x] 用失败测试确认 effective+sanitized 请求视图会覆盖完整非破坏性存储
- [x] 建立二次压缩后逐层删除 summary 的 rewind 恢复测试
- [x] 分离 provider 请求视图与持久化写回视图
- [x] 覆盖无时间戳消息，消除对象引用和时间戳唯一性假设
- [x] 运行压缩矩阵测试、类型检查、lint 与 bundle
- [x] 修订 universe-memory 中“完整修复”的过高置信度结论
- [x] 构建、安装并核验最终 VSIX

### 新发现：第五边界是存储可逆性

当前 `summarizeConversation()` 先把完整 `messages` 转成 `getEffectiveApiHistory(messages)`，再清洗为
`sourceMessages`，最后却直接以该请求视图构造 `newMessages`。这会产生两个风险：

1. 第二次压缩可能永久丢弃被旧 summary 隐藏的原始消息，删除新 summary 后无法 rewind 恢复；
2. 为 provider 删除 reasoning 的清洗副本可能被当成存储真值写回，破坏“隐藏但可恢复”的非破坏性语义。

统一原则：上下文压缩至少有五个独立正确性边界，任何一个测试通过都不能代表其余边界：

1. **请求输入边界**：effective history + hidden/provider reasoning 清洗；
2. **摘要生成边界**：只写可见 summary text 与必要 tool pairing；
3. **普通 provider 出口边界**：legacy `isSummary` 不重放 reasoning metadata；
4. **事务提交边界**：单飞 + revision 校验，拒绝 stale rewrite；
5. **持久化可逆边界**：请求视图只用于调用 provider，写回必须保留完整原始存储及 rewind 信息。

### 红灯、修复与证伪结果

- 红灯测试稳定复现：第二次压缩后，第一轮隐藏原始消息在 `result.messages` 中变为
  `undefined`；旧实现确实把 provider 请求投影视图当成了持久化真值。
- 第一版修复按对象引用或 `ts` 映射消息，单文件测试通过，但完整矩阵中的无时间戳用例失败：
  effective history 为 8 条而不是预期 5 条。该结果证伪了“引用或时间戳足以映射”的假设。
- 最终修复在清洗前用函数局部 `Symbol` 附加 canonical storage index；清洗副本继承索引，provider
  请求不会序列化 Symbol，持久化写回只按原始数组索引添加 `condenseParent` 和插入 summary。
- 二次压缩测试逐层删除第二轮、第一轮 summary：先恢复第一轮 summary，再恢复含原始 reasoning 的
  完整历史；同一 reasoning 从未进入压缩 provider 请求。

### 验证证据

- 定向 Vitest：5 个文件通过，195 passed，7 skipped。
- 仓库类型检查：22/22 tasks successful。
- 仓库 lint：18/18 tasks successful；仅有既有 TypeScript 5.9.3 支持范围警告。
- `git diff --check` 通过。
- 测试前置 bundle 与最终 production bundle 均成功。
- 最终 VSIX：`deeptask-5.5.0.vsix`，42,414,884 bytes。
- 最终 SHA-256：`09454b386ea18ccb506269cf0b523e8de4e871d22e1951b59968f3545c21de47`。
- 已强制安装为 `deeptask.deeptask@5.5.0`；安装 bundle 大小 27,568,728 bytes。
- 安装 bundle 已核验 `condenseStorageIndex`、`contextManagementInFlight`、
  `apiConversationHistoryRevision`、`reasoning_details` 和 `condenseParent` 标记。
- 证伪标准已满足：二次压缩后删除第二个 summary 可恢复第一轮 summary；继续删除第一轮 summary
  可恢复第一轮隐藏的原始消息。

## 2026-07-19 用户复测后根因级再审计（进行中）

### 新检查清单

- [x] 检索项目记忆和否证库，恢复既有压缩修复边界
- [x] 审计当前源码、provider 转换、真实任务日志与运行时安装版本
- [x] 用并发延迟回归测试稳定复现过期压缩提交窗口
- [x] 修复自动/强制压缩单飞、历史 revision 校验、手动过期提交与混合工具结果清洗
- [x] 运行定向测试、类型检查、lint 和 bundle 构建验证
- [x] 构建并安装新 VSIX，核验安装 bundle
- [x] 存储 universe-memory 并完成交付

### 已确认根因

- 真实任务的 `context_condense_debug.jsonl` 显示同一 `instanceId` 在前一次压缩返回前再次进入
  `context_management_start`，随后多个结果乱序返回。
- 上下文压缩本质是基于历史快照的异步重写事务；旧实现没有单飞锁和提交前 revision 校验，
  因而旧摘要可能覆盖压缩期间追加的新消息。
- 旧版 native tool 清洗还存在块粒度缺口：同一 user turn 同时含有效和孤立 `tool_result` 时，
  只要发现一个有效结果就会保留整个消息，使孤立结果继续进入严格 provider。

### 修复决策

- 自动压缩与 context-window 强制恢复共享单个 in-flight `manageContext` Promise。
- 每次持久化 API 历史变更推进单调 revision；只有历史引用与 revision 均未变化时才允许提交压缩结果。
- 等待旧 in-flight 结果的后来调用、以及压缩期间历史已变化的原调用，都停止当前 API attempt，
  不得继续用未压缩或过期历史请求普通 provider。
- 手动压缩保留“不自动回退截断”的原语义，但同样使用历史引用 + revision 快照拒绝过期提交。
- 强制压缩通过 `finally` 无条件发送完成通知，避免异常或过期丢弃后 spinner 残留。
- 混合 `tool_result` user turn 按 block 过滤：保留匹配结果与普通用户文本，删除孤立结果。

### 验证证据

- 定向 Vitest：4 个文件通过，169 passed，7 skipped。
- 仓库类型检查：22/22 tasks successful。
- 仓库 lint：18/18 tasks successful；仅有既有 TypeScript 5.9.3 支持范围警告。
- `git diff --check` 通过。
- 新 changeset：`.changeset/fix-stale-context-compression-rewrites.md`。
- VSIX：`deeptask-5.5.0.vsix`，42,414,287 bytes。
- VSIX SHA-256：`0b18ffc46f643d631c22751368c329e7d909cc3bea6208ef36a9dcc2a7ab59c7`。
- 已强制安装为 `deeptask.deeptask@5.5.0`；安装 bundle 大小 27,567,807 bytes。
- 已安装 bundle 包含 `contextManagementInFlight`、`apiConversationHistoryRevision`、
  `reusedInFlight`、`stale_discarded` 和 orphan-tool-result 清洗标记。
- 当前运行中的扩展宿主必须通过 VSCodium Reload Window/重启后才会从磁盘加载新 bundle；不终止工作
  目录外的扩展宿主进程。
- 测试过程中曾出现一次假失败：异步测试未清理跨测试 mock 调用记录，导致 `waitFor` 在本次摘要
  真正开始前提前返回；清理 mock 后回归稳定通过，该问题不是产品事务保护失效。

## 2026-07-19 21:27 上下文压缩紧急复审与重复压缩风暴修复（进行中）

### 当前检查清单

- [x] 查询 universe-memory 项目记忆、否证库与五边界可证伪条件
- [x] 审计当前源码、工作区 diff、最终 VSIX、安装 bundle 和运行中宿主版本
- [x] 重跑请求输入、摘要生成、普通 provider 出口、事务提交、持久化可逆五边界矩阵
- [x] 复现成功压缩结果因 active append 被丢弃导致的重复压缩风暴
- [x] 为不可变快照、append-only rebase、非追加拒绝与日志语义建立红灯测试
- [x] 实施最小修复，允许安全提交活跃任务中的压缩结果
- [x] 完成定向测试、类型检查、lint 和 diff 检查
- [-] 构建并核验 VSIX/安装产物
- [ ] 更新 universe-memory 与最终审计结论

### 已确认的新运行时证据

1. 源 production bundle、VSIX bundle 和安装 bundle 字节一致；当前扩展宿主晚于最终安装启动，因此不是旧版本误加载。
2. 五边界回归矩阵通过：5 个文件、195 passed、7 skipped。
3. 真实日志中的双 start/双 result 使用相同 `instanceId` 和相同 `condenseId`，说明第二个调用复用了同一 in-flight Promise，而不是第二次 provider 压缩；但现有日志把 observer 也记为新 start/result，存在可观测性假阳性。
4. 同一真实任务在成功摘要将上下文降至约 3–5 万 token 后，后续自动检查仍使用压缩前约 18–21 万 token，并在数十秒内再次压缩，形成真实重复压缩风暴。

### 根因与修复

- `manageContextOnce()` 过去把任意 revision 变化都视为 stale。活跃 agent 在压缩 provider 返回前通常会追加工具/用户消息，所以原调用也得到 `canCommit=false`；日志虽然写出 `outcome=condensed`，但摘要实际从未写入 API 历史，`condense_context` UI 消息也未产生。
- 真实 UI 证据显示这些结果返回后约 5 秒仍发送 20 万级上下文；直到一次恰好没有并发 append 的压缩成功提交后，下一请求才立即降到约 4.2 万 token。
- 新实现先复制不可变 history snapshot 给 `manageContext()`，避免 live 数组在 provider 请求期间变长；返回后若 live history 仍是同一数组且 snapshot 前缀引用逐项不变，则把精确 append suffix 接到压缩结果后安全提交。
- rewind、替换、删除或前缀对象变化仍拒绝提交，不能把 append-only rebase 泛化为任意三方合并。
- 日志结果新增 `canCommit`、`reusedInFlight`，并把观察者标记为 `reused_in_flight`、真正过期结果标记为 `stale_discarded`，不再把两者伪装成第二次成功压缩。

### 新验证

- 红灯测试先确认旧实现对 append-only 变化返回 `canCommit=false`。
- 修复后单文件：81 passed、4 skipped。
- 五边界矩阵：5 文件，197 passed、7 skipped。
- `pnpm check-types`：22/22。
- `pnpm lint`：18/18，仅既有 TypeScript 版本范围警告。
- `git diff --check`：通过。

### 本轮重点证伪条件

1. 成功提交摘要后，下一轮阈值计算仍使用压缩前累计 token；
2. 同一 effective history 在没有足够新增上下文时再次产生新 `condenseId`；
3. observer 复用 in-flight Promise 却被日志误记为独立 provider operation；
4. 修复 token 基线时破坏 canonical storage、逐层 rewind 或 reasoning 隔离边界。

### 2026-07-19 最终交付结论

- [x] 修正 `scripts_install_verify_condense_vsix.sh` 的 production bundle 验证：移除会被压缩器改名的局部变量 marker，改用源 bundle/安装 bundle SHA-256 一致性和稳定行为字符串验证。
- [x] 最终安装核验通过：`deeptask.deeptask@5.5.0`；VSIX SHA-256：`1a04e24545552577b45d4877219e5a5f18559c9e798368b87a9ed2093a8c6cb2`。
- [x] 安装 bundle SHA-256：`477b8931c4cb235fe4227519805a74473bccc4942ab6f6cccb6bb7bbfcf13210`，大小 27,569,268 bytes；脚本确认源/安装 bundle 完全一致。
- [x] 安装 bundle 保留稳定修复标记：`condenseStorageIndex`、`contextManagementInFlight`、`apiConversationHistoryRevision`、`reused_in_flight`、`stale_discarded`、`reasoning_details`、`condenseParent`。
- [x] 本轮定向测试、类型检查、lint、diff 和 VSIX 安装核验均通过；未重新安装 Python 依赖，因此无需更新 `requirements.txt`。

#### 最终原理与剩余边界

上下文压缩是“基于快照的异步历史重写事务”，不是单纯的字符串摘要：provider 返回成功只有在结果通过提交校验、写入 canonical history 并产生新的 token 基线后，才算压缩成功。revision 变化本身不能证明结果过期；必须区分 append-only 追加与 rewind/替换/删除。前者可按未变前缀精确 rebase，后者必须拒绝 stale rewrite。

剩余可证伪边界：新安装 bundle 需要由 VSCodium Reload Window/重启后加载，再通过真实长会话观察 `condense_context`、`canCommit=true` 和后续 `tokensIn` 下降；本轮未终止工作目录外的扩展宿主，也不把静态测试冒充生产长会话证明。
