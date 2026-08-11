# Deeptask 9.0.5

本补丁修复任务进度清单首次创建时宿主任务 ID 与模型提示词上下文漂移，导致原生 TODO 第一次同步失败、模型被迫二次修改 marker，随后任务流程卡住的问题：

- 生成任务预览提示词时，使用当前宿主任务的 `taskId`，与实际任务运行时的提示词保持一致。
- 首次创建清单时继续要求使用宿主任务 ID 作为 marker；恢复已有清单时保留其持久化 marker 和路径，不覆盖 durable identity。
- 首次绑定不再依赖错误的旧实例 ID 过滤；在已读回、格式有效且唯一的活动清单上完成绑定。
- 保留过期绑定清理、唯一活动清单重绑定和多候选拒绝逻辑，避免历史任务状态污染当前任务。
- 中英文 README、扩展包内 Marketplace 介绍页、安装命令和版本信息统一更新到 9.0.5。

## 验证

- `src/core/task/__tests__/Task.spec.ts`：129 项通过，4 项跳过。
- `src/core/prompts/__tests__/system-prompt.spec.ts` 与相关自定义指令测试：60 项通过。
- `src/core/webview/__tests__/generateSystemPrompt.browser-capability.spec.ts`：2 项通过，确认预览提示词注入当前宿主任务 ID。
- 扩展 bundle 构建成功；VSIX manifest、扩展入口、任务进度协议标记和包内 README 在发布打包阶段复验。
- VSCodium 安装目标：`deeptask.deeptask@9.0.5`。

## 待发布产物

- 文件：`deeptask-9.0.5.vsix`。
- Release：<https://github.com/kurzcraft/DeepTask/releases/tag/v9.0.5>。
