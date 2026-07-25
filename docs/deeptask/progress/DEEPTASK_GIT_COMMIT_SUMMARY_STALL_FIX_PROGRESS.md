# Deeptask Git 图形界面 Commit 总结卡死修复

## 目标

- 修复 Source Control 中点击 Deeptask 总结图标后不生成 commit message。
- 大量文件/大 diff 时必须有界、可取消、可超时，不得无限等待或把扩展宿主拖死。
- 成功后可靠写入当前 repository 的 SCM input box；失败必须显示可操作错误并解除 loading。
- 防止重复点击并发请求与迟到响应覆盖新结果。

## Checklist

- [x] 查询历史记忆
- [x] 定位命令注册、diff 收集、模型调用、SCM 回填路径
- [x] 复现并确认根因
- [x] 实现有界 diff 与请求生命周期
- [x] 回归测试
- [x] changeset、提交、推送
- [x] 打包、安装、发布
- [x] universe-memory

## 验收场景

| 场景                       | 期望                          |
| -------------------------- | ----------------------------- |
| 少量 staged change         | 快速生成并填入 commit input   |
| 无 staged、仅 working tree | 按产品语义生成或给出明确提示  |
| 数百文件/超大二进制        | 使用摘要/截断输入，不冻结     |
| provider 超时/错误         | loading 收口并显示错误        |
| 连续点击                   | 只有最新/单个请求生效         |
| 多仓库 workspace           | 回填触发命令的正确 repository |

## 根因

1. `GitExtensionService` 对每个文件同步执行 `numstat` + `diff`，无 timeout、无 maxBuffer、无总上下文预算；大变更会长期阻塞扩展宿主并构造超大 prompt。
2. AI 单次 completion 无 timeout/cancel，relay 或流挂起时 Source Control progress 永不收口。
3. progress 不可取消，重复点击允许并发；迟到旧响应可能覆盖新响应。
4. adapter 外层异常只返回 `{ error }`，在目标仓库识别/withProgress 建立前失败时没有用户可见提示，表现为“点击无反应”。
5. 生成空字符串仍会被视作成功，SCM input 不变且无错误。

## 修复

- Git 命令增加 10 秒 timeout、2 MiB maxBuffer、SIGTERM。
- 每文件 diff 上限 20k chars，总 diff 上限 120k chars，文件摘要上限 500，并写明截断/省略信息。
- AI 层 75 秒 timeout，orchestrator 90 秒总生成 timeout。
- Source Control progress 可取消；新点击 abort 旧请求，迟到响应无法回填。
- 捕获命令/仓库识别错误并弹出明确错误；空 AI 响应改为失败。

## 空响应续修

- 用户实测暴露：部分 OpenAI-compatible reasoning relay 的非流式 `completePrompt()` 返回空 `message.content`，但流式 `createMessage()` 能产生 text/reasoning chunks。
- `singleCompletionHandler` 现先走轻量 direct completion；仅在空响应时自动重试 normalized stream，优先 text，reasoning-only 作为最后兜底。
- 保留 direct completion 的正常行为，避免所有 prompt enhancement 无条件增加一次流请求。
- 新增 direct-empty → stream-text 与 reasoning-only 两个回归场景。

## 验证

- commit-message 聚焦测试：2 files，19 passed。
- 新增超大单文件 diff 有界测试，并验证 Git timeout/maxBuffer 参数。
- 空响应续修测试：2 files，18 passed。
- `src` workspace TypeScript check 通过。

## 发布

- commit：`207ba52f`，已推送 `origin/main`。
- VSIX：`deeptask-5.5.0.vsix`，空响应续修后为 42,420,494 bytes，校验通过。
- VSCodium：已强制安装并确认 `deeptask.deeptask@5.5.0`。
- Release：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- Asset：`https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`。
- 日志：`DEEPTASK_GIT_COMMIT_SUMMARY_PACKAGE.log`、`DEEPTASK_GIT_COMMIT_SUMMARY_RELEASE.log`、`DEEPTASK_GIT_COMMIT_EMPTY_RESPONSE_PACKAGE.log`、`DEEPTASK_GIT_COMMIT_EMPTY_RESPONSE_RELEASE.log`。
- 记忆：`宇宙/记忆/项目记忆/2026-07-24-Deeptask-GitCommit总结有界执行与可取消修复.md`。
