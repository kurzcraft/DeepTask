# Deeptask Windows VS Code / VSCodium 卡死彻底修复进度

## 目标

- 定位 Deeptask 在 Windows 上发送消息或执行任务卡死、而 Linux 正常的首个确定性根因。
- 修复共享扩展运行时，使 VS Code 与 VSCodium 在 Windows 上行为一致且 fail-soft。
- 清除 shell、路径、进程信号、终端完成检测、命令包装和持久化中的隐含 POSIX 假设。
- 添加 Windows 平台聚焦测试，并完成源码级、构建产物级和可执行环境级验证。

## 当前观测

- 用户确认：Linux 上 VS Code 与 VSCodium 均正常；Windows 上两者均卡死。
- 2026-07-26 实机复现进一步确认：发送不需要终端的普通消息后立即永久转圈、聊天区无模型文字且无报错；点击取消才显示 `task file not found`。
- 该证据否证“根因位于终端执行层”的过早判断：故障发生在任何终端命令之前。
- 代码确认 `ClineProvider.createTask()` 通过构造器启动 Task；`Task` 构造器 fire-and-forget 调用异步 `startTask()`，没有 `await` 或顶层 `catch`。启动早期持久化、系统提示或 API 初始化任一步拒绝，Provider 仍把半初始化 Task 留在栈中并返回成功，UI 因而永久 busy；取消随后读取尚未落盘的任务文件，暴露派生错误。
- 另有已确认确定性矛盾：系统提示词通过 `getShell()` 按 VS Code 默认 profile 生成 PowerShell/CMD 命令，
  但旧 Execa 的 `shell: true` 在 Windows 固定使用 `cmd.exe`；该问题仍需保留修复，但不是当前普通消息卡死的首个根因。
- 产品默认、状态返回与命令工具后备值曾不一致；状态未 hydrate 时会从 VS Code terminal 瞬时切到 Execa。
- Windows 取消路径依赖 POSIX `SIGKILL` 和全系统 `ps-list`，缺少有界 Windows 进程树终止契约。
- Universal VSIX 内没有 Linux `.node` 或 Linux 可执行文件，已否证“Linux 原生依赖误发”主因。

## 里程碑

- [x] 查询 universe-memory 与否证库；未发现直接匹配记录
- [x] 审计 Windows 平台分支、shell/路径/信号和终端生命周期实现
- [x] 从现有测试、官方源码与文档定位 Windows shell/取消回归点
- [x] 构造可在 Linux CI 上运行的 Windows 平台模拟回归测试
- [x] 实现跨平台修复与 fail-soft 超时/取消保护
- [x] 运行聚焦测试（49/49）、类型检查和 lint
- [x] 构建并审计 Windows 相关 Universal VSIX
- [x] 安装到本机 VSCodium 并确认解析为 `deeptask.deeptask@5.5.2`
- [ ] 在可用真实 Windows 主机执行 VS Code/VSCodium 双编辑器验收
- [x] 添加 changeset 并更新发布版本 `5.5.2`
- [ ] 提交、推送并同步市场/Release
- [ ] 系统性存储 universe-memory 与被否决假说

## 假说更新

- H1（0.10，已否证为首因）：提示词 shell 与 Execa 实际 shell 不一致确实存在，但普通消息在任何终端命令前已卡死，不能解释当前首个失败边界。
- H2（0.25，暂未支持）：本轮没有发现盘符、反斜杠或 UNC 是共同卡死的首个根因；保留真实 Windows 验收。
- H3（0.96，代码证据支持）：新任务启动 Promise 被构造器悬空；启动早期异常无法由 Provider 回滚和 Webview 错误边界消费，直接留下半初始化 Task 与永久 busy。
- H4（0.08，已基本否证）：Universal VSIX 不含 Linux 原生二进制，extension bundle 可成功构建。
- H5（0.30，待区分）：Windows 实机可能仍加载旧 bundle；当前源码取消路径已包含缺失持久化时静默清栈逻辑，而用户仍看到 `task file not found`。必须通过新 bundle marker 和实机日志区分旧运行时与其它取消入口。

## 已实现修复

- Execa 显式复用受控 `getShell()`，使提示词与执行器共享同一 shell 契约。
- Windows 启用 `windowsHide`，且不注入 POSIX `LANG/LC_ALL`；Unix 继续使用 UTF-8 locale。
- Windows 取消使用 5 秒有界的 `taskkill /PID <pid> /T /F`，不再扫描全系统进程或先杀根 PID。
- Unix 子进程枚举限制为 2 秒，取消清理不再无界等待。
- 启动失败、流迭代失败与取消均通过 `finally` 触发 completed/continue 并释放 busy。
- 所有未 hydrate 的后备默认统一为 VS Code terminal；只有用户明确禁用或 shell integration 失败才回退 Execa。

## 验证证据

- `ExecaTerminalProcess.spec.ts`：15/15，覆盖 PowerShell 透传、Windows 环境、隐藏控制台、taskkill、启动失败恢复。
- `executeCommand.spec.ts` + `executeCommandTool.spec.ts`：34/34，覆盖默认 VS Code provider 与显式 Execa 回退。
- TypeScript `tsc --noEmit`：通过。
- ESLint `--max-warnings=0`：通过。
- 持久化日志：`EXTRA/output/windows-terminal-compat-quality.log`。
- Universal VSIX：`deeptask-5.5.2.vsix`，42,423,413 字节，SHA-256
  `dd64a08f0fe0611585b77368ad2296ac1c4994a1c42f73d0ffd27d3fd9fd8fd6`。
- VSIX 内 manifest、Windows `taskkill` 路径、fail-soft 诊断、既有完成/配置/取消修复标记均通过审计。
- 本机 VSCodium `1.121.03429` 强制安装成功，CLI 清单确认 `deeptask.deeptask@5.5.2`。
- 真实 Windows VS Code/VSCodium 主机当前不可用，因此不把 Linux 模拟或 Linux VSCodium 安装冒充实机通过。
- 已知基线：完整 `ClineProvider.spec.ts` 有 16 个与本轮无关的陈旧 mock/编辑消息失败，不作为本修复回归证据。

## 证伪策略

- 卡死已确认发生在任何终端命令之前，因此 H1 已降低；当前优先修复任务创建事务和启动异常收口。
- 若 Windows 模拟测试能完整驱动终端完成状态，则降低 H1。
- 若所有平台命令都有显式 Windows 分支、超时和 finally 清理，则降低 H1-H3，转向原生依赖/IPC。
- 只有真实 Windows 双编辑器验收通过，才能宣称彻底修复；Linux 模拟测试不能替代最终验收。

## 验收标准

- Windows VS Code 与 VSCodium：首次发送、普通回复、终端命令、取消、续发、上下文压缩后拓展任务均不永久转圈。
- shell 缺失、命令启动失败、任务文件缺失、终端事件丢失时必须在有界时间内恢复输入并显示可操作错误。
- Windows 路径（盘符、空格、反斜杠、UNC）不被 POSIX 规则破坏。
- Linux 行为和既有测试不回归。
