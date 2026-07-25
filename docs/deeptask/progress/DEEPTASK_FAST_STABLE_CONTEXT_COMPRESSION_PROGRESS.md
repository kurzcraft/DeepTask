# Deeptask 最快稳定上下文压缩修复

## 目标

- 自动压缩失败或返回空摘要时，使用快速本地结构化摘要，不再直接显示“已移除 N 条消息”。
- 正常模型摘要保持高质量；provider 不稳定时仍保留原始任务、关键决策、文件与近期进展。
- 本地摘要必须毫秒级、有严格字符预算、无 reasoning 泄漏，并继续走现有非破坏式压缩事务。

## Checklist

- [x] 查询历史记忆
- [x] 定位截断文案与 fallback 链路
- [x] 实现本地结构化摘要 fallback
- [x] 增加 provider 抛错、空响应与大历史测试
- [x] 验证延迟、token 降幅与焦点保留
- [x] changeset、提交、推送
- [x] 打包、安装、发布
- [x] universe-memory

## 根因

`manageContext()` 在 `summarizeConversation()` 返回 error/抛错时立即执行 50% sliding-window truncation。当前摘要优先调用 provider 的 `completePrompt()`，任何 relay 空响应、超时或协议错误都会触发低保真截断，因此用户看到“已移除 92 条消息”。

## 修复

- 自动模型压缩保留为首选高质量路径，但限定 15 秒 fast-path budget。
- provider 抛错、空摘要或超时后立即生成确定性的本地结构化摘要，并继续走现有非破坏式 Summary/condenseParent 提交事务。
- 本地摘要上限 12,000 chars，单消息 900 chars；强制保留初始任务、最新用户请求，优先收集倒序用户任务边界，再填充最新 assistant/tool 证据。
- 清除 reasoning 与 `<environment_details>`，避免隐私/思维链泄漏。
- 手动压缩保持原有显式错误语义，不静默降级，便于用户知道所选 provider 有问题。
- 只有本地摘要也无法构建或新上下文未缩小时，才保留 sliding-window 作为最后安全阀。

## 验证

- 压缩联合测试：2 files，93 passed，3 skipped。
- 120+ 消息本地摘要构建低于 100ms 测试阈值，结果不超过 12,000 chars。
- 验证初始任务、最新验收目标、provider 错误均保留；reasoning/environment details 均排除。
- TypeScript check 通过。

## 交付

- Commit：`a44aa692`（已推送，`origin/main...main = 0/0`）。
- VSIX：`deeptask-5.5.0.vsix`，42,422,111 bytes，已强制安装到 VSCodium。
- Release：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`，同名资产已替换。
- 日志：`DEEPTASK_FAST_CONTEXT_COMPRESSION_PACKAGE.log`、`DEEPTASK_FAST_CONTEXT_COMPRESSION_RELEASE.log`。
