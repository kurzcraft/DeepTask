# DeepTask Provider 错误、上下文 0 与终端完成通知修复进度

## 检查清单

- [x] 新建并维护 provider 错误与上下文 0 专项进度
- [x] 对照原版 KiloCode provider/context/token 相关实现
- [x] 定位当前上下文显示为 0 的数据链路
- [x] 定位 provider error 的真实来源与错误传播链路
- [x] 设计保留 DeepTask 改进功能的最小回归方案
- [x] 实施修复
- [x] 补充或更新回归测试
- [x] 运行 provider/context 聚焦测试
- [x] 处理终端完成通知接入与回归验证
- [x] 打包安装验证
- [x] 发布更新
- [x] 存储经验并汇报

## 用户反馈

- 仍出现 provider 错误。
- 上下文显示为 0。
- 期望直接按原版 KiloCode 恢复正确行为，同时保留 DeepTask 已改进功能。
- 继续解决集成终端限制数量不稳定、上下文压缩推理泄漏与提供商错误问题。

## 修复原则

- 先对照原版 KiloCode 行为，再决定回归范围。
- 不用隐藏错误替代修复；provider 错误必须定位到真实请求参数、模型信息、token 统计或错误传播源头。
- 保留 DeepTask 改进功能：终端稳定、完成后继续任务、命令反馈、发布配置等不做无差别回滚。
- 对共享核心代码的改动保留 kilocode_change 标记。

## 当前发现

- 任务开始已查询 universe-memory：未命中 provider error + context 0 同类记忆。
- 上下文显示为 0 的主要风险链路在 token usage 聚合与压缩 UI 事件：错误压缩不应伪装成成功 condense_context。
- Provider error 的高风险来源是把普通 streaming reasoning 文本持久化进 API conversation history；OpenAI-compatible 等 provider 重新回放时不一定接受 Anthropic 风格 reasoning block。
- 上游 KiloCode main 已重组目录，不能直接无脑覆盖当前文件；采用原版语义方向的最小修复。
- 终端注册表已经有幂等完成通知入口，且 `Terminal.runCommand()` 的返回 promise 已通过 `finally` 接入该入口。
- `BaseTerminal.shellExecutionComplete()` 会设置 `hasCompletedCommand=true`、`busy=false`、`running=false`，因此可覆盖 shell end 剪枝路径漏掉但 shellExecutionComplete 已发生的场景。

## 已实施

- `Task.addToApiConversationHistory()` 只持久化 provider 可回放的 reasoning 数据：Anthropic signed thinking、OpenAI Native encrypted reasoning、provider-specific reasoning_details/thoughtSignature。
- 不再把普通 streaming reasoning 文本写成 generic `type: "reasoning"` content block。
- 自动上下文管理结果先处理 `error`，发送 `condense_context_error`，不再同时发成功 `condense_context` 或 `sliding_window_truncation` UI 事件。
- 补充自动压缩 provider error 回归测试。
- 更新 reasoning preservation 测试，验证普通 reasoning 不进入 API conversation content。
- 终端完成通知路径已有回归：模拟 `shellExecutionComplete()` 已发生但 shell end 剪枝未调用时，由 command promise 完成触发注册表剪枝。

## 验证记录

- 通过：`cd src && pnpm test core/task/__tests__/Task.spec.ts core/task/__tests__/reasoning-preservation.test.ts`
  - 2 个测试文件通过。
  - 49 个测试通过，4 个跳过。
- 通过：`cd src && pnpm test integrations/terminal/__tests__/TerminalRegistry.spec.ts integrations/terminal/__tests__/TerminalProcess.spec.ts`
  - 2 个测试文件通过。
  - 32 个测试通过。
- 打包通过：`bash scripts_package_deeptask_vsix.sh`
  - 生成并验证 `deeptask-5.5.0.vsix`。
  - VSIX size: 42,398,432 bytes。
- 安装通过：`codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force`
  - 扩展列表确认：`deeptask.deeptask@5.5.0`。
- 发布通过：`node scripts_publish_github_release.mjs`
  - Release: `https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`
  - Asset: `https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`
  - Asset size: 42,398,432 bytes。

## 测试迭代记录

- 初次 provider/context 测试失败原因：新增用例的 fake API 没有 `createMessage()`。
- 第二次测试失败原因：generator 第一次 `next()` 产出 stream chunk，测试错误期待 `done=true`。
- 第三次测试失败原因：未显式 mock summary error，实际走成功 `condense_context` 路径。
- 第四次测试失败原因：错误路径不改写 history，测试中不应断言 overwrite。
- 调整后聚焦测试通过。

## 经验存储

- 已写入宇宙记忆：`/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-06-Deeptask-provider上下文0与终端完成通知修复.md`。
