# DeepTask 任务结束后发送消息卡死修复进度

## 既有交付

- [x] 查询 universe-memory 相关记忆
- [x] 定位任务结束后发送消息卡死的代码路径
- [x] 实现首轮修复并补充测试
- [x] 构建 VSIX 并重新安装到 VSCodium

## 2026-07-20 任务结束续发与编辑重发并发复查

- [x] 恢复任务结束续发、编辑重发、取消重建的既有分析
- [x] 定位续发 setup 串行但异步 task loop 仍可并发的状态竞争
- [x] 修复活动 loop 的续发准入并保留 `edited_resend` 语义
- [x] 补充严格的单 loop、ask/terminal 路由与取消重建测试
- [x] 运行聚焦测试、类型检查和 lint
- [x] 更新 universe-memory 并总结交付状态

## 当前发现

- `continuationChain` 只串行到 `initiateTaskLoop()` 被异步启动；第一条续发启动 loop 后、进入
  `isStreaming` 前，第二条续发仍可在同一 `Task` 上启动第二个 loop，共享解析器、消息内容和 ask 状态。
- 现有“连续两次完成后续发”测试允许启动 1 到 2 个 loop，无法证明竞态已消除。
- 软完成边界等待超时后转取消重建时未透传 continuation options，编辑重发可能退化为普通新任务续发。
- 修复原则：同一 `Task` 同时只允许一个 loop；活动 ask/terminal 直接消费用户输入，其余活动 loop
  将最新 payload 原子停放并取消重建；所有停放路径保留 continuation kind。

## 修复与验证

- 活动 task loop 上的新续发统一进入 pending continuation 槽并取消重建，不再依据 `isStreaming`
  放行第二个 loop；ask 和 terminal 输入仍由 webview 专用路由直接消费。
- continuation 去重签名加入 `kind`，避免相同文本的普通续发与编辑重发被错误去重。
- 所有停放路径透传 `UserContinuationOptions`，确保 `edited_resend` 跨软完成超时和重建保留。
- `Task.spec.ts`：83 passed，4 skipped。
- webview/provider 聚焦测试：3 files，63 passed。
- `pnpm check-types`：22 tasks passed。
- `pnpm lint`：18 tasks passed；仅有既有 TypeScript 5.9.3 支持范围警告。
- `git diff --check`：通过。
- 未重装 Python 依赖，无需更新 `requirements.txt`。
- 项目记忆：`/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-20-Deeptask任务结束续发与重发单循环修复.md`。

## 打包安装与发布

- [x] 强制重建 webview 与 extension bundle，并通过 VSIX 内容/品牌验证
- [x] 生成 `deeptask-5.5.0.vsix`：42,415,228 bytes
- [x] SHA-256：`cfdb519abf2d39ada700fc429a14d947cbaffc32f0fde730e6dc822e3ace2604`
- [x] 强制安装到 VSCodium，版本为 `deeptask.deeptask@5.5.0`
- [x] 提交并推送源码：`58859d8c fix(task): serialize post-completion continuations`
- [x] 覆盖发布 GitHub Release `v5.5.0`，远端资产大小与本地一致

## 2026-07-20 绿色软完成运行时复验与修复

- [x] 核对用户反馈的“任务结束时没有绿色，普通文字后直接停止”现象
- [x] 通过安装 bundle 与 extension host 启动时间排除“未加载新扩展”假设
- [x] 从真实 `ui_messages.json` 确认异常序列为 `say:text -> ask:resume_task`，且没有 `attempt_completion`
- [x] 修复 DeepTask 纯文本最终响应原位升级为 `completion_result`
- [x] 补充有文本/无文本边界测试并完成类型检查
- [x] 重新打包、强制安装并确认新 bundle 含 `promoteLastAssistantTextToSoftCompletion`
- [x] 提交、推送并覆盖 GitHub Release `v5.5.0`

### 根因与修复

- 根因不是设计变更，也不是 extension host 未重载，而是部分 provider 以普通最终文本结束当前轮，没有发出 `attempt_completion` 工具。
- 原有绿色软完成只在 `attempt_completion` 路径触发；无工具路径会进入纠错提示，若随后停止就只留下普通文本和 `resume_task`。
- 现在仅在 DeepTask、无工具且 assistant 文本非空时，将已经显示的最后完整 `say:text` 消息原位改为 `completion_result`，并调用 active soft-completion 边界逻辑。
- 含真实工具调用的轮次与空响应不受影响；任务历史仍保持 active，可继续发送消息。

## 最终验收

- 聚焦测试：100 passed，4 skipped。
- `pnpm check-types`：22/22 successful。
- `git diff --check`：通过。
- VSIX：`deeptask-5.5.0.vsix`，42,415,482 bytes。
- SHA-256：`3019b9f5552bf9ec82ded2648cb245df486c894be9aab181352e04d8df32cdd9`。
- VSCodium：`deeptask.deeptask@5.5.0` 已强制安装。
- Git：提交 `2de10651 fix(task): preserve green soft completion for plain text` 已推送到 `origin/main`。
- GitHub Release：`v5.5.0` 已覆盖，远端资产大小与 SHA-256 和本地一致。
- 本轮未重新安装依赖，不需要更新 `requirements.txt`。

## 2026-07-20 编辑重发已投递但停留在队列位置

- [x] 检索重发、队列、取消重建和消息可见性相关 universe-memory
- [x] 恢复既有编辑重发、单 loop 与软完成修复边界
- [x] 定位“模型收到并推理，但 UI 未显示为已发送”的前后端时间窗
- [x] 增加编辑重发乐观 `user_feedback` 回显与去重回归测试
- [x] 运行 UI 定向测试、类型检查和差异检查
- [x] 强制重建 VSIX、安装到 VSCodium 并核验安装 bundle
- [x] 保存本轮 universe-memory 原理与证伪条件

### 当前诊断

- 后端 `submitEditedMessage` 已直接进入 rewind + `edited_resend` continuation，不经过 `queueMessage`。
- Provider 向 webview 广播的 `messageQueue` 已固定为空，普通忙碌发送也已有乐观 `user_feedback`。
- 编辑行提交仅发送 IPC 并清空编辑缓冲；后端随后先 rewind 并广播删除后的历史，再等待旧 loop
  取消和新 Task 重建，最终才由 `continueTaskFromUserMessage()` 写入真实 `user_feedback`。
- 因此模型可收到重发并推理，但前端在该窗口没有位于对话底部的已发送消息，用户感知为仍停留在
  发送/队列位置。
- 最小修复：编辑提交时由 `ChatRow` 通知 `ChatView` 追加乐观 `user_feedback`；真实同文本/图片
  消息到达后复用现有 key 去重，不改变后端 rewind、取消重建和模型上下文协议。
- 当前根因置信度：0.93。证伪条件：真实安装 bundle 仍渲染独立 `QueuedMessages`，或 UI/API
  历史证明重发文本未进入 continuation。

### 验证与安装

- UI 回归：`18 passed | 12 skipped`；新增用例处于非 skip 分组并真实执行。
- 回归覆盖：提交后立即出现聊天行；rewind 后仅剩任务首行时仍保留；真实同文本/图片回流后聊天行去重。
- `webview-ui` 类型检查通过。
- `webview-ui` lint 通过；仅有既有 TypeScript 5.9.3 超出 parser 声明支持范围警告。
- `git diff --check` 通过。
- VSIX：`deeptask-5.5.0.vsix`，`42,416,596` bytes。
- SHA-256：`8d2bf4f70b2afe50e090e01e30309519121836179b0871f77a2ae5f94da21fdb`。
- VSCodium：已强制安装 `deeptask.deeptask@5.5.0`。
- 安装 bundle 与 VSIX 内 `index.js` 字节级一致，且验证包含：编辑回调先于 `submitEditedMessage`、
  乐观 `say:user_feedback` 工厂、`messages.length === 0` 清理边界、无 legacy visible queue。
- 初版安装验证错误要求 `user_feedback` 与 `submitEditedMessage` 在压缩代码 500 字符内相邻；实际
  两者位于父子组件不同闭包。该假设已否证，改为验证“子回调先于 IPC + 父回调构造反馈”的结构组合。
- 源码提交：`fe78a318 fix(chat): 修复编辑重发消息停留队列位置`，已推送到 `origin/main`。
- GitHub Release：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0` 已覆盖。
- Release asset ID：`483152912`，状态 `uploaded`；鉴权下载后远端大小与 SHA-256 均与本地一致。
- 本轮未重新安装依赖，不需要更新 `requirements.txt`。
- Universe memory：`/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-20-Deeptask编辑重发已发送可见性修复.md`。

## 2026-07-20 暂停后续发与命令最终输出采集修复

- [x] 恢复任务结束续发、取消重建和终端输出时序的既有修复
- [x] 用失败测试复现“暂停后立即发送被旧 ask 吞掉”竞态
- [x] 用失败测试复现自动清理 `command_output` ask 时终止输出监听
- [x] 将取消状态同步前移到任何任务历史 I/O 之前
- [x] 分离 UI ask 自动清理与终端后台化控制
- [x] 聚焦测试 24/24 通过
- [x] 运行终端相关扩展回归、类型检查、lint 和差异检查
- [x] 打包、安装并核验真实 VSIX 产物
- [x] 写入 universe-memory

### 根因与修复边界

- `ClineProvider.cancelTask()` 原先先等待 `getTaskWithId()`，之后才设置 `abortReason` 和
  `abandoned`。暂停 IPC 与紧随其后的发送 IPC 可在磁盘等待窗口交错，使新消息被旧 pending ask
  消费而不是停放给重建后的任务。
- `waitForCommandOutputResponse()` 的 250ms 自动应答同时调用 `process.continue()`；该方法会移除
  terminal `line` listener，因此终端仍能显示后续输出，但模型只能拿到空或截断的工具结果。
- 现在取消入口在任何 await 前同步封闭旧任务；自动应答只清理短暂 UI ask，不改变输出流监听。
- 用户明确提交命令反馈或选择后台运行时仍可调用 `process.continue()`，保持既有交互语义。
- shell exit 异常兜底由 250ms 放宽为 5s，且不再主动停止监听；正常路径仍由最终 `onCompleted`
  立即释放，不增加常规命令延迟。
- 扩展回归：107 passed，1 skipped；`pnpm check-types` 22/22、`pnpm lint` 18/18、
  `git diff --check` 全部通过。
- VSIX：`deeptask-5.5.0.vsix`，42,416,559 bytes；SHA-256：
  `75aac40f08a3f4ed95ccebe61bc6a1df2c4b4e4e044a5d5df6ae3b65f2130415`。
- VSCodium 已强制安装 `deeptask.deeptask@5.5.0`；安装 bundle/source map 与 VSIX 字节级一致。
- 生产 bundle 验证确认取消状态与中断动作均先于历史 I/O，自动清 ask 分支不包含
  terminal `continue()`。生产注释和 `sourcesContent` 不稳定，已改用 source 清单与压缩行为顺序验收。
- Universe memory：`/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-20-Deeptask暂停原子取消与终端监听保全修复.md`。
- 本轮未重新安装依赖，不需要更新 `requirements.txt`。

## 2026-07-20 任务结束续发仍卡死的真实运行时复查

- [x] 抓取最新真实任务的 UI/API 历史尾部和安装 bundle 时间
- [x] 证伪“消息未投递、请求未启动、旧安装未加载”三个假设
- [x] 定位取消重建时历史恢复与 pending continuation 并发启动
- [x] 将 pending payload 原子注入唯一历史恢复流程
- [x] 保留普通续发、编辑重发和显式 `startTask: false` 语义
- [x] 聚焦回归 95 passed、4 skipped
- [x] 运行完整相关回归、类型检查、lint 和差异检查
- [x] 重建、安装并核验真实 VSIX 产物
- [x] 更新 universe-memory 与被证伪假设

### 新根因与修复

- 真实故障序列为 `say:completion_result -> say:user_feedback -> ask:resume_task ->
  say:api_req_started`。用户消息已持久化，新请求也已启动，但旧恢复 ask 在模型循环开始后仍悬挂。
- `createTaskWithHistoryItem()` 原先让 Task 构造器 fire-and-forget 启动
  `resumeTaskFromHistory()`，随后 Provider 又立即消费 pending payload 并调用
  `continueTaskFromUserMessage()`；同一个新 Task 因此并发运行恢复流和续发流。
- 旧“say/ask completion 分类”修复只覆盖完成消息恰好是最后相关消息的串行场景，无法阻止两条流程并发。
- 现在历史 Task 一律先以 `startTask: false` 完成栈替换与监听器准备，再由 Provider 启动唯一一次
  `resumeTaskFromHistory(pendingContinuation)`；有 pending payload 时不创建恢复 ask，直接在完成历史裁剪和
  API 协议恢复后构造下一轮模型输入。
- 新回归证明普通 pending continuation 不产生 `resume_task`/`resume_completed_task` ask，且编辑重发仍使用
  `edited_resend` 包装、不强制创建新进度清单。

### 最终验证与安装

- Task + Provider 聚焦测试：95 passed，4 skipped。
- Task + Provider + ExecuteCommand 相关回归：112 passed，4 skipped。
- `pnpm check-types`：22/22 successful。
- `pnpm lint`：18/18 successful；仅有既有 TypeScript 5.9.3 parser 支持范围警告。
- `git diff --check`：通过。
- VSIX：`deeptask-5.5.0.vsix`，42,416,716 bytes。
- SHA-256：`963dde0086c1255ca92678b8c97942e03b71f19085bf34a0d9980c82daa80921`。
- VSCodium 已强制安装 `deeptask.deeptask@5.5.0`。
- VSCodium 主进程及 extension host 于 19:30 启动，晚于 19:14 的扩展安装时间，确认当前窗口已加载新产物。
- 安装 bundle/source map 与 VSIX 字节级一致；`Task.ts`、`ClineProvider.ts` 和
  `ExecuteCommandTool.ts` 均进入 source map。
- 生产产物确认单恢复流存在、旧并行 continuation 流不存在；取消状态前移和 terminal 输出监听保全检查继续通过。
- 本轮没有重新安装依赖，不需要更新 `requirements.txt`。
- 已修订旧分类记忆，将“ask/say completion 分类是充分根因”的置信度由 0.98 降为 0.68。
- 新项目记忆：`/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-20-Deeptask历史恢复与续发单入口原子注入修复.md`。

## 2026-07-20 新指令被最终交付误判的运行时复查

- [x] 抓取真实 UI/API 历史并确认新指令已进入模型上下文
- [x] 定位流式 `attempt_completion` 绕过正式拒绝检查
- [x] 定位旧清单仅改状态后被误认成新任务扩展
- [x] 屏蔽实际工作前的流式完成行
- [x] 保存旧清单内容指纹并拒绝状态重放
- [x] 拒绝“终态交付检查/最终交付”类收尾占位清单
- [x] 运行聚焦回归、类型检查、lint 和差异检查
- [x] 重建、安装并核验真实 VSIX 产物
- [x] 更新 universe-memory 与否证库

### 真实证据与根因

- 故障序列为 `say:user_feedback -> say:api_req_started -> say:completion_result(空) ->
  say:api_req_started`；随后模型回到旧任务的 extension host 终态验收，而不是执行用户的新修复指令。
- 新指令确实进入 API 用户消息，且下一条 assistant 已能读取新文本，因此不是发送丢失、上下文未注入或旧安装未重载。
- [`AttemptCompletionTool.handlePartial()`](src/core/tools/AttemptCompletionTool.ts) 原先在流式阶段直接渲染
  `completion_result`，没有复用正式执行路径的 `shouldRejectPrematureActiveContinuationCompletion()`；即使正式
  `execute()` 随后拒绝交付，UI 已留下空绿色完成行。
- 新续发清空了当前 `todoList`，但没有保存旧清单身份。模型把相同旧条目仅由 `completed` 改回
  `in_progress` 后，`hasActionableProgressListForContinuation()` 会误判为有效的新任务扩展。
- “重置为仅包含终态交付检查的新清单/完成最终交付”本质仍是旧任务收尾，不是用户新指令的可执行里程碑。

### 修复与当前验证

- 流式 `attempt_completion` 在 active continuation 尚未运行实际工作工具时不产生任何
  `completion_result` UI 行；正式工具执行继续返回纠错 tool result，让模型执行新指令。
- 续发边界保存被清空清单的规范化内容指纹；相同内容即使改变状态或 ID，也不能解除进度扩展门控。
- 中英文 terminal/final delivery、终态/最终交付验收类清单项被归类为无实际新工作的收尾占位项。
- Task + AttemptCompletion + UpdateTodoList 回归：128 passed，4 skipped。
- `pnpm check-types`：22/22 successful。
- `pnpm lint`：18/18 successful；仅有既有 TypeScript 5.9.3 parser 支持范围警告。
- `git diff --check`：通过。
- 扩展回归首次失败源于 `updateTodoListTool.spec.ts` 的伪 Task 未提供已有门控方法；补齐测试替身后通过，
  未改变产品逻辑。
- VSIX：`deeptask-5.5.0.vsix`，42,417,001 bytes；SHA-256：
  `03ae5fdc878c53241d9325a97d38d75f1b3a71da10c557c93e90b19c1b3d0202`。
- VSCodium 已强制安装 `deeptask.deeptask@5.5.0`；安装 bundle/source map 与 VSIX 字节级一致。
- 生产 bundle 确认 `AttemptCompletionTool.ts` 已映射，流式和正式执行路径均检查 premature completion，
  旧清单内容签名存在；单恢复流、原子取消和 terminal 输出监听检查继续通过。
- Universe memory：`/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-20-Deeptask续发流式交付与旧清单重放修复.md`。
- 本轮没有安装或重装依赖，`requirements.txt` 无需更新。

## 2026-07-20 反馈自动拓展任务状态机重构

- [x] 将用户反馈定义为宿主级新工作轮次，不再要求模型先证明任务已拓展
- [x] 保留旧清单真实状态并追加基于最新反馈的 `in_progress` 工作项
- [x] 历史恢复时先从持久化消息恢复清单，再原子建立反馈轮次
- [x] 提示模型按语义判断反馈是扩展、修订还是替换旧任务列表
- [x] 删除“全完成清单自动改回进行中”的旧完成逻辑与误导性状态回执
- [x] 覆盖普通反馈、历史恢复、清单上下文保留和实际工作后完成的聚焦回归
- [x] 运行扩展回归、类型检查、lint、构建安装和生产 bundle 验证
- [x] 修订 universe-memory，记录“宿主边界不等于丢弃结构化历史上下文”

### 最终结论

- 用户反馈本身就是任务拓展事件；不再把是否建立新任务轮次委托给模型的下一次
  `update_todo_list` 调用。
- 旧逻辑要求模型第一步更新清单，又把全完成清单最后一项强制改成 `in_progress`，因此会产生
  “状态回执把已完成项重新标成进行中”的自循环，并继续围绕旧任务收尾。该方案已从产品路径删除。
- 第一版宿主状态机曾把“旧状态不能支配新任务”误实现为“必须清空旧清单”。用户反馈证明该方案会
  丢失结构化上下文，使模型无法判断新消息是在扩展、修订还是替换既有工作；该结论现已否证。
- 最终边界由宿主原子建立：保留旧清单及其真实状态，将最新反馈追加为新的进行中工作项，然后允许
  模型结合完整对话和清单语义主动保留、修订、删除或增加里程碑。已完成项不得仅为保活而重新打开。
- 历史恢复路径在建立反馈轮次前调用 `restoreTodoListForTask()`，确保重开任务和跨工作区续发不会丢失
  持久化清单上下文；最近的 todo 消息以 `extendedByContinuation` 标记保存合并快照。
- `update_todo_list` 和 `attempt_completion` 不算实际工作；实际工作前的交付仍会被拒绝。真实工具运行后，
  宿主管理的反馈项在最终交付前自动结算并写入可恢复的 `user_edit_todos` 快照。
- 模型主动保留或建立的其他未完成清单项仍受 `preventCompletionWithOpenTodos` 约束，不会被宿主擅自完成。

### 验证与安装

- 最新“保留清单上下文”聚焦回归：129 passed，4 skipped。
- Task、工具、webview 消息入口和 Provider 取消边界扩展回归：187 passed，4 skipped。
- `pnpm check-types`：22/22 successful。
- `pnpm lint`：18/18 successful；仅有既有 TypeScript 5.9.3 parser 支持范围警告。
- `git diff --check`：通过。
- VSIX：`deeptask-5.5.0.vsix`，42,417,129 bytes；SHA-256：
  `804baf988fd2c35cda7233080590711084953c9e9b3d0afca32ebd41b3d357ae`。
- VSCodium 已强制安装 `deeptask.deeptask@5.5.0`；安装 bundle/source map 与 VSIX 字节级一致。
- 生产验收确认宿主反馈状态机、`extendedByContinuation`、智能扩展提示和历史清单恢复调用均存在；
  `supersededByContinuation`、“已丢弃旧清单”契约和旧误导性状态回执均不存在。
- 打包安装首次验收失败源于验收脚本错误假设生产 source map 含 `sourcesContent`，第二次失败源于
  `all()` 括号位置错误；均已修正并记录，产品构建与安装本身第一次即成功。
- Universe memory 已修订项目记忆与旧否证记录，并新增：
  `/home/kurz/Obsidian/宇宙/记忆/错误记忆/2026-07-20-Deeptask宿主反馈轮次无条件清空旧清单已否证.md`。
- 本轮没有安装或重装依赖，`requirements.txt` 无需更新。

## 2026-07-24 长命令结束后强制继续丢输出与发送卡死

- [x] 定位命令结束后用户反馈仍返回 still running 的工具结果路径
- [x] 定位 onCompleted 空载荷时丢弃已流式输出的问题
- [x] 修复 finished + feedback 合并为完成态工具结果
- [x] 修复 completed 空输出回退到 accumulatedOutput
- [x] 修复 shell-exit 5s 兜底时保留已捕获输出
- [x] 修复 webview 在 shell 已退出时把强制继续路由为真实续发
- [x] 补充 executeCommand 回归：19 passed
- [ ] 打包安装并验证生产 bundle

### 根因

1. executeCommandInTerminal 只要存在 pendingCommandOutputFeedback/message 就优先返回 “Command is still running…”，即使 completed 或 exitDetails 已成立。
2. onCompleted("") 会覆盖已通过 onLine 积累的输出。
3. 前端 command_output 主按钮在 shell 已退出时仍一律发 terminalOperation:continue。

### 修复

- 仅当命令未完成时，用户反馈才返回 still-running 工具结果。
- 命令已完成时，把反馈附加到 finished 结果（含 Exit code 与 Output）。
- completed 输出为空时回退 accumulatedOutput；5s shell-exit 兜底同样写入已捕获输出。
- ChatView 主按钮：live shell → terminal continue；已退出 → askResponse 续发。
