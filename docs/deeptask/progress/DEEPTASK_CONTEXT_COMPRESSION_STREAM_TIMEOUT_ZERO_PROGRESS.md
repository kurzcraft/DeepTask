# DeepTask 上下文压缩 API stream timeout 与上下文 0 修复进度

## 用户反馈

- 上下文压缩过程中 API 流式传输失败。
- 错误信息：`API stream timed out after 60000ms while waiting for the next chunk; no model output was received.`
- 后续持续报错。
- 上下文偶尔显示 0。

## 当前假设

- 压缩 summarization provider stream timeout 后，错误可能被写入或绑定到当前 task 状态，导致后续请求持续沿用失败/污染后的历史。
- 如果压缩失败时仍更新 token/上下文窗口状态，UI 可能把失败压缩解释成成功压缩或把 unknown token 估算显示为 0。
- 需要重点检查：
  - `condenseContext()` 和 `manageContext()` 对 stream timeout 的结构化错误处理。
  - `Task.attemptApiRequest()` 是否在压缩失败后覆盖 `apiConversationHistory` 或发送成功 UI 事件。
  - 前端 token/context 显示是否把缺失、NaN、undefined 或 error 状态格式化为 0。
  - API stream timeout 是否应该在自动压缩中 fallback 到 sliding-window，而不是让当前轮和后续轮持续失败。

## 已读取历史记忆

- `2026-07-07-Deeptask上下文压缩隐藏错误审计修复.md`：fallback 必须实际降低上下文才可清除 provider error；有 error 时不能覆盖历史。
- `2026-07-07-Deeptask自动命令继续与压缩供应商错误修复.md`：自动压缩 summarization/provider 失败但 fallback 成功时，不应冒泡已处理错误。
- `2026-07-06-Deeptask-provider上下文0与终端完成通知修复.md`：压缩错误 UI 事件必须优先于成功事件，避免 UI/token 聚合显示异常或隐藏真实 provider 错误。

## 检查清单

- [x] 查询 universe-memory 与历史压缩进度
- [x] 定位压缩 API 流式超时的调用链与错误传播
- [x] 定位上下文偶尔显示 0 的 token/状态来源
- [x] 实现最小修复并补回归测试
- [x] 运行 focused tests、lint、type
- [x] 打包安装到 VSCodium
- [x] 存储本轮经验

## 发现

- `summarizeConversation()` 已能把压缩 API stream timeout 转成结构化 `{ error }`，自动压缩 fallback 正常情况下不会直接抛出。
- 仍有两个残留风险：
  - 自动压缩在 `condenseTaskContextStarted` 之后如果 token counting 或 `manageContext()` 其它步骤抛错，`condenseTaskContextResponse` 可能不发送，前端持续显示压缩中并引发后续状态异常。
  - 手动/自动压缩成功分支把 `newContextTokens` 默认成 `0`，如果压缩结果结构异常或缺少 token，会发出成功 `condense_context` 事件并把上下文显示推到 0。
- `consolidateTokenUsage()` 已跳过无 token 的 `api_req_started` placeholder，所以本轮上下文 0 更可能来自成功压缩/滑窗事件携带 0，而不是 API 请求占位消息。

## 已修复

- `src/core/task/Task.ts`
  - 手动压缩成功事件要求 `newContextTokens > 0`；否则发送 `condense_context_error`，不覆盖历史，不发成功 `condense_context`。
  - 自动压缩成功事件同样校验 `newContextTokens > 0`，避免上下文显示 0。
  - 自动 sliding-window 事件在缺少 `newContextTokensAfterTruncation` 时回退到 `prevContextTokens`，不再写入 0。
  - 自动压缩 `manageContext()` 包入 `try/finally`，只要已发送 `condenseTaskContextStarted`，就一定发送 `condenseTaskContextResponse` 清理前端压缩中状态。
- `src/core/task/__tests__/Task.spec.ts`
  - 新增手动压缩无效 token 结果不覆盖历史、不发成功压缩事件的回归测试。
  - 新增自动压缩中 token counting 抛错时仍发送 `condenseTaskContextResponse` 的回归测试。
- `.changeset/fix-condense-timeout-zero-state.md`
  - 新增 patch changeset。

## 验证

- `pnpm --dir src test core/task/__tests__/Task.spec.ts core/context-management/__tests__/context-management.spec.ts core/condense/__tests__/index.spec.ts core/condense/__tests__/condense.spec.ts`：通过，4 个测试文件，137 passed，7 skipped。
- `pnpm lint`：通过，18 个任务成功。
- `pnpm check-types`：通过，22 个任务成功。
- `bash scripts_package_deeptask_vsix.sh`：通过，生成并验证 `deeptask-5.5.0.vsix`，约 40.43 MB。
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force`：通过。
- `codium --list-extensions --show-versions | rg '^deeptask\\.deeptask@'`：确认 `deeptask.deeptask@5.5.0`。

## 后续

- 本轮经验已存入 `/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-08-Deeptask上下文压缩流超时与上下文0修复.md`。
- 如果用户继续反馈“持续报错”，优先检查是否还有其它 UI pending 状态没有在异常路径清理。
