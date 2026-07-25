# Deeptask 任务结束后发送消息不回复 / 不扩展任务修复

## Checklist

- [x] 定位软完成后“转圈即停 / 反馈像没接收”的根因
- [x] 实现 soft boundary 持久化、loop generation、continuation 串行化
- [x] 拒绝 summary-only todo 扩展
- [x] 补充回归测试与 changeset
- [x] 定向测试验证（12 passed / 66 skipped）
- [x] 打包安装 VSCodium 并覆盖发布 release
- [x] 更新进度文件与 universe-memory

## 用户问题（本轮）

1. 任务结束后发消息仍可能转一下圈就停，无回复
2. Deeptask 本目录较少，其他目录更易复现
3. 完成后继续发消息时，模型常复述旧结果，或添加无意义总结任务项
4. 多次完成后续发不稳定：有时像模型没收到反馈

## 根因

### A. Soft completion 边界在 break 后过早失效

`endCurrentLoopAfterActiveCompletion` 在 loop break 时被清掉，但 `initiateTaskLoop` 的 `finally` 还没执行。  
此窗口内 `isStreaming` 仍可能为真，后续消息可能被误判/竞态。

### B. 旧 loop finally 可清掉新 loop 的 active 状态

`isTaskLoopActive = false` 无 generation 保护。旧 loop finally 可能在新 continuation 启动后把它清掉，造成“转圈一下就停”。

### C. 连续续发可能并发 setup

post-completion 多次发送时，setup 阶段可能重叠，共享消息状态竞态，表现为概率性无回复/未接收。

### D. 无意义总结 todo 会放开扩展门闩

`markProgressListExpandedForContinuation` 只要有未完成项就放行，即使内容是“总结之前完成的任务”。  
模型随后可继续复述旧结果，而不是做新工作。

## 修复

1. `softCompletionBoundaryPending`：soft completion 直到旧 loop finally 才清除
2. `taskLoopGeneration`：旧 finally 不能清新 loop 的 `isTaskLoopActive`
3. `continuationChain`：串行化 continuation setup；loop 本身 fire-and-forget 保持可中断
4. `hasActionableProgressListForContinuation`：拒绝 summary/recap 类 todo 放行门闩
5. `UpdateTodoListTool`：门闩期间提交无意义总结项时返回错误并保持门闩

## 验证

```bash
cd src && pnpm test core/task/__tests__/Task.spec.ts -t "progress-list expansion|soft-completion|serializes post-completion|does not cancel a command|parks a mid-stream|waits for a visible soft-completion|clears stale todos|clears partially completed|rejects active continuation|does not treat todo updates|strips trailing text-only|strips soft-completion"
```

Result: 12 passed | 66 skipped

测试修复点：
- `Queued message processing after condense` 补 `TelemetryService.createInstance`
- `p-wait-for` mock 改为真正轮询 condition，避免 soft-completion wait 立即 resolve

## 发布结果

- Commit: `a35063ac`
- Message: `fix(task): 修复完成后续发无回复与总结todo放行`
- Local VSIX: `deeptask-5.5.0.vsix` / `bin/deeptask-5.5.0.vsix`
- Size: `42412413`
- SHA-256: `80405ad714079f9840727c87f447deb9488d1eefed27ac932263f04adecb48e3`
- VSCodium: `codium --install-extension deeptask-5.5.0.vsix --force`
- Installed markers:
  - `softCompletionBoundaryPending=5`
  - `taskLoopGeneration=3`
  - `continuationChain=3`
  - `hasActionableProgressListForContinuation=3`
- Release: https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0
- Asset: https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix
- Asset size: `42412413` (local == remote)

## Files

- [`src/core/task/Task.ts`](src/core/task/Task.ts)
- [`src/core/tools/UpdateTodoListTool.ts`](src/core/tools/UpdateTodoListTool.ts)
- [`src/core/task/__tests__/Task.spec.ts`](src/core/task/__tests__/Task.spec.ts)
- [`.changeset/fix-post-completion-feedback-race.md`](.changeset/fix-post-completion-feedback-race.md)
- [`DEEPTASK_RELEASE_5.5.0_NOTES.md`](DEEPTASK_RELEASE_5.5.0_NOTES.md)

## 记忆

- `/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-13-Deeptask完成后续发无回复与总结todo修复.md`
- `/home/kurz/Obsidian/宇宙/记忆/错误记忆/2026-07-13-Deeptask旧loop-finally清新loop与总结todo放行.md`

## Entropy

任务前：完成后续发仍可能转圈即停，且 summary-only todo 可放行门闩。
任务后：soft boundary / generation / serialization / actionable expansion 已落地，并通过测试、安装与 v5.5.0 覆盖发布。净熵下降。

## 2026-07-20 跨目录复发审计

### 用户复现

1. 在 Deeptask 当前源码目录之外的其他工作区运行任务。
2. 任务到达结束/绿色软完成边界。
3. 此时继续发送一条消息。
4. UI 短暂进入推理或发送状态，随后停止推理并永久卡住，没有有效回复。

### 本轮验收条件

- [x] 检索 universe-memory 与既有完成态续发、取消和工作区恢复边界。
- [x] 审计历史任务 `workspace`、运行时 `cwd`、provider 当前工作区与 continuation 重建的关系。
- [x] 构造非仓库根目录 `cwd` 下的完成态续发回归，先证明失败再修复。
- [x] 新用户指令进入 continuation，并启动恰好一个 task loop。
- [x] 续发沿用原任务 `/home/kurz/D/paper` 工作区，不隐式切回扩展开发仓库。
- [x] 保持旧式 `ask:completion_result`、同目录续发、edited resend 和 live ask/terminal 路由不回归。
- [x] 聚焦测试、类型检查、打包安装及真实 VSCodium 验收通过。
- [x] 提交推送并覆盖、鉴权验证 GitHub Release `v5.5.0`。
- [x] 存储可证伪的 universe-memory 原理与错误模式。

### 运行时证据

只读扫描 VSCodium 的 `deeptask.deeptask/tasks` 和 `state.vscdb` 后确认：

1. 卡住样本已持久化 `say:user_feedback`，因此消息并未在前端或路由入口丢失。
2. 后续已出现 `say:api_req_started`，部分请求为 `tokensIn: 0`、usage missing、超时或空响应。
3. 跨目录样本的关键尾部均为 `say:completion_result -> say:user_feedback -> say:api_req_started -> ask:resume_task`。
4. 当前运行的 VSCodium extension host 启动时间晚于 VSIX 安装时间，排除当前进程仍加载旧 bundle。

诊断脚本：`scripts_diagnose_cross_workspace_completion.py`。

### 根因与假说修正

- **已证实（0.98）**：Deeptask 现代软完成持久化为 `say:completion_result`，但
  `Task.resumeTaskFromHistory()` 仅将旧式 `ask:completion_result` 识别为完成任务，导致历史恢复后
  错误进入 `resume_task`，而不是 `resume_completed_task`。
- 假说 A（全局 workspace 覆盖任务 cwd）被否证：Task 构造和恢复均保留历史 `workspacePath`，
  回归测试也确认 `task.cwd === "/home/kurz/D/paper"`。
- 假说 B（跨目录 I/O 放大旧 loop 竞态）缺少支持：完成消息和 API 请求都已持久化，且故障边界稳定
  落在错误的 `resume_task` 分类。
- 假说 C（消息发送到错误 provider）被否证：真实历史中用户反馈和请求启动均进入同一任务记录。

### 修复与红绿验证

`Task.resumeTaskFromHistory()` 现在统一识别两种持久化完成形态：

- `ask:completion_result`（旧式）
- `say:completion_result`（Deeptask 软完成）

新增跨目录回归先稳定失败：期望 `resume_completed_task`，实际收到 `resume_task`。应用最小修复后：

```text
Test Files  1 passed (1)
Tests       1 passed | 89 skipped (90)
```

回归同时验证外部工作区未改变、新指令进入 continuation、ask 和 task loop 均恰好调用一次。

### 最终验证与发布

- 聚焦测试：`7 passed | 83 skipped`。
- 类型检查：`cd src && pnpm check-types` 通过。
- 差异检查：`git diff --check` 通过。
- 诊断脚本：`python3 -m py_compile scripts_diagnose_cross_workspace_completion.py` 通过。
- Commit：`4898210c`，已推送至 `origin/main`。
- VSIX：`deeptask-5.5.0.vsix` 与 `bin/deeptask-5.5.0.vsix` 哈希一致。
- 大小：`42415955` bytes。
- SHA-256：`49a58e020dcf1513fab9829ecf77b9fdc266e6ceabe8ffc7a5ae27397667a392`。
- VSCodium：已强制安装 `deeptask.deeptask@5.5.0`。
- 安装 bundle 已验证包含：
  `ask:completion_result || say:completion_result -> resume_completed_task`。
- Release：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- Release asset ID：`483053916`，状态 `uploaded`。
- 鉴权下载：远端大小与 SHA-256 均与本地一致。
- 运行时边界：同版本覆盖安装后，所有已打开的 VSCodium 窗口必须重载，新的 extension host 才会执行新 bundle。

### Entropy

任务前：已知其他目录更易出现“绿色完成后续发短暂推理即停”，但不确定是 cwd、provider、竞态还是消息丢失。
任务后：真实任务历史证明消息与 API 请求均已进入后端，定位并修复两种持久化完成形态在历史恢复分类上的不一致；源码、测试、安装 bundle 和远端资产形成闭环。净熵下降。

### Universe Memory

- `/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-20-Deeptask跨目录软完成历史恢复分类修复.md`
- 原理：同一持久化生命周期语义的所有历史编码形态，必须在每个恢复与路由边界使用一致的兼容集合。
- 置信度：`0.98`；证伪条件已在记忆中记录。
