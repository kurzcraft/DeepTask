# Deeptask 9.1.4 发布说明

## 多行/长命令"强制继续"卡死修复

对多行或引号跨行命令（如 `python3 -c "..."` 多行内联脚本），VS Code 可能：

1. 不触发 `onDidEndTerminalShellExecution` 结束事件；
2. 不发送 OSC 633;C 起始标记（或将其分裂到多个 chunk / 改用 ST 终止符）；
3. 永不关闭 `execution.read()` 输出流。

三层缺陷叠加导致 `commandOutputStarted` 永不置位、循环无出口、`exited` 状态永不发布，UI 永久停留在"强制继续"等待按钮。

### 修复内容

- **累计缓冲标记匹配**：C/D 标记在累计 preOutput/fullOutput 缓冲上匹配，跨 chunk 分裂安全，同时接受 BEL（`\x07`）与 ST（`\x1b\\`）终止符。
- **新鲜提示符回探**：命令回显之后出现新的 OSC 633;A/133;A 交互提示符，即视为命令已完成，直接收敛。
- **起始前 D 标记收口**：起始标记缺失但缓冲中已出现 D 标记时保留原始输出并完成。
- **终端关闭轮询**：100ms 轮询 `terminal.isClosed()`，对已被 GC 的终端引用做防御性解引用；到达任一完成边界立即停止，不再让完成的命令把终端标记为忙碌。
- **Shell 完成后 1 秒排空窗口**：结束后对流进行有界排空，防 late-output 丢失。

## 被吞的命令输出找回

- **纯回显流恢复**：无任何 OSC 标记、只携带命令回显行的流，剥离回显后判定为无内容，回读集成终端屏幕转录作为真实输出（屏幕转录含 `user@host:...$ grep ...` 形式的提示符与结果）。
- **框架内空流恢复**：C/D 标记正常但 `fullOutput` 为空（竞争流消费者吃掉数据）时，同样回读终端屏幕转录。
- **回显剥离增强**：无 OSC 提示符标记时按命令文本逐行剥离纯文本回显（支持多行命令）。

## 系统提示词强制脚本化

所有命令必须先写入 `EXTRA/bash/` 下的脚本文件，再以单行命令执行该脚本；脚本必须将完整 stdout/stderr tee 持久化到 `EXTRA/output/`，并打印日志文件路径与退出码。五处对齐：

- `src/core/prompts/tools/native-tools/execute_command.ts`（原生工具）
- `src/core/prompts/tools/execute-command.ts`（XML 工具）
- `src/core/prompts/sections/capabilities.ts`
- `src/core/prompts/sections/rules.ts`
- `src/core/prompts/system.ts`

## 并行对话模型串扰修复

为新并行对话选择模型时，若该对话的 Task 尚未创建（`getFocusedChatTask()` 返回 undefined 且 `focusedConversationId` 已设），不再回退到 `clineStack` 栈顶把旧后台对话的 API handler 一并切换。未来 Task 在构造时自行采用全局 profile。

## 集成终端实时输出 + 文件持久化

脚本在集成终端正常显示执行过程的同时，通过 `tee` 将完整 stdout/stderr 保存到 `EXTRA/output/<task>.log`，终端输出、工具回传与持久化日志三路一致。

## 测试

- `TerminalProcessMultilineStuck.spec.ts` 6/6 通过（新增 2 条吞输出恢复回归）
- terminal 全套 107 通过 / 23 平台跳过
- prompts 全套 83 通过 / 2 跳过
- `ClineProvider.model-crosstalk.spec.ts` 1/1、profile-focus-drift 3、focusTaskProfile 3
- task specs（grace-retry 11、flushPending 5、dispose 4、throttle 19）
- `pnpm check-types` 通过
