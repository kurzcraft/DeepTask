# DeepTask 完成后继续发送与取消删除后继续卡死修复进度

## 用户反馈

- 任务结束后继续发送消息，模型有概率直接结束任务。
- 点击取消按钮后发送消息，再取消并删除消息，点击继续，按钮消失但任务卡死。

## 已恢复背景

- `DEEPTASK_ATTEMPT_COMPLETION_LOOP_PROGRESS.md`：此前修过结束任务后重复结束任务问题。
- `DEEPTASK_TASK_END_SEND_STUCK_PROGRESS.md`：此前修过任务结束后发送消息卡死。
- `DEEPTASK_PAUSE_SEND_QUEUE_GRAY_STUCK_PROGRESS.md`：此前修过暂停后发送消息被 stale pending ask 吞掉。
- `DEEPTASK_NO_STUCK_RESEND_COMMAND_AUDIT_PROGRESS.md`：此前修过 legacy queue 分支优先级，要求取消续写/终端等待优先于 pending ask。

## 当前假设

- 完成后继续发送消息仍可能带入旧 `completion_result` 或旧 `attempt_completion` 工具上下文，导致模型下一轮优先复用结束任务路径。
- 删除消息后继续可能产生 UI 侧 continuation 触发，但后端找不到对应历史消息或 continuation payload 为空，仍清理了继续按钮/等待状态，造成按钮消失但没有真正启动新请求。
- 取消后的 task rehydrate 与删除消息/点击继续之间可能存在状态竞态：pending continuation 被消费或清空，但新 task 未启动。

## 检查清单

- [x] 建立任务结束继续发送与取消删除继续卡死进度文件
- [x] 定位完成后继续发送被直接结束的状态路径
- [x] 定位取消并删除消息后继续按钮消失卡死路径
- [x] 实现最小修复并补回归测试
- [x] 运行 focused tests、lint、type
- [x] 打包安装到 VSCodium
- [x] 存储本轮经验

## 观察记录

- `Task.continueTaskFromUserMessage()` 在上一轮以 `attempt_completion` 完成时，会把最后的 user `tool_result` 作为旧 user content 继续复用，再追加新的 `<user_message>`。这让下一轮看起来仍在回应旧的 `attempt_completion` 工具调用，模型有概率直接再次结束任务。
- `webviewMessageHandler` 的 `askResponse` 分支在没有 pending ask、没有文本 payload 的 `messageResponse` 下只清 stale ask 和队列并 post state。删除消息后点击继续可能正好落入这个空继续路径，前端按钮被隐藏，但后端没有启动新请求。

## 修复记录

- `src/core/task/Task.ts`：完成态 continuation 遇到上一轮 `attempt_completion` assistant/tool_result 时，先剥离完成工具调用及其结果，再追加新的任务继续指令。
- `src/core/webview/webviewMessageHandler.ts`：无 pending ask 的空 `messageResponse` 现在作为最小 continuation 路由到 `continueTaskFromUserMessage("")`，避免只清 UI 不启动任务。
- `src/core/task/__tests__/Task.spec.ts`：新增完成态 continuation 不复用旧 `attempt_completion` 工具上下文的回归测试。
- `src/core/webview/__tests__/webviewMessageHandler.spec.ts`：新增空 Continue 点击在无 pending ask 时仍启动 continuation 的回归测试。
- `.changeset/fix-completion-cancel-continue-stuck.md`：新增 patch changeset。

## 验证记录

- `pnpm --dir src test core/webview/__tests__/webviewMessageHandler.spec.ts core/task/__tests__/Task.spec.ts`：通过，2 files passed，82 passed，4 skipped。
- `pnpm lint`：通过。
- `pnpm check-types`：通过。
- `bash scripts_package_deeptask_vsix.sh`：通过，生成并校验 `deeptask-5.5.0.vsix`。
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force`：通过，安装确认 `deeptask.deeptask@5.5.0`。

## 经验存储

- 已写入 `/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-08-Deeptask完成态续写与取消删除继续卡死修复.md`。
