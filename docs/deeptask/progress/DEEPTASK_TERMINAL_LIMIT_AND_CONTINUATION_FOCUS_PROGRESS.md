# Deeptask 终端硬限制与压缩后拓展任务聚焦修复

## 目标

1. 集成终端完成态数量在命令结束、事件缺失、重复完成、窗口快照延迟等情况下都稳定受设置约束。
2. 上下文压缩后，最新用户拓展任务保持最高优先级，不被旧总结、旧完成态或旧清单覆盖。
3. 任务验收必须基于实际工作和可验证证据；拓展任务应直接进入新工作边界并保持连续交互。
4. 完成定向测试、打包安装 VSCodium，并发布 GitHub Release。

## Checklist

- [x] 查询 universe-memory 与历史进度文件
- [x] 审计当前工作树，确认存在需要保留的未提交命令反馈修复
- [x] 定位终端超限与压缩后失焦的剩余竞态
- [x] 实现终端硬限制修复
- [x] 实现最新拓展任务焦点锚点与验收状态机修复
- [x] 增补回归测试与 changeset
- [x] 运行定向测试与格式验证
- [x] 打包、安装与发布验证
- [x] 提交推送、安装 VSCodium、发布 GitHub Release
- [x] 写入 universe-memory

## 当前发现

- 终端裁剪已覆盖 shell-end 和 command promise settle，但完成通知可重复触发；VS Code 的 `exitStatus` 更新与 `dispose()` 存在时间窗，已移除终端可能被第二次完成通知重新加入 registry。
- 当前 legacy 窗口终端按标题直接视为“已完成”，无法可靠区分运行态；硬限制必须坚持不关闭运行中终端，不能靠标题猜测活动状态。
- 用户续发已通过 host-managed feedback todo 建立新工作边界，但压缩摘要本身没有独立、结构化的“最新用户任务焦点”锚点；压缩后仍可能由旧总结主导模型注意力。
- 当前 `attempt_completion` 以“任意实际工具运行过”作为续发验收门槛，证据强度不足；需要让交付提示明确报告最新任务、验证证据和未完成项，并确保 host-managed feedback todo 只在真实工作后完成。

## 验收标准

- 完成终端数超过 N 后，最终只保留最新 N 个；运行中、busy、未执行命令的终端绝不被裁剪。
- 重复完成通知、延迟 close 事件、反向窗口顺序不会重复 dispose 或把已裁剪终端重新注册。
- 压缩前后最新用户拓展指令均以明确焦点锚点进入模型上下文，旧 completion/summary 不得覆盖它。
- 未执行实际工作时拒绝完成；完成结果需面向最新用户指令给出实际改动、验证与剩余风险。
- 所有相关回归测试通过，VSIX 安装版本可验证，GitHub Release 资产可下载。

## 工作树保护

本轮开始时已有未提交修改：

- `DEEPTASK_TASK_END_SEND_STUCK_PROGRESS.md`
- `src/core/tools/ExecuteCommandTool.ts`
- `src/core/tools/__tests__/executeCommandTool.spec.ts`
- `webview-ui/src/components/chat/ChatView.tsx`
- `webview-ui/src/components/chat/__tests__/ChatView.spec.tsx`
- `.changeset/fix-command-finished-feedback-output.md`

这些修改视为用户现有工作，不回退、不覆盖；最终与本轮修复一起验证。

## 实现记录

- `TerminalRegistry` 增加 dispose tombstone，在 `exitStatus` 延迟更新窗口内阻止重复完成通知复活或再次关闭已裁剪终端。
- close 事件统一从 registry 移除 wrapper，避免关闭后残留。
- 完成候选收集前过滤 tombstone，保证完成态数量约束成为稳定不变量。
- `Task` 保存精确的 `latestUserContinuationFocus`，在手动、自动和强制上下文重写提交时追加结构化焦点锚点。
- 续发提示强化验收要求：最终交付必须面向最新指令，区分实际完成、验证证据和剩余风险。
- 新增终端重复完成通知回归测试、压缩后焦点保留及锚点去重测试。

## 验证记录

- `src`: `pnpm test integrations/terminal/__tests__/TerminalRegistry.spec.ts`：19 passed。
- `src`: `pnpm test core/task/__tests__/Task.spec.ts`：92 passed，4 skipped。
- `src`: 五个相关测试文件联合运行：169 passed，4 skipped。
- `webview-ui`: 直接运行 `vitest` 的 `ChatView.spec.tsx`：18 passed，12 skipped。
- 已知项目脚本问题：`webview-ui` 的 `pnpm test` pretest 仍引用不存在的 `kilo-code#bundle`；改用同目录 `pnpm exec vitest run` 验证通过，不属于本轮代码回归。
- `git diff --check` 与相关文件 Prettier 检查通过。

## 发布记录

- commit：`cbc3cb7d`（已推送 `origin/main`）。
- VSIX：`deeptask-5.5.0.vsix`，42,418,084 bytes，内容校验通过。
- VSCodium：已强制安装并确认 `deeptask.deeptask@5.5.0`。
- GitHub Release：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- Release 资产：`https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`。
- universe-memory：`宇宙/记忆/项目记忆/2026-07-24-Deeptask终端硬限制与压缩后拓展任务焦点锚定.md`。
