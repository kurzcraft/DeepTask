# Deeptask 模型推理时缺少取消/暂停按钮修复进度

## Checklist

- [x] 检索相关记忆与现有 cancel/pause/streaming UI 代码
- [x] 定位“自动命令卡住 → 强制继续后”路径上 isStreaming/Cancel 被压掉的根因
- [x] 实现修复：强制继续后的模型推理仍显示 Cancel/暂停
- [x] 补回归测试并验证
- [x] 更新进度文件与宇宙记忆

## 用户问题

1. 模型推理时没有取消按钮用于暂停
2. 场景补充：大概发生在自动命令卡住、点击强制继续后

## Root Cause

1. 为保留长命令 Continue 按钮，`isStreaming` 在 `activeCommandCount > 0` 或 `command_output` 恢复按钮可见时被强制置 `false`。
2. 用户点击“强制继续 / proceedWhileRunning”后，新的 `api_req_started` + partial reasoning 会开始，但 shell 仍可能记在 `activeCommandExecutionIdsRef` 中。
3. 于是新的模型推理轮次仍被当成“命令等待态”，Cancel 不出现。
4. 次要问题：`showScrollToBottom` 为 true 时整行动作按钮被滚动到底部按钮完全替换，推理时上滑也会看不到 Cancel。

## Fix

1. [`webview-ui/src/components/chat/ChatView.tsx`](webview-ui/src/components/chat/ChatView.tsx)
   - 仅当命令相关消息之后**没有更新的** `api_req_started` 时，才用 `activeCommandCount` / `command_output` 压制 `isStreaming`。
   - 若强制继续后已有更新的 `api_req_started`，即使 shell 仍 active，也显示 Cancel。
   - 流式推理时，上滑显示 scroll-to-bottom 不再整行替换 Cancel；两者可并存。
2. 回归测试：
   - [`webview-ui/src/components/chat/__tests__/ChatView.spec.tsx`](webview-ui/src/components/chat/__tests__/ChatView.spec.tsx)
   - “shows Cancel after force-continue starts a new API request even if the shell is still active”
3. changeset：`.changeset/fix-reasoning-cancel-after-force-continue.md`

## Verification

- `cd webview-ui && pnpm exec vitest run src/components/chat/__tests__/ChatView.spec.tsx`
- Result: 1 test file passed, 15 passed / 12 skipped

## Memory

- `/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-11-Deeptask强制继续后推理缺少Cancel按钮修复.md`
- `/home/kurz/Obsidian/宇宙/记忆/错误记忆/2026-07-11-DeeptaskactiveCommand压制isStreaming导致无Cancel.md`

## Entropy

任务前：强制继续后若 shell 仍 active，推理轮次没有 Cancel；上滑时 Cancel 也会被滚动按钮替换。  
任务后：新 API 请求优先于 stale 命令活跃态显示 Cancel；流式时 Cancel 与 scroll-to-bottom 可并存。净熵下降。
