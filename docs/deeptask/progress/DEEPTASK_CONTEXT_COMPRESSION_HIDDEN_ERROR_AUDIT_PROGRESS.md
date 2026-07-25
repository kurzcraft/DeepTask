# DeepTask 上下文压缩隐藏错误检查进度

## 检查清单

- [x] 建立检查范围与进度文件
- [x] 检索/读取既有压缩相关进度与记忆
- [x] 审查自动压缩 `manageContext()` fallback/error 语义
- [x] 审查手动 `condenseContext()` 错误传播与状态清理
- [x] 审查 provider/profile/reasoning/token 相关隐藏错误
- [x] 补必要测试或修复
- [-] 运行压缩相关测试与 lint/type
- [ ] 必要时重新打包安装并存储经验

## 用户反馈

- 要求检查上下文压缩有没有遗漏隐藏错误。

## 当前假设

- 已修复“自动 summarization 失败但 fallback 成功仍冒泡 provider error”，但可能仍存在其他错误路径：
  - fallback 本身失败时是否被正确暴露；
  - fallback 成功但 cost/tokens/summary/truncationId/messagesRemoved 是否一致；
  - 手动压缩失败时是否会错误污染历史或留下等待状态；
  - provider/profile 选择是否仍可能使用错误模型或错误 reasoning 参数；
  - 压缩超时/abort/stale response 是否仍可能隐藏或误绑定；
  - UI 是否可能隐藏压缩错误但任务状态未恢复。

## 已读取背景

- `DEEPTASK_CONTEXT_COMPRESSION_PROVIDER_REASONING_PROGRESS.md`：手动压缩应只做摘要，provider 错误应显示 `condense_context_error`，自动压缩 fallback 成功时不冒泡 provider 错误。
- `DEEPTASK_CONTEXT_COMPRESSION_TIMEOUT_PROGRESS.md`：压缩流式异常应转结构化 error，自动压缩可 fallback；旧按钮响应用 askTs 绑定。
- `DEEPTASK_PROVIDER_CONTEXT_ZERO_ORIGINAL_FIX_PROGRESS.md`：不能用隐藏错误替代修复；错误压缩不应伪装成成功 `condense_context`。
- universe-memory 搜索 `Deeptask 上下文压缩 隐藏错误 provider fallback condense summarize manageContext` 未命中。

## 发现

- 发现一个真实隐藏错误：`manageContext()` 在摘要失败后进入 sliding-window fallback 时，无条件把 `error` 清空，只要进入 fallback 分支就可能发出 `sliding_window_truncation`。
- 反例由测试暴露：只有两条历史消息时，`truncateConversation()` 返回 `messagesRemoved: 0`，没有实际减少上下文，但调用侧仍可能把 provider 错误隐藏为成功滑窗事件。
- 进一步风险：`Task.attemptApiRequest()` 和强制截断路径在收到 `truncateResult` 后先 `overwriteApiConversationHistory()`，再判断 `error`。如果 `manageContext()` 返回“带 error 的修改结果”，历史会被错误结果污染。

## 已修复

- `src/core/context-management/index.ts`
  - 新增 `fallbackReducedContext` 判定：只有 `messagesRemoved > 0` 且 `newContextTokensAfterTruncation < prevContextTokens`，才视为 fallback 已处理摘要错误并清除 `error`。
  - 如果 fallback 未实际减少上下文，则保留原 summarization/provider error，避免伪装成成功压缩。
- `src/core/task/Task.ts`
  - 常规自动上下文管理路径：只有 `!truncateResult.error` 时才覆盖 API 历史。
  - 强制上下文截断路径：同样只有无 error 时才覆盖历史；有 error 时优先发送 `condense_context_error`。
- `src/core/context-management/__tests__/context-management.spec.ts`
  - 新增测试：当摘要失败且 fallback 没有移除消息时，必须保留 provider error。
- `.changeset/fix-condense-hidden-fallback-errors.md`
  - 新增 patch changeset。

## 验证

- 首次压缩测试失败，暴露隐藏错误：`reports automatic condense provider errors before fallback UI events` 期望 provider error，但实际收到 `sliding_window_truncation` 且 `messagesRemoved: 0`。
- 修复后压缩相关测试通过：
  - `cd /media/kurz/aleber/vscode/deeptask/src && pnpm test core/context-management/__tests__/context-management.spec.ts core/condense/__tests__/index.spec.ts core/condense/__tests__/condense.spec.ts core/task/__tests__/Task.spec.ts`
  - 结果：4 个测试文件通过，133 passed，7 skipped。

## 待验证

- [x] `pnpm lint`
- [x] `pnpm check-types`
- [x] 打包 VSIX 并安装到 VSCodium

## 最终验证

- `pnpm lint`：通过。仅出现项目既有 TypeScript 5.9.3 超出 `@typescript-eslint/typescript-estree` 官方支持范围的警告。
- `pnpm check-types`：通过。
- `bash scripts_package_deeptask_vsix.sh`：通过，生成并校验 `deeptask-5.5.0.vsix`，大小 42398426 bytes。
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force`：安装成功。
- `codium --list-extensions --show-versions | rg '^deeptask\\.deeptask@'`：确认 `deeptask.deeptask@5.5.0`。

## 结论

- 任务前：不确定是否还有被隐藏的压缩错误。
- 任务后：确认存在一个“fallback 未降维却隐藏 provider error”的真实缺陷，并已修复。
- 熵变化：从泛化怀疑收敛到可复现条件：`messagesRemoved === 0` 或 `newContextTokensAfterTruncation >= prevContextTokens` 时不能清除 summarization error。
