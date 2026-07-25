# Deeptask 重新发送卡死与工具调用协议错误修复

## Checklist
- [x] 复现并定位编辑重发/重新发送时卡死与工具调用协议错误的状态组合
- [x] 新增重发历史截断、旧 loop/ask 清理和 native tool 配对回归测试
- [x] 修复重发路径的任务生命周期、历史清洗和错误反馈
- [x] 运行定向测试、类型检查与 lint，确认依赖清单
- [x] 更新 universe-memory，重新打包安装 VSCodium 并覆盖发布

## 根因与修复
- rewind 后的 API history 可能截断 assistant `tool_use` 与 user `tool_result` 的配对；`MessageManager` 现在调用 `sanitizeNativeToolHistory()` 删除孤立协议边界。
- 编辑重发前同时清空旧消息队列和 `clearStaleWebviewAskResponse()`，并清理 `idleAsk`、`resumableAsk`、`interactiveAsk`，避免新消息被旧 ask 消费。
- continuation loop 仍后台启动以保持中途消息可中断，但 rejection 不再静默：会写入错误消息并刷新 webview。
- 未无条件取消工具/命令等待，避免把正常终端等待再次变成永久卡死。

## 验证
- 定向 Vitest：4 个测试文件，156 项通过，4 项跳过。
- `pnpm check-types`：通过。
- `pnpm lint`：通过；仅有仓库既有 TypeScript 5.9.3 兼容范围警告。
- `requirements.txt`：三级目录内未发现；本次未重装 Python 依赖，无需更新。
- VSIX：[`deeptask-5.5.0.vsix`](deeptask-5.5.0.vsix)，42,413,108 bytes，打包校验通过。
- VSCodium：`deeptask.deeptask@5.5.0`，强制安装成功。
- GitHub Release：<https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0>，资产已覆盖上传。
- 历史验证脚本 `/tmp/deeptask_verify_vsix_install.py` 不存在；已改用 `codium --list-extensions --show-versions` 完成版本核验。

## 记忆
- 项目记忆：`/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-19-Deeptask重新发送工具协议与卡死修复.md`
- 否证记忆：`/home/kurz/Obsidian/宇宙/记忆/错误记忆/2026-07-19-Deeptask重发只清队列导致工具调用错误.md`

## 2026-07-19 双重重发复查

- [x] 复现第一次编辑重发卡住、第二次进入 mistake-limit 提示的状态序列
- [x] 将会改写历史的编辑重发与仍存活的旧 task loop 原子隔离
- [x] 覆盖连续两次重发、非 streaming 工具等待和取消重建的回归测试
- [x] 完成定向测试、类型检查、lint、打包安装和 Release 覆盖

### 根因与修复

普通追加消息仅在 HTTP streaming 时取消旧任务是合理的，但编辑重发会先 rewind 历史；即使旧 loop 正处于 `isStreaming=false` 的工具等待或首轮收尾阶段，它的上下文也已经失效。旧实现仍会在同一个 `Task` 上直接启动新 loop，导致两个 loop 共享 `assistantMessageContent`、`userMessageContentReady`、ask 状态和连续错误计数。

- rewind 持久化后若旧 task loop 仍活跃，编辑重发不再直接启动并发 loop；改为挂起 edited payload、取消旧实例并从干净历史重建。
- 连续第二次内联重发即使原 timestamp 已被第一次 rewind 删除，也不会被 stale-confirm 逻辑吞掉；取消期间会用最新 payload 覆盖挂起 continuation。
- 延迟到达的确认对话框回调仍保持幂等忽略，不会被误当成用户新重发。

### 验证与交付

- 定向测试：4 文件，160 通过，4 跳过。
- `pnpm check-types`：22 个任务通过。
- `pnpm lint`：18 个任务通过；仅有仓库既有 TypeScript 5.9.3 支持范围警告。
- VSIX：42,413,389 bytes；SHA-256：`927ea5a5adfa97600e94fc71932dad7a456fad0f0d0e3f396c6d214499b2faef`。
- VSCodium 强制安装成功：`deeptask.deeptask@5.5.0`。
- Release：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- Release asset：`https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`，远端大小与本地一致。

## 2026-07-19 真实 VSCodium 复查与 pending continuation 原子消费修复

- [x] 从 VSCodium globalStorage 任务历史提取用户最新失败时间序列
- [x] 确认行内“重新发送”入口为 `ChatRow.handleSaveEdit` → `submitEditedMessage`
- [x] 修复取消重建后 continuation 被 100ms 定时器过早消费的竞态
- [x] 增加 provider 级回归测试，确保重建返回前已启动最新 continuation
- [x] 完成 5 个测试文件、类型检查和 lint
- [x] 重新打包、安装到 VSCodium 并覆盖发布 v5.5.0
- [x] 将本轮真实运行证据写入 universe-memory

### 新证据与根因

VSCodium 持久化历史显示：最新用户操作发生在 `019f5512-cd5e-7646-97c6-2b864eb9bb6c`，重发反馈后出现过 `streaming_failed`（等待首 chunk 超时）以及“第一次卡住、第二次 generic problem”的连续反馈。日志目录不存在，但任务 UI/API 历史存在。

行内编辑保存明确发送 `submitEditedMessage`。旧实现中 `createTaskWithHistoryItem()` 在新 Task 已准备完成后先 `consumePendingCancelledTaskContinuation()`，再通过 `setTimeout(..., 100)` 启动 payload。第二次重发在此窗口内会覆盖 provider pending 槽，但旧定时器仍发送第一次 payload，新 payload 永远不消费，造成竞争 loop 和错误计数污染。

修复后在同一准备阶段直接 `await task.continueTaskFromUserMessage(...)`，使 payload 消费和启动原子化，消除旧定时器窗口。

### 本轮验证

- 定向/回归测试：5 个文件，166 passed，4 skipped。
- `pnpm check-types`：22 个任务成功。
- `pnpm lint`：18 个任务成功；仅有既有 TypeScript 5.9.3 支持范围警告。
- VSIX：42,413,375 bytes；SHA-256：`692d8fc4039c3546bd1024fa3c2aaa2fe8117c35112a1397ba28f607c2af0c21`。
- VSCodium：强制安装并确认 `deeptask.deeptask@5.5.0`；安装目录产物 marker 校验通过。
- Git：提交 `992f6eba` 已推送到 `main` / `origin/main`。
- Release：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- 认证资产校验：asset id `482247339`，状态 `uploaded`，远端 42,413,375 bytes，内容与本地逐字节一致。
- 仓库为私有时匿名 Release URL/API 返回 404；必须使用 Git 凭据做认证校验，不能据匿名 404 判定发布失败。
- 项目记忆：`/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-19-Deeptask重发取消重建pending原子消费修复.md`。
- 错误记忆：`/home/kurz/Obsidian/宇宙/记忆/错误记忆/2026-07-19-Deeptask重发定时消费pending导致旧新payload竞争.md`。

## 2026-07-19 安装后仍卡住的第三轮真实复查

- [x] 提取当前 VSCodium globalStorage 的最新 UI/API 尾部并确认没有新的用户重发样本
- [x] 核验实际安装 bundle 时间、大小和关键修复 marker
- [x] 判断当前证据是否进入 `submitEditedMessage`、取消重建和新 continuation
- [x] 以现有未覆盖分支建立并通过最小回归测试
- [x] 修复、验证并安装包含 `edited_resend` 的新 bundle
- [x] 修订此前过高置信度的项目/错误记忆
- [ ] 重载 VSCodium extension host 后完成一次真实编辑重发验收

### 本轮证据与边界

只读脚本 `scripts_capture_latest_resend_evidence.py` 找到的最新任务目录是本轮代理恢复流程（任务 ID `019f7ae4-42d4-72cf-a02e-03ae5ea1e855`），其 UI/API 记录没有新的用户编辑重发事件，不能冒充真实复测样本。安装目录 `/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0/dist/extension.js` 的时间为 `2026-07-19 22:17:34 +0800`、大小 `27,569,268` bytes，并包含 `edited_resend`、`Edited user message resubmitted after rewinding the conversation`、`contextManagementInFlight` 和 `stale_discarded` marker。

因此本轮已确认“磁盘安装版本包含修复”，但尚未证明“当前已运行 extension host 已加载修复”或“真实 UI 重发首轮不再先触发 `update_todo_list`”。这两个结论必须通过 Reload Window/重启后在真实会话执行一次编辑重发获得，不能由静态 bundle 或旧任务历史推断。

### 新反证

用户在安装并发布 SHA-256 为 `692d8fc4039c3546bd1024fa3c2aaa2fe8117c35112a1397ba28f607c2af0c21` 的 VSIX 后立即实测，反馈“还是卡，没有任何改变”。因此“pending continuation 的 100ms 定时器竞态是完整根因”已被否证；它至多是一个真实但非主导的竞态。当前剩余证据缺口是运行时重载与新交互样本，而不是继续静态猜测新的根因。
