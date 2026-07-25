# DeepTask 自动命令卡住与上下文压缩供应商错误修复进度

## 检查清单

- [x] 查询 universe-memory 与既有进度文件
- [x] 定位自动命令批执行、运行按钮、强制继续、按钮消失相关路径
- [x] 定位 Python 长段命令卡住的终端/前端状态交界
- [x] 定位上下文压缩 API 供应商错误来源与回退路径
- [x] 实现最小修复并补回归测试
- [x] 运行相关测试、lint/type 检查
- [x] 打包 VSIX 并安装到 VSCodium
- [x] 存储本轮经验到宇宙记忆

## 用户反馈

- 自动命令批执行存在准时命令运行卡住。
- 包括：不执行卡在显示运行按钮、执行完卡在强制继续、按按钮时按钮消失或卡死。
- 尤其是执行 Python 长段命令。
- 上下文压缩出现 API 供应商错误，需要恢复为以前一样正常压缩。

## 已读取背景

- `DEEPTASK_COMMAND_AUTO_EXECUTE_AND_TERMINAL_LIMIT_PROGRESS.md`：曾修复 `bash -lc '...'` 单引号脚本体被 parse-command 误拆，和压缩失败后前端状态不清理。
- `DEEPTASK_RUN_BUTTON_STUCK_PROGRESS.md`：曾修复 `fallback` 被前端视为 active command 导致后续输入走 terminalOperation。
- `DEEPTASK_PYTHON_HEREDOC_COMMAND_STUCK_PROGRESS.md`：曾修复 Python heredoc 完成通知/剪枝，以及 OpenAI 兼容 provider 不应发送 `max_completion_tokens: -1`。
- `DEEPTASK_CONTEXT_COMPRESSION_PROVIDER_REASONING_PROGRESS.md`：曾修复手动/自动压缩 provider 错误传播和 reasoning 泄漏。
- `DEEPTASK_CONTEXT_COMPRESSION_TIMEOUT_PROGRESS.md`：曾修复压缩超时结构化 error、自动回退和 stale ask 响应绑定 askTs。

## 初始假设

- 自动命令卡住可能不是单一终端完成问题，而是自动批准匹配、webview active command 集合、pending askTs、terminalOperation continue/abort 和 ExecuteCommandTool 兜底之间的状态不同步。
- Python 长段命令若不是 heredoc，而是超长 inline command 或批量命令，可能触发命令解析/自动批准、终端 stream start 缺失、或 shellIntegration completion 事件顺序问题。
- 上下文压缩供应商错误可能来自自动压缩仍把 fallback 前的 provider error 带到上层，或压缩配置选择到了错误 provider/profile。

## 已确认根因

- `src/core/tools/ExecuteCommandTool.ts` 中 `waitForCommandOutputResponse()` 的 250ms 自动继续依赖 `hasPendingWebviewAskResponse()` 返回 true。`Task.ask()` 只有在 ask 进入 blocking 状态后才设置 pending ask timestamp，因此快速命令、空输出命令、长段 heredoc/Python 命令结束事件贴近输出事件时，自动继续定时器可能早于 pending 状态可见，导致命令输出 ask/强制继续状态停住。
- `src/core/context-management/index.ts` 中自动压缩 summarization 失败后，即使 sliding-window fallback 已成功生成可用上下文，返回值仍携带 summarization/provider error。上层因此仍可显示 API 供应商错误，违背“自动压缩失败就正常 fallback”的既有设计。

## 已实现修复

- `src/core/tools/ExecuteCommandTool.ts`：自动继续定时器不再等待 pending ask 可见，直接发送 `yesButtonClicked` 并调用 `process.continue()`。完成后的 pending ask 清理仍保留，用于处理真实残留状态。
- `src/core/tools/__tests__/executeCommandTool.spec.ts`：补充/调整回归测试，覆盖 pending 状态一直不可见时仍能自动继续命令输出 ask。
- `src/core/context-management/index.ts`：自动压缩 summarization 失败但 sliding-window fallback 成功时，返回 `error: undefined`，避免把已处理的 provider 错误冒泡到 UI。
- `src/core/context-management/__tests__/context-management.spec.ts`：更新两条 fallback 测试，验证 summarization 返回错误或抛错时，只要 fallback 成功就不返回 error。
- `.changeset/fix-auto-command-and-condense-provider.md`：新增 patch changeset。

## 验证记录

- 失败一次：聚焦测试最初失败在测试断言，原因是完成清理路径仍会轮询 `hasPendingWebviewAskResponse()`；实现行为正确，测试断言过窄。
- 已通过：`cd /media/kurz/aleber/vscode/deeptask/src && pnpm test core/context-management/__tests__/context-management.spec.ts core/tools/__tests__/executeCommandTool.spec.ts integrations/terminal/__tests__/TerminalProcess.spec.ts core/task/__tests__/Task.terminal-operation.spec.ts`
- 结果：4 个测试文件通过，73 个测试通过。
- 已通过：`pnpm lint`
- 已通过：`pnpm check-types`
- 已通过：`bash scripts_package_deeptask_vsix.sh`
  - 输出：`deeptask-5.5.0.vsix`
  - 校验大小：`42398342` bytes
- 已通过：`codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force && codium --list-extensions --show-versions | rg '^deeptask\.deeptask@'`
  - 输出：`deeptask.deeptask@5.5.0`

## 阻塞

- 暂无。
