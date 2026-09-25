# Deeptask v9.2.0 发布说明

## 新功能

### 1. evolve 自动接续（自进化不死锁）

- 对 `evolve` 系列模式（`evolve` / `evolve-N`）执行 `action=update` 时，自动 fork 出下一个副本（`evolve-2` → `Evolve-3`、`evolve-3` → `Evolve-4`…），新副本从内置 Evolve 原型提示词起步并携带本次更新的个性化配置。
- fork 时把谱系（fork 时间、来源、用途）追加记录到 `~/.deeptask/MACHINE_LINEAGE.md`，跨对话可追溯。
- 默认写完立即切换到新副本，当前运行实时更改为进化后的模式；被更新的原模式保持不动，永不覆盖正在使用的活动模式。
- `action=copy` 的默认显示名自动去掉旧的 `-N` 后缀（新序号由 slug 追加逻辑对齐），fork 标签序号不再跳号。

### 2. 模式文件单一事实源治理（`MODE_FILE_GOVERNANCE_RULE`）

- 新增导出常量 `MODE_FILE_GOVERNANCE_RULE`（`packages/types`）：模式配置文件（custom_modes.yaml / .deeptaskmodes / .kilocodemodes / .roo modes markdown）是结构化状态存储，**只能**通过 `manage_mode` 工具修改，绝不允许脚本/sed/awk/python 或文件写入工具直接改。
- 同一常量同时注入三处：内置 evolve 提示词、XML 版 `manage-mode` 工具描述、native 版 `manage_mode` 工具描述——agent 面对的规则与工具实际行为物理上共享同一字符串，永不漂移。

## 新功能（续）

### 3. 连续工具错误默认不限次运行

- `DEFAULT_CONSECUTIVE_MISTAKE_LIMIT` 3 → 0（0 = 不限制）：默认持续运行，不再因连续工具错误自动停止任务；仍可在设置中显式配置上限。
- 新增 migration `consecutiveMistakeLimitUnlimitedMigrated`：存量配置里的旧默认值 3 自动归零，用户显式设置的值原样保留。

### 4. 代理行为设置弹窗默认打开"模式"标签

- 左下角"代理行为"弹窗（[`KiloRulesToggleModal.tsx`](webview-ui/src/components/kilocode/rules/KiloRulesToggleModal.tsx)）默认标签由"规则"改为"模式"，打开即可见模式列表。

## Bug 修复

### 1. 子代理被完成门禁卡死

- 根因：完成门禁的 `getIncompleteTaskProgressItems` 扫描整个工作区的任务进度文件，而子代理（`dispatch_subagents` / `new_task`）与主任务共享工作区目录，且从不拥有外层任务文件——子代理的 `attempt_completion` 被外层未完成清单永远阻塞。
- 修复：统一豁免谓词 [`Task.isChildAgent`](src/core/task/Task.ts) 一次性覆盖全部三条委派路径——元数据委派子任务（`parentTaskId`）、fork 出的 agent-runtime 子进程（`AGENT_CONFIG` 环境变量）、**同进程 parallel 子代理（`subagent` 字段，dispatch_subagents 实测仍被卡死的遗漏路径）**。五处豁免点（`AttemptCompletionTool` execute + handlePartial、`promoteLastAssistantTextToSoftCompletion`、`syncTaskProgressWithTodoList`、`refreshNativeTodoListFromTaskProgressFile`）全部换用该谓词，子代理正常结束；门禁对真实顶层工作仍然完整生效。

### 2. 模式文件写入事务化（坏写入不再摧毁模式库）

- `CustomModesManager.updateModesInFile` 全面事务化：
  1. 读取原文；文件已存在但解析/schema 校验失败 → **中止写入**，保护现存模式；
  2. 内存操作后重校验、序列化往返验证（写出→读回一致才继续）；
  3. 写 `.bak` 备份；
  4. tmp 文件 + 原子 `rename` 落盘；
  5. `rename` 失败 → 恢复原文字节。
- 一次错误写入（半截 YAML、损坏 schema）再也无法摧毁全部模式配置。

### 3. 左下角弹窗流式重渲染自关

- 模式选择器、Profile 选择器等所有共享 `SelectDropdown` 的上弹窗：outside-close 处理器忽略合成焦点事件，只响应真实指针按压——流式推理期间的频繁重渲染不再把打开的弹窗吞掉。

### 4. 设置保存提交指纹守卫

- `SettingsView.handleSubmit` 记录提交指纹；保存后的状态同步 effect 在指纹不匹配（旧快照到达）时跳过，刚保存的表单不再被过期的保存前快照覆盖，保存值必生效、保存按钮必变灰；5 秒超时兜底 + dirty 窗口自然失效。

## 测试

- 新增 [`src/core/tools/__tests__/attemptCompletionSubagentGate.spec.ts`](src/core/tools/__tests__/attemptCompletionSubagentGate.spec.ts)：6 用例覆盖三条委派路径的豁免（parentTaskId 委派子任务、fork 子进程、同进程 parallel 子代理、无标志根任务仍被拦截、流式 handlePartial 豁免）。
- 新增 [`src/core/tools/__tests__/ManageModeEvolveFork.spec.ts`](src/core/tools/__tests__/ManageModeEvolveFork.spec.ts)：3 用例覆盖 evolve-N update 自动 fork evolve-(N+1)、谱系记录、立即切换。
- 新增事务化测试（[`CustomModesManager.spec.ts`](src/core/config/__tests__/CustomModesManager.spec.ts)）：损坏文件中止写保护、tmp+原子 rename 落盘、rename 失败回滚原文，3 用例全绿。
- 基线对照实验（git stash 源码改动后重跑）：上游基线 58 失败 vs 本版本 57 失败——**零新增失败**，净修复 1 个；全部剩余失败为上游 mock 环境遗留，与本轮改动无关。
- 回归全绿：`ManageModeTool` 19 + `ManageModeEvolveFork` 3 + `attemptCompletionTool` 21 + `Task.spec` 142；`packages/types` build、`src` tsc、`webview-ui` tsc 全部通过。

## 升级

- 从 [GitHub Releases](https://github.com/kurzcraft/DeepTask/releases/latest) 下载 `deeptask-9.2.0.vsix`。
- VSCodium：`codium --install-extension ./deeptask-9.2.0.vsix --force`
- VS Code：`code --install-extension ./deeptask-9.2.0.vsix --force`
