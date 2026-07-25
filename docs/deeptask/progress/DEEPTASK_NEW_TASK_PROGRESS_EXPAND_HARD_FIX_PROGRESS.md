# Deeptask 新任务复述旧进度硬约束修复

## Checklist

- [x] 查询 universe-memory 与既有修复
- [x] 定位残留根因
- [x] 实现硬约束修复
- [x] 回归测试
- [x] VSCodium 安装 + GitHub 发布
- [x] 存储记忆

## 用户问题

- 给新任务时模型一直重复自己完成了什么
- 模型应主动扩展进度列表
- 打包安装 VSCodium 并发布 GitHub

## 根因

1. 旧修复 `1886f2c2` 只有提示词/清空 todo/剥离 text-only，仍可被模型忽略
2. `resumeTaskFromHistory` 未统一剥离 DeepTask text-only 完成摘要
3. 旧 `updateTodoList` 消息可被 `restoreTodoListForTask` 复活
4. 工具层没有“必须先扩展进度列表”的硬门闩

## 修复

- [`src/core/task/Task.ts`](src/core/task/Task.ts)
  - `requiresProgressListExpansion` 门闩
  - 清空 todo 时 supersede 最新 updateTodoList
  - resume 路径复用 `stripCompletedAttemptCompletionFromHistory`
  - 续跑提示词强制 FIRST tool = `update_todo_list`
- [`src/core/assistant-message/presentAssistantMessage.ts`](src/core/assistant-message/presentAssistantMessage.ts)
  - 门闩期间拒绝非 `update_todo_list` 工具
- [`src/core/tools/UpdateTodoListTool.ts`](src/core/tools/UpdateTodoListTool.ts)
  - 成功扩展后释放门闩
- [`src/core/environment/reminder.ts`](src/core/environment/reminder.ts) + [`getEnvironmentDetails.ts`](src/core/environment/getEnvironmentDetails.ts)
  - 新任务 REMINDERS 输出 CRITICAL 扩展指令

## Verification

- 测试：4 files, 104 passed, 4 skipped
- commit：`6de97c70`
- VSIX：`deeptask-5.5.0.vsix` (42,406,145 bytes)
- VSCodium：`deeptask.deeptask@5.5.0`
- 安装目录 markers 全命中
- GitHub：
  - https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0
  - https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix

## Memory

- `/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-11-Deeptask新任务硬约束扩展进度列表发布.md`
