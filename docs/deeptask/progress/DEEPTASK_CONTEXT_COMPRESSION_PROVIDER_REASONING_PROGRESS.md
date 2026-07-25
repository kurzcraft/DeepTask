# DeepTask 上下文压缩 provider 错误与 reasoning 泄漏修复进度

## 检查清单

- [x] 查询 universe-memory 中上下文压缩 provider 错误与 reasoning 泄漏相关记忆
- [x] 创建并维护本进度文件
- [x] 对比早期正确压缩实现与当前实现
- [x] 定位 provider 错误传播、fallback 与 reasoning 泄漏路径
- [x] 恢复/修正上下文压缩方法
- [x] 补充 provider 错误与 reasoning 泄漏回归测试
- [x] 运行聚焦测试并打包安装验证
- [x] 存储经验并汇报

## 用户目标

- 恢复之前正确的上下文压缩方法。
- 修复压缩时 API provider 错误处理。
- 修复压缩摘要/历史中的 reasoning 泄漏。

## 初始判断

- 压缩链路重点文件包括 `src/core/condense/*`、`src/core/context-management/*`、`src/core/task/Task.ts`。
- 需要对比早期正常提交 `bf6f117` 与当前实现，避免继续叠补丁。
- provider 错误应不破坏主任务交互；压缩失败应可回退到截断或历史正确错误处理。
- reasoning 泄漏通常来自 summary 的 synthetic reasoning block、或将模型 reasoning 内容保留到压缩后的 API history。

## 验证记录

- 记忆搜索 `DeepTask 上下文压缩 provider 错误 reasoning 泄漏 summarizeConversation manageContext condense` 未命中。
- git 对比确认：早期手动 `condenseContext()` 直接调用 `summarizeConversation()`；当前曾改成调用 `manageContext()`，会把手动压缩 provider 错误混入自动上下文管理 fallback，并可能表现为滑窗截断。
- 已恢复手动压缩语义：手动压缩只执行摘要压缩；若 provider/stream 返回错误，则发送 `condense_context_error` 并返回，不改写 API 历史，不 fallback 为 `sliding_window_truncation`。
- 自动上下文管理仍保留 `manageContext()` fallback；这是自动触发的安全降级，不影响手动压缩的错误可见性。
- reasoning 泄漏防护保留：summary message 只生成 text block；native tool 需要跨边界保留 tool_use 时，不再合成 synthetic reasoning block。
- 新增/调整回归：`Task.condenseContext()` provider 错误不会 overwrite 历史，也不会发送滑窗截断；队列测试更新为当前清理 stale queue 语义。
- 聚焦测试通过：`cd /media/kurz/aleber/vscode/deeptask/src && pnpm test core/task/__tests__/Task.spec.ts core/condense/__tests__/index.spec.ts core/condense/__tests__/condense.spec.ts core/context-management/__tests__/context-management.spec.ts`，4 个测试文件通过，130 passed，7 skipped。
- 打包通过：`bash scripts_package_deeptask_vsix.sh`，生成并校验 `deeptask-5.5.0.vsix`，大小 42,398,328 bytes。
- 安装通过：`codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force`。
- VSCodium 扩展列表确认：`deeptask.deeptask@5.5.0`。
- 用户复测指出自动压缩仍有同类问题；复查确认前一轮只修复了手动 `condenseContext()`，自动 `manageContext()` 仍会在摘要 provider 失败后 fallback 到滑窗并继续携带 `error`。
- 二次修复：自动摘要失败但滑窗 fallback 成功时，`manageContext()` 不再传播 provider `error`，上层只展示 `sliding_window_truncation`，避免自动压缩继续表现为 provider 错误。
- 二次回归：`context-management.spec.ts` 中自动摘要返回错误和抛错两条 fallback 测试均断言 `result.error` 为 `undefined`。
- 二次聚焦测试通过：`cd /media/kurz/aleber/vscode/deeptask/src && pnpm test core/context-management/__tests__/context-management.spec.ts core/condense/__tests__/index.spec.ts core/condense/__tests__/condense.spec.ts core/task/__tests__/Task.spec.ts`，4 个测试文件通过，130 passed，7 skipped。
- 二次打包安装通过：`deeptask-5.5.0.vsix` 大小 42,398,322 bytes，VSCodium 扩展列表确认 `deeptask.deeptask@5.5.0`。
- GitHub Release 已重新发布：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`，资产 `deeptask-5.5.0.vsix` 大小 42,398,322 bytes。
- 经验已存入 universe-memory：`/home/kurz/Obsidian/宇宙/记忆/项目记忆/2026-07-06-Deeptask上下文压缩provider错误与reasoning泄漏修复.md`。
- 本轮已按用户后续“发布吧”与自动压缩复测反馈重新发布 GitHub Release。
