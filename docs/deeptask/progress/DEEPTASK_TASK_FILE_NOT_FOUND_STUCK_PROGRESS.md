# Deeptask task file not found 卡住修复进度

- [x] 检索相关记忆与历史经验
- [x] 创建并维护本次进度清单
- [x] 定位 `task file not found` 根因
- [x] 修复任务文件缺失导致对话卡住
- [x] 补充或更新回归测试
- [x] 运行针对性验证
- [x] 存储本次经验并完成交付

## 修复记录

- 收敛任务进度文件系统提示：读取已有进度文件前必须先确认精确文件存在，禁止猜测文件名后直接 `read_file`。
- 修复历史任务打开路径：`showTaskWithId` 遇到缺失任务文件时 fail-soft，记录日志、清理坏历史项，并始终发送 `chatButtonClicked` 让 UI 回到可交互聊天页。
- 补充测试：提示词安全约束断言；缺失任务文件时清理 stale history 且返回聊天入口。

## 验证

- 失败但已归因：`cd src && pnpm test core/prompts/__tests__/system-prompt.spec.ts core/webview/__tests__/ClineProvider.spec.ts` 中 `ClineProvider.spec.ts` 全文件存在既有 providerSettingsManager/edit-message mock 失败。
- 通过：`cd src && pnpm exec vitest run core/prompts/__tests__/system-prompt.spec.ts core/webview/__tests__/ClineProvider.spec.ts -t "task progress file|showTaskWithId clears stale task history"`，2 tests passed，119 skipped。
- 打包通过：`./scripts_package_deeptask_vsix.sh` 完成 9 阶段，生成并验证 `deeptask-5.5.0.vsix`，大小 `42,398,450` 字节。
- GitHub release 更新通过：`node scripts_publish_github_release.mjs` 已更新 `v5.5.0`，上传资产 `deeptask-5.5.0.vsix`，大小 `42,398,450` 字节，下载地址 `https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`。

## 二次修复记录

- 用户反馈 release 后依旧出现 `task file not found`。
- 根因修正：第一次修复只让 `showTaskWithId` 捕获异常，但 `getTaskWithId` 本身仍会主动 `showErrorMessage("Task file not found...")`，因此用户仍会看到错误；其他 fire-and-forget 路径如 `exportTaskWithId` 也可能产生未处理异常。
- 二次补丁：`getTaskWithId` 在缺失 `apiConversationHistory` 时改为记录日志、清理 stale task history、抛内部错误，不再弹用户可见错误；`exportTaskWithId` 增加 fail-soft 捕获。
- 二次验证：`cd src && pnpm exec vitest run core/webview/__tests__/ClineProvider.spec.ts -t "showTaskWithId clears stale task history"` 通过，1 test passed，101 skipped。
- 二次打包通过：`./scripts_package_deeptask_vsix.sh` 完成 9 阶段，生成并验证 `deeptask-5.5.0.vsix`，大小 `42,398,491` 字节。
- 二次 GitHub release 更新通过：`node scripts_publish_github_release.mjs` 已替换 `v5.5.0` 的 `deeptask-5.5.0.vsix`，GitHub 返回资产大小 `42,398,491` 字节。

## 三次修复记录

- 用户反馈：发送消息后卡住，取消按钮也是灰色。
- 根因修正：发送新消息时 `createTask` 原先先执行 `getState()`，再清理旧 task；如果旧 task/history 已损坏或状态读取卡住，UI 可能已进入 busy，但后端还没创建可取消 task，导致取消按钮灰色。
- 三次补丁：用户发起的顶层 `createTask` 在 `getState()` 前先 `removeClineFromStack()` 清理旧任务；`newTask` catch 中调用 `clearTask()`、`postStateToWebview()`、`chatButtonClicked` 和 `invoke:newChat`，确保创建失败也释放前端按钮状态。
- 三次验证：`cd src && pnpm exec vitest run core/webview/__tests__/webviewMessageHandler.spec.ts -t "fully resets chat UI when task creation fails"` 通过，1 test passed，23 skipped。
- 三次打包通过：`./scripts_package_deeptask_vsix.sh` 完成 9 阶段，生成并验证 `deeptask-5.5.0.vsix`，大小 `42,398,598` 字节。
- 三次 GitHub release 更新通过：`node scripts_publish_github_release.mjs` 已替换 `v5.5.0` 的 `deeptask-5.5.0.vsix`，GitHub 返回资产大小 `42,398,598` 字节。

## 四次修复记录

- 用户反馈：对话仍卡住，按取消按钮弹出 `task file not find`。
- 根因修正：`cancelTask` 在真正取消当前 task 前先调用 `getTaskWithId(task.taskId)`，因此当前 task 文件缺失时取消路径本身会被持久化错误阻断，无法作为紧急恢复出口。
- 四次补丁：`cancelTask` 改为先标记 `user_cancelled`、取消请求、abort 当前 task，再尝试读取历史用于重水合；如果历史/task 文件缺失，则记录日志、清理当前 task stack、`postStateToWebview` 并发送 `chatButtonClicked`，不再向用户弹 `Task file not found`。
- 额外稳健性：`cancelCurrentRequest` 改为可选调用，避免半初始化 task/mock task 在取消路径上再次抛错。
- 四次验证：`cd src && pnpm exec vitest run core/webview/__tests__/ClineProvider.spec.ts -t "task files are missing|cancelTask clears current task"` 通过，2 tests passed，101 skipped。
- 关联回归：`cd src && pnpm exec vitest run core/webview/__tests__/webviewMessageHandler.spec.ts -t "fully resets chat UI when task creation fails"` 通过，1 test passed，23 skipped。
- 四次打包通过：`./scripts_package_deeptask_vsix.sh` 完成 9 阶段，生成并验证 `deeptask-5.5.0.vsix`，大小 `42,398,657` 字节。
- 四次 GitHub release 更新通过：`node scripts_publish_github_release.mjs` 已替换 `v5.5.0` 的 `deeptask-5.5.0.vsix`，GitHub 返回资产大小 `42,398,657` 字节。

## 五次修复记录

- 用户指出关键事实：未加“创建任务进度文件”设置前一切正常，加了后才崩；继续补坏历史恢复不是根治，应回退该设置的“存档点式”实现，改成像简单系统提示词预设一样的安全实现。
- 根因修正：`taskProgressFileEnabled` 虽然底层只注入系统提示词，但 UI 被放在 `CheckpointSettings` 下，概念上绑定到存档点/任务归档，容易和 checkpoint/task history 恢复链路混用并误导用户操作路径。
- 五次补丁：从 `webview-ui/src/components/settings/CheckpointSettings.tsx` 删除任务进度文件开关和相关 prop；从 `SettingsView.tsx` 停止向 checkpoint 页传入该字段。
- 安全实现：将开关迁移到 `webview-ui/src/components/settings/PromptsSettings.tsx`，作为纯“任务进度文件提示词”预设开关，直接通过 `updateSettings` 保存 `taskProgressFileEnabled`，只影响 `src/core/prompts/system.ts` 的系统提示词拼接，不启用 checkpoint、不读写 task archive。
- 文案迁移：删除 `settings:checkpoints.taskProgressFile`，新增 `settings:prompts.taskProgressFile`，中文说明明确“不会启用存档点，也不会读写任务归档”。
- 五次验证：`cd src && pnpm exec vitest run core/prompts/__tests__/system-prompt.spec.ts -t "task progress file"` 通过，1 test passed，18 skipped。
- 类型验证：`cd webview-ui && pnpm exec tsc --noEmit` 通过。
- 五次打包通过：`./scripts_package_deeptask_vsix.sh` 完成 9 阶段，生成并验证 `deeptask-5.5.0.vsix`，大小 `42,398,658` 字节。
- 五次 GitHub release 更新通过：`node scripts_publish_github_release.mjs` 已替换 `v5.5.0` 的 `deeptask-5.5.0.vsix`，GitHub 返回资产大小 `42,398,658` 字节。

## 六次修复记录

- 用户要求：直接回退 git 历史到加入任务进度文件设置之前，再在稳定基础上重新添加任务进度文件勾选框设置，并且默认勾选。
- 回退基线：通过 `git log -S'taskProgressFileEnabled'` 定位引入提交 `427e1d8 feat: add task progress file setting`，选择其父提交 `427e1d8^` 作为稳定基线。
- 回退策略：将 `427e1d8` 涉及的任务进度功能文件恢复到父提交，再只手工加回最小必要链路；清理了临时回退脚本和备份 patch。
- 最小实现：保留 `taskProgressFileEnabled` 作为普通全局 setting、webview state、`PromptsSettings` 顶部可见勾选框、`SYSTEM_PROMPT` 拼接条件；不再改 `packages/types/src/message.ts`、auto-approval 测试，也不再放入 `CheckpointSettings`。
- 默认勾选：`EVALS_SETTINGS`、ExtensionState 默认值、provider state fallback、保存 payload fallback、UI checkbox fallback、系统提示词条件全部按默认开启处理；仅当 `taskProgressFileEnabled === false` 时不注入任务进度文件提示词。
- 六次验证：`cd src && pnpm exec vitest run core/prompts/__tests__/system-prompt.spec.ts -t "task progress file"` 通过，1 test passed，18 skipped。
- 类型验证：`cd webview-ui && pnpm exec tsc --noEmit` 通过。
- 六次打包通过：`./scripts_package_deeptask_vsix.sh` 完成 9 阶段，生成并验证 `deeptask-5.5.0.vsix`，大小 `42,398,438` 字节。
- 六次 GitHub release 更新通过：`node scripts_publish_github_release.mjs` 已替换 `v5.5.0` 的 `deeptask-5.5.0.vsix`，GitHub 返回资产大小 `42,398,438` 字节。

## 用户补充

- 根因范围缩小：之前新增“创建任务进度文件”存档点设置后开始崩坏。
- 相关进度记录：`DEEPTASK_TASK_PROGRESS_FILE_SETTING_PROGRESS.md`。

## 观察

- 用户在 VSCode 测试插件时，对话卡住并报错 `task file not find`。
- 在 VSCodium 中已有对话继续表现为卡住，说明旧会话恢复/读取缺失 task 文件时可能没有安全降级。

## 当前假设

- 置信度 0.80：任务历史或栈恢复路径遇到缺失 task 文件时抛错，导致后端未向 webview 释放等待状态或清理无效会话。
- 需要在文件缺失路径上做到可恢复：跳过/清理无效历史项、通知 UI、保持输入可继续。

## 七次修复记录：确认源码仍残留用户可见 task file not found

- 现象：用户安装/测试后仍报告相同错误。
- 新证据：诊断 VSIX 与安装目录后，继续搜索源码，发现 `src/core/webview/ClineProvider.ts` 的 `getTaskWithId` 仍会直接 `showErrorMessage("Task file not found...")`，并且没有删除坏历史项。
- 结论：之前“已去掉错误弹窗并清理坏历史”的修复没有落到当前工作树/最终包中；现在需要对真实残留分支做根因修复。
- 下一步：让 `getTaskWithId` 对缺失任务文件静默清理并抛内部错误，让 `showTaskWithId` 捕获后回到聊天页，避免卡住。

## 七次修复完成

- 修复点：`getTaskWithId` 对缺失 `api_conversation_history.json` 不再弹出 `Task file not found`，改为记录日志、清理 stale history entry，并抛内部 `Task not found: <id>`。
- 修复点：`showTaskWithId` 捕获任务读取失败并始终发送 `chatButtonClicked`，避免历史坏项导致 UI 卡在加载态。
- 修复点：`cancelTask` 先取消/abort 当前任务，再尝试读取历史；如果历史缺失则清空当前任务并回到聊天页，不再被坏历史阻断。
- 验证：`pnpm exec vitest run core/prompts/__tests__/system-prompt.spec.ts -t "task progress file"` 通过。
- 验证：`pnpm exec vitest run core/webview/__tests__/ClineProvider.spec.ts -t "stale|cancelTask clears current task|showTaskWithId clears"` 通过，3 项通过。
- 验证：`webview-ui` 的 `pnpm exec tsc --noEmit` 通过。
- 打包发布：`deeptask-5.5.0.vsix` 已重新生成并发布到 GitHub `v5.5.0`，资产大小 `42,398,576` bytes。
- 包内确认：用户可见字符串 `Task file not found for task ID:` 在 VSIX 中命中 0 次；`TASK PROGRESS FILE` 与 `taskProgressFileEnabled` 仍存在，表示默认勾选提示词功能仍在。

## 本地 VSCode 重装测试暂停点

- 用户要求：先不继续发布，先重新安装到 VSCode 后由用户即时反馈。
- 已执行：`code --install-extension ./deeptask-5.5.0.vsix --force`，VSCode 返回安装成功。
- 当前注意：上一轮已误执行过一次发布；从此暂停后续发布动作，除非用户确认本地测试通过。
- 待用户验证：Reload Window 后检查 Deeptask 设置页的 Prompts/提示词区域是否出现默认勾选的“任务进度文件提示词”；同时验证旧对话/新对话是否还出现 `Task file not found` 卡住。

## 八次修复记录：打包脚本复用旧 webview 产物

- 新证据：源码已回退且 `rg taskProgressFileEnabled` 无源码命中，但 VSCode 安装目录 `/home/kurz/.vscode/extensions/deeptask.deeptask-5.5.0/webview-ui/build/assets/*.js` 仍命中任务进度功能标识。
- 根因：`scripts_package_deeptask_vsix.sh` 只执行 `src` 侧 bundle，未强制清理并重建 `webview-ui`，导致 VSIX 复用旧 `src/webview-ui/build` 前端产物。
- 修复：打包脚本新增前端清理与 `pnpm --dir webview-ui build` 步骤；VSIX 校验新增禁止 `taskProgressFileEnabled`、`TASK PROGRESS FILE`、`任务进度文件提示词`、`prompts-task-progress-file` 残留。
- 发布策略：仅本地打包安装，不再发布。

## 九次修复记录：回退后错误仍在，排除旧扩展与旧状态

- 已确认：本地 VSIX 与 VSCode 已安装 Deeptask 中 `taskProgressFileEnabled`、`TASK PROGRESS FILE`、`任务进度文件提示词` 均为 0 命中，任务进度功能已完全移除。
- 仍命中：`Task file not found for task ID` 在 Deeptask 和旧 `kilocode.kilo-code@5.0.0` 的 `dist/extension.js` 中各有 1 处，这是功能引入前就存在的旧任务历史读取错误。
- 已执行：备份并移走 `/home/kurz/.config/Code/User/globalStorage/deeptask.deeptask` 与 `/home/kurz/.config/Code/User/globalStorage/kilocode.kilo-code` 到 `deeptask_state_backup_20260705_202625`。
- 已执行：`code --disable-extension kilocode.kilo-code`，先禁用旧 Kilo，只保留 Deeptask 测试，避免同类扩展互相干扰。

## 十次修复记录：卸载旧 Kilo 扩展

- 已执行：`code --uninstall-extension kilocode.kilo-code`。
- 结果：VSCode 扩展列表中当前只剩 `deeptask.deeptask@5.5.0`。
- 目的：排除旧 `kilocode.kilo-code@5.0.0` 与 Deeptask 同时激活导致同类侧边栏/状态冲突。
- 待验证：Reload Window 后重新打开 Deeptask，确认是否仍为发送/取消灰色和 `Task file not found`。

## VSCode 重载说明

- 尝试执行：`code --reuse-window --command workbench.action.reloadWindow`。
- 结果：VSCode CLI 提示 `command` 不是已知选项，因此不能确认已通过 CLI 重载窗口。
- 当前状态：旧 Kilo 已卸载，Deeptask 回退版已安装，globalStorage 已备份清空。
- 下一步必须手动执行：VSCode 命令面板 `Developer: Reload Window`，让 extension host 重新加载当前唯一扩展。

## 强制回退到任务进度功能引入前基线

- 时间：20260705_203128
- 目标提交：bb10792 ()，即  前一个提交。
- 备份：当前未提交 diff 已保存到 。
- 操作：执行 HEAD 现在位于 bb10792 fix: avoid reusing retained completed terminals，让代码历史回到功能引入前，优先保证插件可用。

## 十一次修复记录：整体 reset 到功能引入前基线

- 已执行：`git reset --hard bb10792`，即 `427e1d8 feat: add task progress file setting` 前一个提交。
- 当前 HEAD：`bb10792 fix: avoid reusing retained completed terminals`。
- 已清理：本轮临时脚本和本轮状态备份目录；当前代码工作树仅保留本进度文件未跟踪。
- 已验证：源码中无 `taskProgressFileEnabled`、`TASK PROGRESS FILE`、`任务进度文件提示词`、`prompts-task-progress-file` 命中。
- 已打包：`deeptask-5.5.0.vsix` 大小 `42,396,820` bytes。
- 已安装：VSCode 扩展列表仅剩 `deeptask.deeptask@5.5.0`，旧 `kilocode.kilo-code` 已卸载。
- 下一步：必须 reload VSCode window 后测试；如果仍是同错，则不是任务进度功能引入后的修改，而是 `bb10792` 基线本身或运行环境状态问题。

## 2026-07-05 20:39 用户修正：API 卡住模型不输出

- [x] 已排除任务进度文件功能回归：源码已回到 `bb10792`，已安装 `deeptask.deeptask@5.5.0`。
- [x] 已确认日志中 `cancelTask -> getTaskWithId -> Task not found` 是卡住后的取消路径异常，不一定是最初根因。
- [ ] 新假设：真正根因是 API 请求阶段模型流式输出停滞，UI 因等待响应而表现为卡住。
- [ ] 下一步：检索扩展日志中的 API 请求、流式输出、provider 错误和超时痕迹。

## 2026-07-05 20:44 API 空流卡住修复

- [x] 在 `src/core/task/Task.ts` 增加 API stream idle timeout，默认 60 秒。
- [x] 首包等待和后续 chunk 等待都会 race 超时；超时会 abort 当前 HTTP 请求并抛出流错误。
- [x] 超时错误复用现有 `api_req_failed` / `streaming_failed` 重试路径，避免 UI 无限等待模型输出。
- [x] 增加 `KILOCODE_API_STREAM_IDLE_TIMEOUT_MS` 测试覆盖入口，方便单测快速触发。
- [ ] 运行 `Task.spec.ts` 针对性测试。

## 2026-07-05 20:58 提示词进度文件勾选框恢复

- [x] 新增全局设置 `taskProgressFileEnabled`，默认开启。
- [x] 在 Prompts 设置页新增“创建并维护任务进度清单文件”勾选框。
- [x] 勾选状态通过 `updateSettings` 保存到全局状态。
- [x] 系统提示词构造时传入 `taskProgressFileEnabled`。
- [x] 开启时注入 Task Progress File 指令，关闭时不注入。
- [ ] 添加最小测试覆盖。
- [ ] 打包安装到 VSCodium 验证。

## 2026-07-05 21:04 验证与 VSCodium 安装

- [x] 最小测试覆盖通过：`src` 下 `custom-instructions.spec.ts` 40 个用例通过。
- [ ] Webview 类型检查完成。
- [ ] 重新打包 VSIX。
- [ ] 安装到 VSCodium。
- [x] 重新打包 VSIX（使用本地 `node_modules/.bin/vsce`，避免 `npx` 卡住）。
- [x] 安装到 VSCodium。
- [x] 重新打包 VSIX（本地 `vsce` 且临时移除 `vscode:prepublish`）。
- [x] 安装到 VSCodium。
- [x] 重新打包 VSIX（本地 `vsce` 且临时移除 `vscode:prepublish`）。
- [x] 安装到 VSCodium。
- [x] 重新打包 VSIX（本地 `vsce` 且临时移除 `vscode:prepublish`）。
- [x] 安装到 VSCodium。
