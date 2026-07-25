# DeepTask 命令自动执行与终端保留限制修复进度

## 检查清单

- [x] 查询 universe-memory 相关记忆
- [x] 定位终端保留限制跨目录启动不生效的状态同步路径
- [x] 定位多行 bash -lc 单引号命令不自动执行的审批匹配路径
- [x] 定位命令标题显示为 Kilocode 的品牌残留路径
- [x] 定位压缩上下文取消后前文与任务标题偶发不显示的问题
- [x] 实现最小修复并补测试
- [x] 运行相关测试
- [ ] 更新记忆

## 当前发现

- 前端默认状态已有 `terminalCompletedTerminalLimitEnabled=true` 与 `terminalCompletedTerminalLimit=3`。
- `ClineProvider.getState()` 对这两个值有 fallback，但 `TerminalRegistry` 的静态运行时状态此前主要在 `resolveWebviewView()` 和设置保存时同步，解释了“打开其他目录后要按保存才生效”。
- `parseCommand()` 已保护引号内换行，但 `parseCommandLine()` 在保护双引号前先扫描 `$()`，且没有先保护单引号。因此 `bash -lc '...'` 单引号脚本体里的 `$(date ...)`、管道、分号等会被误当作顶层子命令，导致 `getCommandDecision()` 在 wildcard 下仍可能走手动按钮。
- 集成终端标题硬编码为 `Kilo Code`，需要改为 `Deeptask`，同时保留旧标题作为 legacy 清理识别。
- 手动压缩上下文时前端先设置 `isCondensing/sendingDisabled`，但后端 `condenseTaskContext()` 失败/取消时此前可能不发送 `condenseTaskContextResponse`，导致前端临时压缩行和禁用状态不清理，表现为前文/任务标题区域偶发不显示或不恢复。

## 已实现

- `src/shared/parse-command.ts`：先保护单引号字符串，再扫描替换 `$()`/变量/分隔符，避免解析单引号脚本体。
- `src/core/webview/ClineProvider.ts`：`getState()` 同步终端保留限制到 `TerminalRegistry`；`condenseTaskContext()` 用 `try/catch/finally` 保证失败时刷新状态并发送完成响应。
- `src/integrations/terminal/Terminal.ts`：新终端标题改为 `Deeptask`，并导出旧标题常量。
- `src/integrations/terminal/TerminalRegistry.ts`：legacy 清理同时识别 `Deeptask` 与 `Kilo Code`。
- 补充解析、自动审批、终端标题、Provider 状态同步和压缩失败响应测试。

## 待验证

- 本次目标回归已验证。完整 `core/webview/__tests__/ClineProvider.spec.ts` 仍存在 14 个失败，集中在既有编辑消息测试的 webview dispose mock 生命周期，以及少量局部 `providerSettingsManager` mock 与默认 profile 激活路径不完全兼容；这些不属于本次四个修复点的直接覆盖面。

## 验证状态

- 通过：`cd src && pnpm test shared/__tests__/parse-command.spec.ts core/auto-approval/__tests__/commands.spec.ts integrations/terminal/__tests__/TerminalRegistry.spec.ts`，结果 3 个文件、40 个测试通过。
- 通过：`cd src && pnpm test core/webview/__tests__/ClineProvider.spec.ts -t "syncs completed terminal retention defaults|condenseTaskContext clears frontend condensing state"`，结果 2 个新增回归通过。
- 未全量通过：`cd src && pnpm test core/webview/__tests__/ClineProvider.spec.ts`，结果 14 个失败、77 个通过、12 个跳过；主要为既有编辑消息测试块和局部测试替身问题。
