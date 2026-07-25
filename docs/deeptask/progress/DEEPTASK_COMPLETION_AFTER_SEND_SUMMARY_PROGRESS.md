# DeepTask 完成后发送消息误发结束总结修复进度

## 用户反馈

- 任务结束后继续发送消息时，模型没有继续执行新任务，而是发送结束总结。
- 要求：必须杜绝完成态后续发消息走结束总结路径。

## 已知历史

- 之前修过完成态 continuation 复用旧 `attempt_completion` 工具上下文的问题。
- 之前修过任务结束后发送消息卡死、取消删除后继续按钮消失等状态问题。
- 本轮需要进一步确认完成态后“用户新消息”是否仍带有完成提示、旧工具结果、或前端/后端误判为任务收尾响应。

## 检查清单

- [x] 查询 universe-memory 与历史进度文件
- [x] 创建本次修复进度文件
- [x] 定位完成后发送消息的前后端状态流
- [x] 实现强制续跑修复，避免返回结束总结
- [x] 添加回归测试覆盖完成后新消息续跑
- [x] 运行聚焦测试与必要质量检查
- [x] 打包并安装到 VSCodium
- [ ] 存储经验并汇报

## 定位结论

- `src/core/webview/webviewMessageHandler.ts` 原先只在最后一条 `clineMessages` 是 `ask:completion_result` 时，把用户新输入路由到 `continueTaskFromUserMessage()`。
- 完成结果后如果又追加了普通文本、可见总结或其他状态消息，后端会误把新输入交给旧 `handleWebviewAskResponse()`，模型容易沿用收尾路径再次总结/结束。
- `src/core/task/Task.ts` 的直接续发清理函数只剥离最后一条或倒数第二条 `attempt_completion`，无法清掉 `attempt_completion` 之后的普通 user/text 尾部污染。

## 修复记录

- `src/core/webview/webviewMessageHandler.ts`：完成态判断改为历史中存在非 partial 的 `completion_result`，非空用户输入一律优先作为新 continuation 处理，不再要求 completion 是最后一条消息。
- `src/core/task/Task.ts`：`stripCompletedAttemptCompletionFromHistory()` 改为查找最后一个 `attempt_completion` assistant 消息，并截断其后的全部 API 历史尾部。
- `src/core/webview/__tests__/webviewMessageHandler.spec.ts`：新增完成结果后又出现普通文本时仍必须路由到 continuation 的回归测试。
- `src/core/task/__tests__/Task.spec.ts`：新增 `attempt_completion` 后存在 stale feedback 尾部时，续发必须清理完成尾部的回归测试。

## 验证状态

- `pnpm --dir src test core/webview/__tests__/webviewMessageHandler.spec.ts core/task/__tests__/Task.spec.ts`：通过，2 files passed，85 passed，4 skipped。
- `pnpm lint`：通过。
- `pnpm check-types`：通过。
- `bash scripts_package_deeptask_vsix.sh`：通过，生成 `deeptask-5.5.0.vsix`，校验大小 42,402,194 bytes。
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force && codium --list-extensions --show-versions | rg '^deeptask\.deeptask@'`：通过，确认 `deeptask.deeptask@5.5.0`。
