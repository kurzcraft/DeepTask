# Deeptask 9.3.0

## 功能与修复

- evolve slug 与显示名强制同号：`evolve-N` 显示为 `Evolve-N`。`manage_mode` copy/update 不再继承前代显示名。
- 过大任务清单先建 `EXTRA/task/<短标题>/` 顶目录，再拆无 `deeptask-task-id` 的轻文件；对话仍只有一份权威 `EXTRA/task/*.md`。
- 压缩快路径不得切掉 `<current_task_state>`；子代理判定用 `parentTaskId` / `isChildAgent`。
- 长会话灰屏按实测持有链修，不再猜 inotify、不再重砍 9.2.9 监视器：
  - 日志/大块跳过 Shiki `codeToHast` token 树，纯 `pre` 回退；复制仍用 rawSource。
  - 流式命令与 transcript 展示投影一律 8k；展开仍 `requestCommandOutput` 取全文。
  - 增量 `postState` 用 `taskId` + `instanceId` + `clineMessagesEpoch` 省略未变的 `clineMessages`；`force` 仍发全文；abort 清空 posted epoch。webview 仅在字段存在时替换。
  - 镜像窗口 `hydratePersistedMessages` 只读 `ui_messages`，不 parse 97MB `api_conversation_history`。resume 在内存为空时仍加载 API 全文。`getTaskWithId` 默认跳过 API parse，export 等路径除外。

## 明确不改

- 磁盘存储与模型输入仍保留全文。
- 不裁 `apiConversationHistory` 作为模型 I/O。
- 不重做 9.2.9 监视器，不把 `Committed_AS` 当物理 RSS 溢出。
- 不声称永久消除灰屏。

## 现场采样（2026-10-31）

灰屏阈值：渲染 RSS ≥1500MB 或 anon ≥1200MB。

| 时刻 | 渲染 RSS / anon | extensionHost RSS | 判定 |
|------|-----------------|-------------------|------|
| 04:42 溢出 | 3944 / 3828 MB | ~1.3 GB | zygote 渲染持有，不是 fileWatcher |
| 08:37 回涨 | 1986 / 1873 MB | 1236 MB | 增量 postState 仍整包 7432 条 |
| 14:54 重载 omit 包 | 366 / 248 MB | 618 MB | 低于阈值 |
| 15:43 同窗未重载 | 704.5 / 589.6 MB | 677.7 MB | OVERFLOW=False；慢爬不当失败 |
| 15:51 发布前 | 591.1 / 476.1 MB | 685.8 MB | OVERFLOW=False；不改路径 |

`Committed_AS` 可超过 CommitLimit；不当作渲染灰屏。

## 受控验证

- `projectCommandOutput` + highlighter skip + CodeBlock：29+5 通过。
- `ClineProvider.getTaskWithId` + `subagentResultInbox`：11 通过。
- omit/force/abort host 23 + webview 14 通过。
- `Task.spec`：hydrate 不 parse API；resume 空历史仍加载 API。
- 15:41 已装 `deeptask.deeptask@9.3.0`；VSIX `bin/deeptask-9.3.0.vsix` 38.8MB。产物含 omit epoch 与 hydrate skip。

## 验证边界

- 安装不等于已重载；同窗口旧 heap 不回落，不能当修复失败。
- 测过未装、装了未重载，都不能当内存结论。
- 本版不保证永不溢出。
