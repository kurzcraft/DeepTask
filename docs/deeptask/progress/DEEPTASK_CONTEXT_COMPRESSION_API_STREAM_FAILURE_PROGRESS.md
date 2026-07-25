# DeepTask 上下文压缩 API 流式失败修复进度

## 用户反馈

上下文压缩时出现 API 流式传输失败：

```text
API请求失败
提供方终止了请求: API stream timed out after 60000ms while waiting for the next chunk; no model output was received.
```

## 初始假设

- 压缩请求仍使用流式 API，provider 在 60s 无 chunk 时抛出 timeout，压缩流程把 provider 错误暴露为普通任务错误。
- 之前修复可能只处理了失败后的 UI 状态清理和 context=0，未处理压缩请求本身的超时策略、fallback 或非流式重试。
- 需要区分主任务 API 调用与上下文压缩 API 调用：压缩失败不应污染主任务运行态，也应给出可恢复路径。

## 检查清单

- [x] 建立/恢复上下文压缩 API 流式失败进度文件
- [x] 检索既有上下文压缩修复记录与源码路径
- [x] 定位 API stream timed out 在压缩流程中的传播与 UI 表现
- [x] 实现非流式摘要修复并补回归测试
- [x] 初轮 focused tests、lint、type、打包安装、经验存储
- [x] 彻底审计压缩链路并增加压缩诊断日志文件
- [x] 补充日志与异常路径测试
- [x] 重新运行 focused tests、lint、type
- [x] 重新打包安装到 VSCodium 并更新经验
- [x] 检查并修复压缩失败后的上下文污染风险
- [x] 补充污染防护回归测试
- [x] 重新验证并安装

## 观察记录

- 既有修复已让 `summarizeConversation()` 捕获压缩流异常并返回结构化 `error`，`Task.condenseContext()` 会显示 `condense_context_error`。
- 60s 文案来自 `Task.createApiStreamTimeoutPromise()`，它服务主任务 `attemptApiRequest()` 的首块/下一块流式 idle timeout。
- `summarizeConversation()` 注释已说明摘要“不需要 stream”，但当前仍调用 `createMessage()` 并 `for await` 消费流。
- 因此压缩摘要阶段仍可能触发 provider 流式无 chunk 超时。修复方向：压缩摘要优先使用 provider 的 `completePrompt()` 非流式能力；没有该能力时才回退到 `createMessage()`。

## 修复记录

- `src/core/condense/index.ts`：压缩摘要优先使用 provider 的 `completePrompt()` 非流式能力；没有该能力时才回退到 `createMessage()` 流式路径。非流式和流式失败都返回结构化 `error`。
- `src/core/condense/__tests__/index.spec.ts`：新增非流式优先、非流式失败结构化返回的回归测试。
- `.changeset/fix-condense-non-streaming-summary.md`：新增 patch changeset。

## 二次反馈

- 用户再次反馈 UI 显示“API请求失败 / 提供方终止了请求: API stream timed out after 60000ms while waiting for the next chunk”。
- 这个文案来自主任务流式请求的 idle timeout 外壳，不足以单独证明压缩摘要仍在流式路径内失败。
- 继续修复方向：给压缩三条入口写入任务目录 JSONL 诊断日志，记录压缩是否开始、是否调用 summarize、是否 fallback 到 sliding window、token 前后变化、错误消息和最终 UI 分支。

## 二次修复记录

- `src/core/task/Task.ts`：新增非阻塞压缩诊断日志写入器，写入当前任务目录下的 `context_condense_debug.jsonl`。
- 日志覆盖：手动压缩 `manual_start/manual_result`，自动阈值压缩 `context_management_start/context_management_result`，上下文溢出强制恢复 `forced` trigger。
- 每条 JSONL 事件包含 taskId、instanceId、workspace、provider、model、trigger、outcome、token 变化、messagesBefore/messagesAfter、summaryLength、condenseId/truncationId、error 等关键字段。
- 日志写入失败只 `console.warn`，不阻断压缩、不改变 UI 错误展示。
- `src/core/task/__tests__/Task.spec.ts`：补充手动压缩错误写日志、日志写失败不阻断错误展示的回归测试。
- `.changeset/add-condense-debug-log.md`：新增 patch changeset。

## 二次验证记录

- `pnpm --dir src test core/task/__tests__/Task.spec.ts core/condense/__tests__/index.spec.ts core/context-management/__tests__/context-management.spec.ts`：通过，3 files passed，132 passed，7 skipped。
- `pnpm lint`：通过。
- `pnpm check-types`：通过。
- `bash scripts_package_deeptask_vsix.sh`：通过，生成并校验 `deeptask-5.5.0.vsix`，大小 42401435 bytes。
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force && codium --list-extensions --show-versions | rg '^deeptask\\.deeptask@'`：通过，安装确认 `deeptask.deeptask@5.5.0`。

## 三次反馈

- 用户反馈先出现“上下文压缩失败 / OpenAI completion error: 502 status code (no body)”，随后又出现“API 提供商错误”。
- 定位结果：自动压缩失败后，`manageContext()` 会尝试 sliding-window fallback；如果 fallback 减少了 token，结果会清空 `error`，随后主请求继续发送。
- 风险点：如果当前有效历史里存在未配对的 native `tool_use` / 孤立 `tool_result`，fallback 后主请求仍可能带污染历史继续请求 provider，表现为压缩失败后又出现主 API provider 错误。

## 三次修复记录

- `src/core/condense/index.ts`：新增 `sanitizeNativeToolHistory()`，移除没有紧邻匹配 `tool_result` 的 assistant `tool_use` 消息，以及没有前置匹配 `tool_use` 的孤立 user `tool_result` 消息。
- `src/core/condense/index.ts`：`summarizeConversation()` 在 native tool 协议下先基于 `getEffectiveApiHistory()` 和清洗后的历史压缩，避免已隐藏/已截断或污染消息重新进入 summary。
- `src/core/condense/index.ts`：`getEffectiveApiHistory(messages, useNativeTools)` 支持发送前清洗 native tool 历史。
- `src/core/task/Task.ts`：主请求构建 `cleanConversationHistory` 前传入 locked task protocol，对 native tools 任务使用清洗后的 effective history。
- `src/core/context-management/index.ts`：fallback sliding-window 成功时保留 `condenseError` 诊断字段，避免 502 压缩失败在日志中被伪装成完全成功。
- `src/core/task/Task.ts`：`context_condense_debug.jsonl` 记录 `condenseError`，便于区分“压缩成功”和“压缩失败后 fallback 成功”。
- `src/core/condense/__tests__/index.spec.ts`：补充未配对 `tool_use` 和孤立 `tool_result` 清洗测试。
- `src/core/context-management/__tests__/context-management.spec.ts`：补充压缩失败 fallback 后保留 `condenseError` 的断言。

## 三次验证记录

- `pnpm --dir src test core/condense/__tests__/index.spec.ts core/context-management/__tests__/context-management.spec.ts core/task/__tests__/Task.spec.ts`：通过，3 files passed，134 passed，7 skipped。
- `pnpm lint`：通过。
- `pnpm check-types`：通过。
- `bash scripts_package_deeptask_vsix.sh`：通过，生成并校验 `deeptask-5.5.0.vsix`，大小 42402157 bytes。
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force && codium --list-extensions --show-versions | rg '^deeptask\\.deeptask@'`：通过，安装确认 `deeptask.deeptask@5.5.0`。

## 验证记录

- `pnpm --dir src test core/condense/__tests__/index.spec.ts core/context-management/__tests__/context-management.spec.ts core/task/__tests__/Task.spec.ts`：通过，3 files passed，131 passed，7 skipped。
- `pnpm lint`：通过。
- `pnpm check-types`：通过。
- `bash scripts_package_deeptask_vsix.sh`：通过，生成并校验 `deeptask-5.5.0.vsix`，大小 42399790 bytes。
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force`：通过，安装确认 `deeptask.deeptask@5.5.0`。

## 四次反馈与最终修复

- 用户再次反馈仍出现 `API stream timed out after 60000ms while waiting for the next chunk`。
- 根因确认：自动压缩失败后，`manageContext()` 只有在 `prevContextTokens > allowedTokens` 时才进入 sliding-window fallback；仅达到自动压缩阈值但尚未超过 allowedTokens 时，错误会直接返回。`Task.attemptApiRequest()` 显示错误后仍继续构造并发送普通主任务请求，于是压缩错误后又出现第二个 provider error。
- `src/core/context-management/index.ts`：摘要失败时无条件尝试 sliding-window fallback，而不再受 `allowedTokens` 条件限制。
- `src/core/task/Task.ts`：自动/强制上下文恢复若最终仍返回错误，在发送 `condense_context_error` 后立即结束当前 API attempt，不再泄漏到普通 reasoning/provider 请求；压缩 spinner 仍由 `finally` 清理。
- `src/core/context-management/__tests__/context-management.spec.ts`：新增“达到压缩阈值但低于 allowedTokens，摘要失败仍回退截断”的回归测试。

## 四次验证记录

- 压缩/上下文管理/Task/手动压缩定向测试：4 files passed，162 passed，7 skipped。
- `pnpm check-types`：22 tasks successful。
- `pnpm lint`：18 tasks successful。
- `bash scripts_package_deeptask_vsix.sh`：通过，VSIX `deeptask-5.5.0.vsix`，42,412,651 bytes。
- `codium --install-extension deeptask-5.5.0.vsix --force`：通过，确认 `deeptask.deeptask@5.5.0`。
- SHA-256：`70f89ac2a50ea205a04076ae77c212e8b67663f02120d7a16688845956fbedf3`。

## 经验存储

- 已写入 `/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-19-Deeptask压缩API中断事务恢复修复.md`。
