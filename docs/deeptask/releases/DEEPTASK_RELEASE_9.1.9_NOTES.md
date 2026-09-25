# Deeptask v9.1.9 发布说明

## 新功能

### 1. Agent 模式自管理（`manage_mode` 工具）

Agent 现在可以在对话中直接管理模式，无需用户手动到设置界面操作：

- **创建全新模式**：`action=create`，可配置全部参数：
  - `slug`（自动规范化为 `^[a-zA-Z0-9-]+$`）、`name`
  - `role_definition`（角色定义）、`when_to_use`、`description`
  - `custom_instructions`
  - `groups`（JSON 数组，支持 `["read","edit"]` 与 `[["edit",{"fileRegex":"\\.md$","description":"..."}]]` 两种形式，带正则校验）
  - `icon_name`
- **复制现有模式**：`action=copy` + `copy_from`，从任意现有模式（内置或自定义）复制，未显式给出的字段继承源模式，slug/名称自动加 `-1`、`-2`… 后缀避免冲突；显式参数覆盖继承值。这正是"修改已有模式通过复制改名实现"的路径。
- **更新现有模式**：`action=update`，在原位合并修改自定义模式；对内置模式的修改以同 slug 的自定义覆盖模式持久化（`getAllModes` 合并语义）。
- **列出全部模式**：`action=list`，返回 slug/名称/来源（builtin/global）/描述/何时使用/工具组/图标与当前模式。
- **切换模式**：`action=switch`。
- **默认写完即切换**：`create/copy/update` 默认（`switch_after` 非 `"false"`）在写入后立即调用 `handleModeSwitch`，当前运行实时更改为新模式。
- 所有写操作走与 UI 相同的审批流（`askApproval`），用户保留最终控制权。

## Bug 修复

### 1. 取消按钮变灰卡死（推理无法停止）

- 前端：cancel-armed 死信看门狗保留强制控制行；`hasVisibleControl` 在 cancel-armed 窗口不再把冻结的 `isStreaming` 视为"可见控制"；常规 Cancel 按钮在 cancel-pending-stuck 状态保持可点击。
- 后端：`Task.abortTask` 中的 `saveClineMessages` 历史持久化加了超时界限，慢速磁盘 I/O 不再阻塞取消路径。

### 2. 点击历史条目跳转后无法自由滚动（回弹）

- 鼠标滚轮（双向）、触摸（双向）、方向键/翻页键（ArrowUp/Down、PageUp/Down、Home/End）任意一次用户主动滚动都会同时释放 sticky-follow 与 pinnedJump 钉住目标。
- 行高变化与新内容到达不再把视口重新钉回跳转点；只有滚动到底部才重新启用自动跟随。

### 3. 设置保存按钮机制问题 + 角色定义仅粘贴有效

- `SettingsView.handleSubmit` 保存后不再用**过期的** extensionState 快照覆盖 cachedState（旧值把刚保存的内容冲掉、`isChangeDetected` 恢复异常），改为等待后端保存后的新鲜状态广播。
- 模式编辑三个文本字段（角色定义/描述/何时使用）改为**本地草稿单一显示源**：聚焦期间 textarea 完全由本地草稿驱动，不再与后端回显打架（修掉跳到末尾、改不动）；失焦或 400ms 防抖后提交，切换/重置模式时清空草稿，打字体验与普通 textarea 一致。

### 4. 助手消息右侧编辑按钮 100% 覆盖

- `ChatRow` 的 text 与 completion_result 行：编辑按钮现在渲染在所有已落定的行上（仅当该行是最后一行且正在流式输出时隐藏），并把 hover-only `opacity-0` 改为常显 `opacity-60`，确保任何时候都能找到并点击编辑按钮。

### 5. manage_mode 默认免审批

- `manageMode` 加入与 `switch_mode` 共享的模式切换自动批准（默认开启），agent 在任务中创建/复制/更新/切换模式不再弹审批框。

### 6. 新窗口误显其他窗口任务"运行中"

- 实时任务快照新增真实 `isActivelyRunning` 标志（任务结算后冻结为 false），协调器在任务结算时将其移出共享存储，读取方信任快照真实值而非硬编码运行态——新开窗口的文件夹栏不再出现幽灵"运行中"任务。

## 测试

- 新增 [`src/core/tools/__tests__/ManageModeTool.spec.ts`](src/core/tools/__tests__/ManageModeTool.spec.ts)：17 个用例覆盖 list / create（含 switch_after=false）/ create 重名拒绝 / copy -1/-2 递进 / copy 显式覆盖（含 fileRegex 工具组）/ copy 源不存在 / update 合并与内置覆盖 / update 未知模式 / switch 成功·同模式·无效 / 未知 action / 缺参 / 审批拒绝。
- 新增/更新 [`LiveTaskCoordinator.spec.ts`](src/core/kilocode/parallel/__tests__/LiveTaskCoordinator.spec.ts)：5 用例覆盖快照 isActivelyRunning 过滤、结算移除、过期任务冻结。
- 既有测试更新：`ModesView.spec.tsx` 的 prompt 变更用例改为等待 400ms 防抖后的 `updatePrompt` 消息（10/10 通过）。
- `src` 与 `webview-ui` 的 `tsc` 类型检查全部通过；受影响的 webview 测试套件全绿，ClineProvider 取消路径测试 19/19 且无 unhandled rejection。

## 升级

- 从 [GitHub Releases](https://github.com/kurzcraft/DeepTask/releases/latest) 下载 `deeptask-9.1.9.vsix`。
- VSCodium：`codium --install-extension ./deeptask-9.1.9.vsix --force`
- VS Code：`code --install-extension ./deeptask-9.1.9.vsix --force`
