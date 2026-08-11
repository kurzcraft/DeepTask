# Deeptask 9.0.4

本补丁修复原生 TODO 同步在已归档任务清单之后永久拒绝更新的问题：

- 当持久化的 `EXTRA/task/*.md` 绑定已被移动到 `EXTRA/task/finished/` 或删除时，宿主清除过期路径和 marker 身份。
- 同一次同步调用继续扫描活动目录；仅有一个格式有效的活动清单时，立即重新绑定并持久化新的路径和 marker。
- 多候选仍维持拒绝语义，避免归档清理错误地选择不确定的任务清单。
- 已失效绑定不再导致后续 `update_todo_list` 无限返回“无已验证任务文件”。
- 更新中英文 README、打包内 Marketplace README、安装命令与版本历史至 9.0.4。

## 验证

- `src/core/task/__tests__/Task.spec.ts`：127 项通过，4 项跳过。
- 新增回归覆盖：归档旧绑定、唯一活动清单重绑定、历史持久化字段清除和重写、歧义候选拒绝。
- VSIX manifest、安装验证、产物大小和 SHA-256 在打包后补充。

## 待发布产物

- 文件：`deeptask-9.0.4.vsix`。
- Release：<https://github.com/kurzcraft/DeepTask/releases/tag/v9.0.4>。
