# Deeptask Git Commit 建议不生成回归修复进度

## 目标

- 修复 Source Control 中点击 Deeptask Git 图标后不生成 commit message 建议的问题。
- 确保命令入口、Git 采集、AI 生成、超时/取消、SCM 输入框回填形成可观察闭环。
- 添加回归测试，并验证源码、构建产物、VSIX 与实际安装目录一致。

## 里程碑

- [x] 查询 universe-memory 与历史 Git Commit 修复记录
- [x] 记录本次用户反馈并定位当前 5.5.5 运行时故障层
- [x] 建立可重复的聚焦回归测试
- [x] 实现根因修复与用户可见错误反馈
- [x] 运行聚焦测试、类型检查与 lint
- [x] 构建并审计新 VSIX
- [-] 安装到 VSCodium/VS Code 并验证运行时
- [ ] 由用户执行真实 SCM 图标验收
- [-] 更新 changelog/changeset、提交与发行
- [ ] 系统性存储 universe-memory 与错误学习

## 当前发现

- 用户明确反馈：Git 图标可点击，但不生成建议。
- 历史修复曾覆盖两类根因：缺少 `onCommand` 激活事件；Git/AI 无界执行、direct completion 空响应以及 SCM 回填竞态。
- 当前 VSCodium 使用默认 `openai / gpt-5.6-sol`，未配置 commit 专用 profile，配置并未悬空。
- `OpenAiHandler.completePrompt()` 强制使用非流式 Chat Completions 并只读取 `message.content`；正常聊天使用流式 `createMessage()`，并兼容 reasoning relay。
- 新增的否定测试证明：旧实现会先等待永不结束的 direct promise，因此即使已有“空响应后流式兜底”，Git 图标仍会长时间无结果。
- 已为 `singleCompletionHandler()` 增加显式 `preferStream` 选项；仅 Git Commit 启用 stream-first，空流或流异常时保留 direct fallback，其他调用维持 direct-first。
- 已新增底层与跨层契约测试，共 21 项通过；测试锁定了“不得先调用挂起 direct endpoint”及 Git Commit 必须传入 `{ preferStream: true }`。

## 验收边界

- 点击图标后必须在有界时间内生成并回填建议，或显示明确、可操作的错误；禁止静默无响应。
- direct completion 为空时，流式兜底必须真正消费可见文本；所有路径最终必须解除 progress。
- 新请求必须取消/取代旧请求，旧响应不得覆盖新结果。
- 测试通过不等于安装验收；最终须验证实际安装目录和真实 SCM 输入框行为。

## 验证状态

- [x] `utils/__tests__/enhance-prompt.spec.ts`：12/12 通过
- [x] `services/commit-message/__tests__/CommitMessageGenerator.spec.ts`：9/9 通过
- [x] TypeScript 类型检查
- [x] 聚焦 ESLint
- [x] VSIX bundle 关键标记审计
- [ ] 安装目录关键标记审计
- [ ] VSCodium 真实 SCM 输入框验收

## 发布资产

- 版本：`5.5.6`
- VSIX：`deeptask-5.5.6.vsix`
- 大小：`42427550` bytes
- SHA-256：`5f79dde87787ad184933c2ba412dff1aec8a59d6e0f6866369cfd92e38a14eba`
- 构建与审计状态：`0`
