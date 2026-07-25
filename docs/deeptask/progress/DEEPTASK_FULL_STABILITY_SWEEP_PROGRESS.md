# DeepTask 全面功能检查与稳定化进度

## 检查清单

- [x] 查询 universe-memory 与现有项目进度文件
- [x] 建立本轮全面检查范围与基线
- [x] 执行静态检查、类型检查和关键测试
- [x] 定位并修复当前失败点
- [x] 补充或更新回归测试
- [x] 打包 VSIX
- [x] 安装到 VSCodium 并确认版本
- [-] 存储本轮经验到宇宙记忆

## 当前发现

- Obsidian 记忆搜索 `Deeptask VSCodium bug 稳定 打包 安装 终端 完成 循环` 未命中直接记忆；宽泛搜索 `Deeptask` 主要命中 VSCodium 备份文件。
- 工作区已有多份 Deeptask 修复进度，近期高频缺陷集中在终端命令完成/继续、attempt_completion 完成后循环、任务进度文件默认值、上下文压缩与打包发布流程。
- `scripts_package_deeptask_vsix.sh` 是现有固定打包入口；历史验证安装命令为 `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force`。
- `pnpm lint` 发现唯一失败点：`webview-ui/src/components/chat/ChatView.tsx` 的 `useCallback` dependency 包含未在回调中直接读取的 `canSendWhileWaitingForCommandOutput`，因 `--max-warnings=0` 导致失败。
- 已修复：移除该多余 dependency。该变更不改变运行时逻辑，只清理 React hook lint 警告。

## 本轮策略

- 先建立可复现基线：检查 git 状态、版本、脚本入口，再运行核心测试。
- 优先覆盖已知脆弱面：终端执行、工具继续、任务完成、prompt/设置默认值、webview 消息队列。
- 只修复本轮能证实的缺陷；用户后续反馈的新运行时 bug 继续按同一循环修复、打包、安装。

## 验证记录

- `cd src && pnpm test integrations/terminal/__tests__/TerminalProcess.spec.ts integrations/terminal/__tests__/TerminalRegistry.spec.ts core/tools/__tests__/executeCommandTool.spec.ts core/prompts/__tests__/system-prompt.spec.ts core/prompts/sections/__tests__/custom-instructions.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts` 通过，6 files passed，136 tests passed。
- `pnpm check-types` 通过，22 tasks successful。
- `pnpm lint` 首次失败，仅 `webview-ui/src/components/chat/ChatView.tsx` 1 个 React hook warning。
- `cd src && pnpm test core/condense/__tests__/index.spec.ts` 通过，1 file passed，42 passed，3 skipped。
- `pnpm lint` 复跑通过，18 tasks successful。
- `pnpm check-types` 复跑通过，22 tasks successful。
- `cd src && pnpm test integrations/terminal/__tests__/TerminalProcess.spec.ts integrations/terminal/__tests__/TerminalRegistry.spec.ts core/tools/__tests__/executeCommandTool.spec.ts core/condense/__tests__/index.spec.ts core/prompts/__tests__/system-prompt.spec.ts core/prompts/sections/__tests__/custom-instructions.spec.ts core/webview/__tests__/webviewMessageHandler.spec.ts` 复跑通过，7 files passed，178 passed，3 skipped。
- 打包通过：`bash scripts_package_deeptask_vsix.sh` 生成并验证 `deeptask-5.5.0.vsix`，大小 42,398,335 bytes。
- 安装通过：`codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force`；扩展列表确认 `deeptask.deeptask@5.5.0`。

## 阻塞

- 暂无。
