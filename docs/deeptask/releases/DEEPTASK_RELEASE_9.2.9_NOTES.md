# Deeptask 9.2.9

## 功能与修复

- 聊天列表虚拟化真正生效：给 Virtuoso 有界视口（`h-full` + `height: 100%`），屏外 `ChatRow` 不再整树挂载。
- 仅末条流式行挂 ResizeObserver；历史行不再每人一个尺寸观察器。
- `computeItemKey` 使用 `message.ts`，展开/折叠与回收在追加、压缩后仍对齐。
- 用户消息轨道改为单例悬停预览，不再为每条刻度预挂 Tooltip 正文；跳转刻度仍全量。
- 并行子代理面板使用同样的有界 Virtuoso 视口。
- 工作区文件列表与代码索引不再自建递归 `**` 监视，改用编辑器文件事件（create/delete/rename/save），避免绕过 `files.watcherExclude` 把 node_modules/.git 钉进 inotify。
- FileContextTracker 不再挂整树 `**` change watcher。已跟踪文件用 basename 定点监视 + `onDidSaveTextDocument`；node_modules/.git/EXTRA 的 churn 不再灌进 fileWatcher 进程。
- 任务进度监视以 `EXTRA/task` 为基路径、只看直接 `*.md` 子文件，避免含 `/` 的 glob 被编译成整树监视。
- 通过 `configurationDefaults` 贡献 `files.watcherExclude`，堵住 VS Code 默认监视对增长目录的洞：包仓库（`.pnpm` / `.bun` / `.yarn/cache`）、构建缓存（`.vite` / `.cache` / `.turbo` / `.next`）、Git object/LFS、以及 `EXTRA/output`。源码、`EXTRA/task` 进度 Markdown、MCP 配置仍被监视。VS Code 内置 `**/node_modules/*/**` 匹配不到点目录，所以 DeepTask 停掉自建递归监视后，这些树仍会被默认监视钉进 inotify。目录 inode 必须单独排除（`**/.git/objects`、`**/node_modules/.pnpm`、`**/EXTRA/output`、`**/artifacts`）：递归 `/**` glob 不会覆盖目录自身。
- 重启后采样（2026-10-30T19:08+08）：fileWatcher inotify **1394**（unique 1385），`nm_pnpm=0`，`EXTRA/output=0`，fileWatcher RSS **114.6MiB**，extensionHost RSS **1319MiB**。剩余 `nm_other=215` 是各包的 `node_modules` 顶层目录，不是 `.pnpm` 仓库。源码树（`src`/`apps`/`packages`/`webview-ui`）仍被监视。不声称永久消除灰屏。

## 明确不改

- 磁盘存储与模型输入仍保留全文。
- 历史命令输出继续用 9.2.8 的展示投影；展开后按时间戳取回原文。
- 不裁 `apiConversationHistory`，不调高 heap，不关掉 90% 告警。

## 受控验证

- `UserMessageRail.spec.tsx`：6 项通过（含单例悬停预览）。
- `ChatView.spec.tsx`：37 项通过、12 项既有跳过（含有界视口断言与 stick-to-bottom / 跳转回归）。
- `ChatRow` 相关：5 个文件 18 项通过。
- 监视器：`WorkspaceTracker` + code-index `file-watcher` + `FileContextTracker.shared-watcher` + `ParallelManager` 共 67 项通过（workspace 文件事件、定点 basename 监视、收窄 worktree 监视，不再创建递归 `**` watcher）。

## 验证边界

- 安装文件校验不等于现有扩展宿主已加载新代码；重载前仍可能运行旧版本。
- 未完成用户现场超长会话灰屏复现；不声称永久消除灰屏或零缺陷。
