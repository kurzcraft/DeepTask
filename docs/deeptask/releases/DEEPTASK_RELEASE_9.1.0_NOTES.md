# Deeptask 9.1.0

本版本带来并行子代理与多工作区能力（所有任务窗口均沿用现有带集成终端的聊天界面，不使用旧 agent manager 面板）：

- **并行子代理**：`dispatch_subagents` 工具让模型一次派出最多 5 个独立子代理，各自是完整代理（独立对话、真实集成终端、检查点）；主任务阻塞等待**全部**子代理完成后才继续并汇总结果。子代理深度限制 1 层，其审批在沙箱语义下自动通过。
- **并行工作区（多分支）**：需要写文件的子代理按 `needs_workspace` 自动获得基于主分支的独立 git worktree 分支；`workspace_create` / `workspace_status` / `workspace_merge` 负责创建、查询与合并回主分支。持久化的忙闲注册表（claim/release）防止两个代理写同一工作区；合并会先自动提交工作区改动，用户检出的工作副本永不被弄脏（必要时经临时 worktree 合并），冲突时干净中止并列出冲突文件、标记 conflicted，解决后可重试。非 git 文件夹会自动 `git init` 以便创建工作树；工作区名称保持用户输入（冲突时用 `-2`、`-3`）。
- **左侧固定侧栏（文件夹 → 工作区 → 对话）**：聊天左侧新增 ZCode/DeepSeek harness 式宽侧栏，所有 VSCodium 窗口共享同一份全局文件夹列表。层级为文件夹、其下工作区、再下对话；打开窗口即从注册表与 `.kilocode/worktrees/` 加载已创建的工作区。同一工作区被占用时自动新建 sibling 工作树并把后开对话迁过去。删除工作区弹出原生确认：选择「是」强制删除 worktree 并把对话移回 main；选择「直接删除」同时删除该工作区的所有对话。
- **右侧固定停靠子窗口**：点击对话在右侧打开固定停靠（非弹窗）的详情窗格：子代理显示完整转录（与主聊天相同的 ChatRow 渲染，含终端输出，运行中可停止）。再次点击折叠。
- **用户消息快速跳转栏**：任务界面（及子代理子窗口）左侧的竖向刻度条，每条用户消息一个刻度，悬浮显示完整消息浮窗，点击滚动定位并高亮。
- **两个权限开关（默认开启）**：位于对话框上方的权限栏（Auto-Approve 按钮组，新增「子代理」「工作区」两个按钮，设置页 Auto-Approve 同步显示）：允许模型并行派出子代理 / 允许代理创建并合并并行工作区；关闭时工具提示消失且调用被拒。历史仅显示当前文件夹的对话，并按工作区分组。
- 更新中英文 README、扩展包内 Marketplace 介绍页、安装命令和版本信息至 9.1.0。

## 验证

- `src`：`WorkspaceService.spec.ts`、`ParallelManager.spec.ts`、`webviewMessageHandler.parallel.spec.ts`、`ParallelTools.spec.ts` 通过。
- `webview-ui`：`ParallelRail.spec.tsx` 通过。

## 发布产物

- 文件：`deeptask-9.1.0.vsix`（40,501,696 字节）。
- SHA-256：`4d385c0b9622636cb40f32dc5be463bd0b66e8b9c4180e3eac9f8a3c364f1a11`。
- Release：<https://github.com/kurzcraft/DeepTask/releases/tag/v9.1.0>。
