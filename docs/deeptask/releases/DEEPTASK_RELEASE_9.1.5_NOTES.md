# Deeptask 9.1.5 发布说明

## 并行对话提供商/模型记忆污染修复

在并行对话（多工作区/多 Tab 任务）场景下，当用户新建一个尚未创建 Task 的对话 B，并在其中手动切换提供商/模型（例如切到 Y）时，9.1.4 及之前的版本会把**栈顶旧对话 A** 的记忆一并污染：

1. [`persistStickyProviderProfileToCurrentTask`](src/core/webview/ClineProvider.ts) 中 `(pending ? undefined : focusedTask) ?? stackTopTask` 的 `??` 语义缺陷：pending 为真时第一项为 undefined，`??` 回退到栈顶，把 Y 写进旧对话 A 的 sticky 记忆（内存 `lastStickyApiConfigName` + `taskHistory` 持久化）。
2. 切回旧对话 A 时，`restoreFocusedTaskProviderProfile` 如实恢复被污染的 Y——用户看到 A"莫名其妙"变成了 Y。

9.1.4 只修复了 `updateTaskApiHandlerIfNeeded` 的同型缺陷（新对话选模型不再重建旧对话 handler），漏掉了 persistSticky / restore / activateProfile 三条路径。

### 修复内容

- **统一焦点感知解析器 `resolveStickyTaskTarget()`**：所有 sticky 持久化、profile 激活、焦点恢复路径统一使用：
  - `pendingNewConversation` 为真 → 解析为无目标（不污染任何对话）；
  - 焦点对话存在且映射到 live Task → 该 Task；
  - 焦点已设但无 live Task（新对话未创建）→ 无目标；
  - 仅 legacy 单任务流（无焦点管理参与）→ 回退栈顶。
- **taskAtEntry 快照同源**：`activateProviderProfile` 与 `restoreFocusedTaskProviderProfile` 的入口快照与 3 处漂移检测改用同一解析器，pending 期间切换 profile 不再误触旧对话的 API handler。

### 测试

- 新增 `ClineProvider.sticky-pollution.spec.ts` 4/4：pending 新对话中切换 provider 不写栈顶 Task 内存记忆、不写 taskHistory、不重建其 handler；正常焦点对话写入不受影响。
- `ClineProvider.model-crosstalk.spec.ts` 1/1、`focusTaskProfile` 3、`profile-focus-drift` 3（断言更新到新实现）、`Task.sticky-profile-race` 1 全过。
- `pnpm check-types` 通过。
- 已知预存失败（与本次修复无关，9.1.4 基线即失败，测试环境 cwd=/test 导致真实 ParallelManager `mkdir /test` EACCES）：`ClineProvider.sticky-profile.spec.ts` 3 条。
