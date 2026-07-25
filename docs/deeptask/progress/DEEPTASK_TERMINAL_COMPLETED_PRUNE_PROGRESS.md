# DeepTask 终端完成态剪枝修复进度

## 检查清单

- [x] 查询宇宙记忆
- [x] 定位终端完成态、剪枝与上下文压缩/provider 错误相关代码
- [x] 修改 `Terminal.runCommand()` 返回 promise 完成通知路径
- [x] 补充回归测试模拟 `shellExecutionComplete()` 已发生但 `markTerminalCompleted()` 未调用
- [x] 运行相关测试并记录结果
- [x] 存储本次修复经验

## 当前发现

- 宇宙记忆搜索未命中直接相关经验。
- 命令执行入口在 `src/core/tools/ExecuteCommandTool.ts`。
- VS Code 终端完成态与剪枝逻辑在 `src/integrations/terminal/TerminalRegistry.ts`，已有幂等公开入口 `notifyTerminalProcessCompleted()`。
- `src/integrations/terminal/Terminal.ts` 的 `runCommand()` 当前只在 `continue` 事件通知注册表；若 shell end 事件漏掉但返回 promise 已完成，剪枝不会被触发。

## 验证记录

- 首次运行 `pnpm test integrations/terminal/__tests__/TerminalRegistry.spec.ts` 失败：已剪掉的注册终端仍保留在 mock `vscode.window.terminals` 中，后续幂等通知会把它当作 legacy 终端重新计数，导致新终端被误剪。
- 已修复：剪掉 registered candidate 时同步加入 `disposedLegacyCompletedTerminals`，避免被 legacy 分支再次计数。
- 复测通过：`pnpm test integrations/terminal/__tests__/TerminalRegistry.spec.ts`，15 passed。

## 风险

- 需要避免重复刷新已有完成顺序，保持注册表完成通知入口幂等。
- 测试已覆盖 shell end 事件漏掉但 `runCommand()` 返回 promise 已完成的路径。
