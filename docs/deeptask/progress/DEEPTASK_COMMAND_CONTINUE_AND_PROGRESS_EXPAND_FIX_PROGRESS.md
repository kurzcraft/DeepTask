# Deeptask 长命令无继续按钮 + 任务结束后不扩展进度列表

## Checklist

- [x] 查询 universe-memory 与既有修复
- [x] 定位长命令卡死后无“继续”按钮根因
- [x] 定位任务结束后不扩展 todo 列表根因
- [x] 实施前后端修复
- [x] 聚焦回归测试
- [x] 打包安装 VSCodium + 写记忆

## 用户反馈

1. 长命令依旧卡死；就算不自动执行，也必须有“继续”按钮可手动继续，不能什么都没有。
2. 任务结束后再发消息，模型不扩展任务列表，只想偷懒复述。

## 根因

### A. 长命令运行中/退出后无 Continue

1. shell start/exit 时前端清按钮。
2. 已批准 command 在 active shell 时隐藏 Run，不切 Continue。
3. 空 Continue + 无 terminalProcess = no-op。

### B. 任务结束后不扩展进度

1. 工具门闩拦不住纯文本偷懒。
2. noToolsUsed 通用提示不够强。

## 修复

1. ChatView：活跃 shell / 退出恢复态强制 Continue；Kill 仅 live shell 显示。
2. webviewMessageHandler：空 continue 也 `continueTaskFromUserMessage`。
3. Task：`requiresProgressListExpansion` 期间 no-tools 改写为强制 `update_todo_list` 消息。

## 验证

- backend: 120 passed / 4 skipped
- ChatView: 11 passed / 12 skipped
- VSIX: `deeptask-5.5.0.vsix` (42408535)
- install: `deeptask.deeptask@5.5.0`

## 记忆

- `/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-11-Deeptask长命令Continue按钮与进度扩展硬修复.md`
- `/home/kurz/Obsidian/宇宙/记忆/错误记忆/2026-07-11-Deeptask命令生命周期清按钮与空Continue-no-op.md`
