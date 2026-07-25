# DeepTask 与原版 Kilo Code 上下文压缩机制对比审计

## 检查清单

- [x] 建立原版 Kilo 压缩机制对比审计进度文件
- [x] 定位 Deeptask 当前压缩相关实现与测试
- [x] 定位原版 Kilo Code 对应实现来源
- [x] 对比自动压缩、手动压缩、fallback、错误传播差异
- [x] 判断差异是 Deeptask 定制还是回归 bug
- [x] 修复确认的压缩错误并补测试
- [x] 运行压缩测试、lint、type
- [x] 打包安装到 VSCodium 并存储经验

## 用户要求

继续检查上下文压缩错误，与原版 Kilo Code 压缩机制对比差异。

## 初始认知状态

- 已知：上一轮已修复 Deeptask 中一个隐藏错误：fallback 未实际降低上下文时不应隐藏 summarization/provider error。
- 相信：仍可能存在 Deeptask 定制压缩逻辑与原版 Kilo Code 不一致导致的错误，尤其在自动压缩、手动压缩、reasoning block、provider profile、fallback 错误传播路径。
- 不确定：当前仓库是否保留原版 Kilo Code 的 Git 历史或 upstream remote；需要用本地 Git 与源码定位确认。

## 对比维度

1. `manageContext()` 自动压缩阈值、profile threshold、fallback 策略。
2. `summarizeConversation()` 手动/自动摘要提示词、消息选择、错误返回协议。
3. `Task.condenseContext()` 手动压缩 UI 状态、历史覆盖、错误传播。
4. `Task.attemptApiRequest()` 自动压缩前置逻辑、spinner/事件、fallback 成功判定。
5. `truncateConversation()` 滑窗机制和 truncated-message 过滤。
6. reasoning/tool-use 内容在压缩后的保留规则。
7. 与原版 Kilo Code 的差异是否有 `kilocode_change` 标记或 DeepTask 特定需求支撑。

## 当前发现

- 本地 upstream remote 存在：`kilo-upstream/main`。当前 DeepTask 与 upstream 没有共同 merge-base，不能用三点 diff，只能用源码语义对比。
- 原版 Kilo Code 当前上下文压缩已迁移到 session/backend 机制，核心位置在 `packages/opencode/src/session/overflow.ts`、`packages/opencode/src/session/compaction.ts`、`packages/opencode/src/session/prompt.ts`；VSCode 侧通过 `packages/kilo-vscode/src/KiloProvider.ts` 调用 `client.session.summarize()`。
- 原版 Kilo 的关键行为不变量：上下文窗口溢出必须进入 compaction/reduction 恢复路径，并且有 per-turn/retry cap；不能退化为普通 API retry 循环。
- DeepTask 当前架构仍是本地 `Task` + `manageContext()`：`src/core/context-management/index.ts`、`src/core/condense/index.ts`、`src/core/task/Task.ts`。不能机械移植 upstream backend compaction，但应对齐行为不变量。
- 发现实际 bug：`Task.handleContextWindowExceededError()` 已存在，但普通 provider 首包阶段的 context-window exceeded 错误没有调用它；`Task.attemptApiRequest()` 只在 KiloCode provider 特例分支里计算过 context-window 检测，结果未用于普通 provider 恢复。这会导致溢出走 `api_req_failed` 普通重试，而不是先压缩/截断再 retry。

## 已完成修复

- 在 `src/core/task/Task.ts` 的首包 catch 分支增加 context-window exceeded 早期处理：
  - 命中 `checkContextWindowExceededError(error)` 后调用 `handleContextWindowExceededError()`。
  - 使用既有 `MAX_CONTEXT_WINDOW_RETRIES = 3` 限制恢复次数，避免无限循环。
  - 恢复后用原 options 递归重试 `attemptApiRequest(retryAttempt + 1, options)`。
  - 超过上限时抛出明确错误，提示新建任务或手动减少上下文。
- 移除 KiloCode provider 分支内未使用的重复 context-window 检测，并让该分支 retry 时保留 options。
- 在 `src/core/task/__tests__/Task.spec.ts` 增加回归测试：
  - 普通 provider 首包 context overflow 时先压缩上下文再 retry，且不弹 `api_req_failed`。
  - provider 持续 overflow 时在 3 次恢复后停止并抛出明确错误。
- 增加 `.changeset/fix-context-overflow-recovery.md`。

## 验证记录

- `cd src && pnpm test core/task/__tests__/Task.spec.ts core/context-management/__tests__/context-management.spec.ts core/condense/__tests__/index.spec.ts core/condense/__tests__/condense.spec.ts`
  - 结果：4 个测试文件通过，135 passed，7 skipped。
- `pnpm lint`
  - 结果：通过。
- `pnpm check-types`
  - 结果：通过。

## 待完成

- 运行 `bash scripts_package_deeptask_vsix.sh`。
- 安装 `deeptask-5.5.0.vsix` 到 VSCodium 并确认版本。
- 将本次对比审计经验写入 universe memory。
