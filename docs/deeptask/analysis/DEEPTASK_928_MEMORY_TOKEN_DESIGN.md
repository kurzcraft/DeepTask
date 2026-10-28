# DeepTask 9.2.8：长会话资源优化设计（实现前记录）

日期：2026-10-28。基线：777ec143，main，开始时已跟踪工作树干净，已安装 9.2.7。
用户约束：保留全部功能、必要模型信息和历史；先理解架构记录笔记，再修改、验证、打包安装、提交推送。后续子代理显式使用 yujianwudi；不改变主对话提供商。

## 1. 运行结构与所有权

- VSIX 主入口：src/dist/extension.js。src/esbuild.mjs 从 packages/agent-runtime/src/process.ts 构建 dist/agent-runtime-process.js；launch/ 不是本次生产源。
- 主扩展宿主：ClineProvider 持有 Task 栈；Task 持有完整 UI 消息、API 历史、保存链、事件和终端引用。
- 同进程子代理：ParallelManager -> Task.create -> 背景栈；sessions 保存状态、Task 引用与运行中消息副本。
- fork 子代理：RuntimeProcessHandler -> fork -> ExtensionService / ExtensionHost -> 同一扩展 bundle；父进程另存 Agent Manager 消息，子进程退出不等于父缓存释放。
- Webview：ExtensionStateContext 持有主会话与 parallelSessionMessages；ChatView 派生 combine/filter/group，Virtuoso 虚拟化 DOM；ChatRow/Markdown/CodeBlock 消费上下文；Shiki 单例按语言加载。
- 请求：持久 API history -> effective history -> 清洗后的出站投影 -> provider；system prompt 独立组装。压缩与工具配对仍以原有代码为准。

## 2. 现场证据与不确定性

- 基线日志：EXTRA/output/deeptask_928_baseline.log。机器 64GB、无 swap；有其它高占用程序。仅记录，不终止或修改项目外进程。
- 最大列出的 codium 进程 RSS 约 3.40GiB；尚未建立此进程与报错 Webview 的确切归属，不能据此宣称确定泄漏根因。
- MemoryWarningBanner 阈值 90，实际百分比由 helpers 中 getMemoryPercentage 决定，需进一步核实分母。MemoryService 遥测只取 JS heap，不能混同系统 RAM。
- 旧笔记的“424GB -> 30MB”是历史模拟累计传输量，不是本轮实测峰值内存，也不能证明灰屏已根治。

## 3. 已确认的冗余路径

1. ClineProvider.postStateToWebview 每次构造全文 state，且未 await postMessageToWebview；已有增量消息并未消除其它控制路径的全量快照。
2. ExtensionService 对同一 state 同时 emit message 与 stateChange，process.ts 两路均 IPC 发送；需核对父端控制语义后只消除跨进程重复传输，不删除公共事件 API。
3. ExtensionStateContext 每个消息更新重建大 context；ChatRow 订阅全量 context，且所有行收到变化中的 lastModifiedMessage。ChatView 每行执行全表 some/find/filter。
4. parallelSessionMessages 不随 settlement 释放；简单清空会破坏历史面板，只有实现可靠回补才能优化。
5. escapeHtmlCache 仅限制 500 条，没有字符/字节上限；Shiki 初始化加载所有 bundled themes。任何主题优化必须保留全部主题的按需加载能力。
6. Task Progress 说明在 custom-instructions 与 SYSTEM_PROMPT 两处生成；SCRIPT-FIRST 在 rules 与独立 section 两处生成。仅可去除宿主生成的重复内容，必须保留各分支独有要求，不能去重用户规则。
7. MCP XML 目录 pretty JSON 可去掉格式空白，JSON schema 全部字段及值保持一致。

## 4. 优先实施策略

- 前端：限制纯辅助缓存的总预算与单条预算，保持原文完整；减少历史行无意义渲染与列表重复扫描；Shiki 保留主题/语言兼容和失败重试。
- 提示词：合并宿主进度说明，逐项核对语义覆盖；保留 file-based override、开关与子代理豁免；压紧 schema JSON，仅减少冗余格式。
- 多进程：核实父端 stateChange 与 message/state 的行为差异，保留全部回调与恢复逻辑，仅消除同一全文的双路 IPC。
- 宿主：评估全量状态请求的有界合并；调用者 await 必须等到覆盖自身请求的真实发送，不吞最终状态、错误或生命周期刷新。

## 5. 禁止的捷径

- 不减少模型 context window、不截断用户/工具结果、不修改压缩阈值、不用 effective history 覆盖持久历史。
- 不在 dispose 里清历史：abort 顺序为 dispose -> final save snapshot -> 有界等待 -> 清数组。
- 不清 state.task：取消僵尸驱逐和 Continue 实例接管仍依赖它。
- 不无回补清并行 transcript，不以 500 条显示上限冒充内存治理。
- 不对可变历史用未经验证的 WeakMap 缓存；旧方案已因快照身份、原位更新、合并配对失败。
- 不清未消费终端输出，未证实已持久化前不可假设它可丢弃。
- 不通过调高告警阈值、扩大 heap 或杀外部进程掩盖问题。
- 不保证零 bug 或永久运行；用可复现测试、边界报告与可回退提交控制风险。

## 6. 自动合并落盘修复（2026-10-28，实施前记录）

现场确认：主树含无关未提交删除和设计笔记，WorkspaceService.merge 在临时 detached worktree 完成 merge 后删除临时树，却未推进目标分支引用，仍报告成功。三次成功报告对应的补丁实际均未出现在 main；已通过受限源码补丁恢复，未修改无关本地内容。

修复采用两阶段事务：先在临时 detached worktree 以目标分支快照完成合并；然后定位真正检出目标分支的工作树，通过 Git 的 fast-forward-only 更新其分支、索引与工作目录（禁止 autostash），保留不冲突的 staged/unstaged/untracked 修改。目标分支未检出时使用 compare-and-swap update-ref。发布前核对目标未漂移，发布后核对目标引用；只有落盘成功才标记 merged 或删除源工作区。临时合并冲突只在临时树 abort，不回滚用户工作区。不覆盖冲突的本地修改，不用 reset --hard、stash 或强制分支更新。

真实 Git 回归覆盖：干净主树、无关未暂存修改、已暂存修改、未跟踪文件、重叠修改拒绝、主树切到其它分支、目标分支在另一个 worktree、合并冲突、重复合并。子代理依赖说明要求默认复用主仓库兼容依赖，源码/测试/产物仍在分配树，不在共享依赖上 install/prune/rebuild，不把主仓库测试误当子树测试。

## 7. 验证和交付

每块修改均需针对性回归：并发/重试/切换/恢复/abort 边界、完整字符串与 schema 等价、主题切换、历史消息可访问。记录测试数量、真实 token 差分（若可测）、压力模拟范围；不得将累计分配或传输量称为峰值堆下降。执行受影响包类型检查及 lint，使用维护打包入口强制新建资产，检查包内 9.2.8 与本次代码，再安装 VSCodium。安装不等于运行宿主已重载；不主动中断当前用户会话。只精确提交本轮文件，默认普通 fast-forward push，不强推远端。
