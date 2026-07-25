# DeepTask Python heredoc 命令完成后卡住修复进度

## 检查清单

- [x] 查询命令执行完卡住相关记忆
- [x] 创建并维护本次命令卡住进度文件
- [x] 复现用户给出的 Python heredoc 诊断命令本身可正常退出
- [x] 记录并证伪 stale command_output 按钮响应作为唯一根因
- [x] 定位 shell 已完成但终端完成顺序未登记的剪枝路径
- [x] 实现终端完成通知/剪枝回归修复
- [x] 对齐 OpenAI 兼容 provider `max_completion_tokens` sentinel 错误处理
- [x] 补充并运行回归测试
- [x] 打包安装并发布 VSIX
- [x] 存储本次经验并汇报

## 用户现象

- 用户给出的 `python3 <<'PY' ... PY` 诊断命令执行完后任务卡住。
- UI 按钮停在运行按钮。
- 点击运行按钮后按钮消失，但任务仍卡死，没有继续。

## 初始判断

- 该命令是 heredoc 多行命令，内部访问 VSCode state sqlite、日志目录，并写入 Obsidian 任务记录。
- 命令本身应是有限命令，若终端已返回 shell 完成但任务未继续，重点检查 `ExecuteCommandTool`、`TerminalProcess`、webview `askResponse`/`terminalOperation`、以及 command_output ask 的完成路径。
- 记忆检索未命中完全相同问题，需要结合现有终端 shell 完成兜底和按钮响应逻辑继续定位。
- 已证伪的根因：`command_output` stale 按钮响应污染不是唯一根因。该修复仍可降低旧按钮副作用，但用户复测确认问题未解决。
- 当前根因方向：`Terminal.runCommand()` 返回 promise 完成时，注册表完成通知入口需要覆盖 `shellExecutionComplete()` 已经发生但 `markTerminalCompleted()` 没有执行或剪枝没触发的路径，且完成顺序登记必须幂等，不能重复刷新已有完成顺序。
- provider 错误方向：脱敏报告显示 OpenAI 兼容接口收到 `max_completion_tokens: -1` 后返回 500；这属于主请求 provider 错误，应走历史 `api_req_failed`/重试语义，压缩 fallback 不应把可恢复 provider 错误变成任务级卡死。

## 验证记录

- 代码阅读确认现有测试已覆盖 shell exit fallback，但最初尚未覆盖 command_output/按钮响应 ask 被清掉后没有继续的边界。
- `bash tmp_run_provider500_diagnosis.sh` 正常退出，生成 `/home/kurz/Obsidian/任务记录/vscode-deeptask-provider500-diagnosis-20260706-130635.txt`，确认用户命令本身有限完成。
- 新增 `src/core/task/__tests__/Task.terminal-operation.spec.ts` 覆盖 stale continue/abort 点击不写入 orphaned ask response，以及当前 `command_output` ask 仍正常传递反馈。
- 旧假设测试通过：`cd src && pnpm test core/task/__tests__/Task.terminal-operation.spec.ts core/tools/__tests__/executeCommandTool.spec.ts`，2 个测试文件通过，18 passed；但用户复测说明该路径不是完整根因。
- 最新脱敏报告 `/home/kurz/Obsidian/任务记录/vscode-deeptask-provider500-diagnosis-20260706-132029.txt` 显示 provider 500 为 `max_completion_tokens: -1`，并多次出现主请求 `attemptApiRequest()` 栈。
- 已修复 `TerminalRegistry.notifyTerminalProcessCompleted()` 的完成判定：终端只要已 `hasCompletedCommand`、非 busy、非 running、未关闭，即使 `process` 仍被保留，也会登记完成顺序并触发剪枝；复用阻断仍保留更严格的 `!process` 条件。
- 已补充终端回归：直接模拟 `shellExecutionComplete()` 已发生、但完成通知/剪枝曾漏掉且 `process` 仍在的路径，确认旧完成终端会被剪枝，新完成终端不会被误关。
- 已修复 OpenAI 兼容 provider：`includeMaxTokens` 开启时只发送正有限 `max_completion_tokens`，不再把 `maxTokens: -1` sentinel 发送给 Go/OpenAI 兼容代理。
- 聚焦回归通过：`cd /media/kurz/aleber/vscode/deeptask/src && pnpm test api/providers/__tests__/openai.spec.ts integrations/terminal/__tests__/TerminalRegistry.spec.ts core/tools/__tests__/executeCommandTool.spec.ts core/task/__tests__/Task.terminal-operation.spec.ts`，4 个测试文件通过，83 passed。

## 风险

- 用户命令包含本机 VSCode state 与日志读取，验证时需避免泄露密钥；仅使用脱敏报告或本地测试替代。

## 2026-07-20 多行 bundle 诊断命令完成后卡在“强制继续”

- [x] 用用户原始 `ps/stat/python3 <<'PY'` 复合命令恢复真实完成路径
- [x] 区分命令结果已展示、工具结果已返回、后续模型轮次已启动三个状态
- [x] 定位正常完成为何落入仅提供“强制继续”的恢复态
- [x] 最小修复自动继续链路，不改变 `edited_resend`、supersede、rewind 与单活动 loop 语义
- [x] 回归保证完成后的 `say:command_output` 不重新吞用户输入
- [x] 回归保证不是只清除按钮，而是模型收到工具结果并自动进入下一轮
- [x] 重新打包安装，并完成 bundle 静态复验

### 根因与修复

- 根因是 `onCompleted` 对最终 `task.say("command_output", ...)` 使用了未等待的异步写入；工具结果先返回并启动下一轮 API，迟到的命令输出消息随后成为最新 UI 消息，重新点亮“强制继续”。
- 现在以 `finalCommandOutputPersisted` 作为工具返回前的顺序屏障，确保最终命令输出先持久化，再把 tool result 交给模型。
- 该修复只改变命令输出消息与工具结果的时序，不改变发送队列、`edited_resend`、supersede、rewind 或单活动 loop 约束。

### 验证

- 聚焦测试：4 个测试文件，157 passed，4 skipped。
- `pnpm check-types`：22/22 successful。
- `git diff --check`：通过。
- VSIX：`deeptask-5.5.0.vsix`，42,415,512 bytes。
- SHA-256：`f89c5c5bd8b55206ecd144ab85fceccfbd837af80c426c4832f6bd605fa6193d`。
- VSCodium：`deeptask.deeptask@5.5.0` 已强制安装。

### 本轮命令特征与验收目标

- 前半段通过 `ps`、`rg`、`stat` 读取 VSCodium extension host 与已安装 bundle 状态。
- 后半段是 quoted Python heredoc，读取安装 bundle 并统计四个 marker。
- 命令是有限执行且 exit code 为 0；正常路径必须在退出后自动把完整输出作为 tool result 继续模型推理。
- “强制继续”只能保留为异常兜底，不应成为该命令每次完成后的必经交互。

## 2026-07-20 强制继续后仍无法读取终端输出

- [x] 定位 shell 完成事件先于 output stream 暴露时的输出丢失路径
- [x] 完成事件先到时仍读取该次 `TerminalShellExecution.read()` 的有限输出
- [x] 确认无法获取 stream 时才返回 output unknown，而不是提前丢弃可读内容
- [x] 回归验证模型获得真实输出，且手动“强制继续”不再只能空续跑
- [x] 保持既有发送、重发、单活动 loop、终端裁剪与 quoted heredoc 语义不变

### 根因、修复与验证

- `TerminalProcess.run()` 使用 `Promise.race(streamAvailable, shellExecutionComplete)`；旧实现只在下一事件循环读取 `TerminalShellExecution.read()`，完成事件可先胜出并直接返回 output unknown。
- 现在创建 execution 后立即尝试发布其可读 async stream，并保留下一事件循环重试；只有 `read()` 没有返回 async iterable 时才走 unknown 兜底。
- 后续“强制继续”不再需要凭空恢复从未采集到历史的输出，因为真实命令输出会进入 `completed`、`command_output` 与 tool result 链路。
- 聚焦测试：2 个文件，35 passed；其中覆盖 early completion 保留真实输出与无有效 stream 的 unknown 边界。
- `pnpm check-types`：22/22 successful；`git diff --check`：通过。
- VSIX：42,415,641 bytes，SHA-256：`129aad1b4ba5e95407b4dc30e2b6dfc6fdcce5956153bad7be5041f1bd286217`。
- VSCodium：`deeptask.deeptask@5.5.0` 已强制安装；安装 bundle 为 27,569,743 bytes，source map 含 `publishFallbackStream`。
- 提交 `a953dda2 fix(terminal): preserve output on early completion` 已推送至 `origin/main`。
- GitHub Release `v5.5.0` 已覆盖；鉴权下载校验确认资产状态 `uploaded`、远端大小 42,415,641 bytes，SHA-256 与本地一致。
- Release：<https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0>。

## 2026-07-20 CLIP-LIT 指标 smoke test 完成后再次卡住

- [x] 检查当前源码与实际 VSCodium extension host 是否加载终端流修复
- [x] 用 `chmod`、`py_compile`、`bash -n` 和 quoted Python heredoc 的同构命令构造事件顺序
- [x] 定位输出已显示为 `syntax and metric smoke tests passed` 但模型仍无法读取的剩余竞态
- [x] 补充精确回归，确保 shell 完成后真实输出进入 `completed`、`command_output` 与 tool result
- [x] 打包安装、运行时验收、提交发布并更新长期记忆

### 精确现象与验收条件

- 工作目录为 `/media/kurz/aleber/vscode/CLIP-LIT`，命令串联权限修改、三个 Python 文件编译、shell 语法检查以及 NumPy/PSNR/SSIM smoke test。
- 终端已经打印 `syntax and metric smoke tests passed` 并返回 shell prompt，证明命令有限完成且 exit code 应为 0。
- UI 仍停在“强制继续”；点击后模型读不到终端内容，说明可见终端输出与模型 tool result 历史仍可能分离。
- 验收不能只隐藏按钮：必须确认该输出被自动捕获并交给模型，且无需用户点击恢复按钮。
- 必须区分“已安装新 VSIX 但旧 extension host 尚未重载”和“新产物中仍存在第二个输出采集竞态”。

### 第二层根因与修复

- 已否决“旧 extension host 未重载”：安装时间为 02:14:46，相关 extension host 启动于 02:21:59 和 02:36:25，且安装 source map 已含第一层 `publishFallbackStream` 修复。
- 第一层修复在 `TerminalProcess.run()` 创建 execution 后立即调用 `read()`；全局 `onDidStartTerminalShellExecution` 随后又对同一个 execution 调用 `read()`。
- 真实 VS Code execution 的输出流可能是单消费者语义；两个 `read()` 结果会竞争或拆分输出，导致终端面板可见成功文本，但 Deeptask 消费的 stream 为空或不完整。
- 新增 `TerminalShellExecutionStream`，用 `WeakMap` 按 execution 身份缓存首个有效 async stream；立即读取路径与 start event 共享同一 stream，每个 execution 只创建一个 reader。
- 若第一次 `read()` 尚未返回有效 stream，不缓存失败结果，允许 start event 或下一事件循环重试。

### 验证与产物

- 聚焦测试：4 个文件，49 passed、1 skipped；包含同一 execution 单次 `read()` 断言和 `chmod + py_compile + bash -n + quoted Python heredoc` 同构 smoke test。
- `pnpm check-types`：22/22 successful；`git diff --check`：通过。
- VSIX：42,415,899 bytes，SHA-256：`759ec50a5a7eeb53107a2ba71abf50c6609f8a1995ca01f63675a5853f7f883d`。
- VSCodium：`deeptask.deeptask@5.5.0` 已强制安装；安装 bundle 为 27,569,898 bytes，source map 含 `getTerminalShellExecutionStream`。
- 提交 `30a1929f fix(terminal): share shell execution output stream` 已推送至 `origin/main`。
- GitHub Release `v5.5.0` 已覆盖；鉴权下载校验确认资产状态 `uploaded`、本地与远端均为 42,415,899 bytes，SHA-256 一致。
- 长期记忆已更新为三层协议：execution 单读共享、shell 完成前捕获、`command_output` 持久化屏障。
