# Deeptask 9.2.4 Release Notes

## 核心变更：new_task 并入 dispatch_subagents（9.2.4 子代理时代）

### 工具合并
- `new_task` 工具与 `/newtask` slash 命令移除；`dispatch_subagents` 成为唯一子任务工具：单个干净上下文任务 = 单元素 `tasks` 数组，多并行 = 多元素数组。
- 继承 new_task 全部体验：任务提示词窗口展示、自动跳转子代理界面、单个完成自动跳下一个、全部完成自动回主任务。

### 每任务覆写
- 每个子代理任务条目可指定 `mode` / `provider_profile` / `model_id`；未指定字段继承父代理当前配置。
- 读图子任务直接在任务条目写 `provider_profile:"AIHUBMIX-VL", model_id:"deepseek-v4.1-flash"`，主对话无需切换 provider。

### 身份注入（本次实测修复）
- `ParallelManager.spawn` 填充 `parentIdentity`（父代理 mode/provider/model）。
- `Task.getSystemPrompt` 为每个子代理前置 `# Agent Identity (runtime-injected)` 横幅（自身 mode、provider profile、model、depth、父链），子代理无需在提示词自报配置。
- `environment_details` 的 Current Mode 改用任务自身锁定模式（`Task.getTaskMode()`），子代理 mode 覆写后不再显示父会话模式。

### 门禁豁免（9.2.3 已修，9.2.4 验证）
- 统一谓词 `Task.isChildAgent` 覆盖三条委托路径（parentTaskId / AGENT_CONFIG / subagent 字段），子代理 attempt_completion 不再被根会话完成门禁、失败工具拒绝、cheat 检测误伤。

### UI 完整性（本次修复）
- `dispatch_subagents` / `workspace_status` / `workspace_create` / `workspace_merge` 补全 transcript 卡片与图标（hub / repo / repo-create / git-merge）+ EN/zh-CN 文案。
- 自动批准面板"Subtasks"开关更名为"Subagents"（en / zh-CN / zh-TW），语义对齐 dispatch_subagents；移除与能力层撞名的 `alwaysAllowSubtasks` 卡片，面板图标统一为 lucide-react 组件。
- 各子代理提示词以带编号卡片展示（newTask ask 卡风格），结果逐代理回卡到主任务（`subtask_result` payload）。
- 派发后自动跳转子代理界面、单个完成自动跳下一个 running、全部完成自动回父任务（jumpToSession + completionWatchers）。

### 恢复按钮修复（本次修复）
- 输入框有文本时点击"恢复任务"按钮：按钮路径改发 `messageResponse`（与回车一致），文本随恢复一起送达，不再被吞。

### 其他修复
- `delete_file` 所有被阻断路径统一走批准询问（展示 blockedReason），批准即强制删除、拒绝即取消。
- 修复 evolve-N 自动升级未生效（getSystemPrompt 改用 `_taskMode` 并等待 `taskModeReady`）。
- 修复归档后全 completed 的 `update_todo_list` 同步被 "No verified task progress file" 阻断（归档宽限）。
- 内置 evolve 模式提示词写入项目 GitHub 地址；进化日志纪律（只在 manage_mode 固化修正时写入）。
- `ask_followup_question` 默认启用。

## 安装

```bash
codium --install-extension ./deeptask-9.2.4.vsix --force
# 或 VS Code
code --install-extension ./deeptask-9.2.4.vsix --force
```
