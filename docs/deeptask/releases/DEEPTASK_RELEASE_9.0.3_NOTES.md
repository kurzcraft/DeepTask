# Deeptask 9.0.3

本补丁修复任务进度清单首次创建、同一对话连续工作和任务完成后首条消息的状态边界：

- 首个模型创建的 `EXTRA/task/*.md` 文件在 marker 使用宿主任务 ID、而不是内部 Task UUID 时，可通过唯一活动候选完成验证绑定，不再要求第二次人工修改 marker。
- 原生 TODO 只读取已验证的权威 Markdown 清单；绑定成功后持久化文件路径和 marker 身份，保留任意嵌套层级并拒绝歧义的多文件候选。
- 同一对话的后续可执行需求继续扩展原清单文件和原 marker，不再为每一轮创建新的 `host-task-id:work-instance-id` 文件。
- 任务完成后的第一条用户消息继续进入可恢复工作轮次，保留原文与必要附件，避免被旧完成态、空消息路径或重复消费吞失。
- 更新中英文项目 README、插件打包内 README、安装命令和 Marketplace 介绍页至 9.0.3。

## 验证

- 首清单门禁定向回归：3 个测试文件，137 项通过，4 项跳过。
- 完成态消息回归：3 个测试文件，195 项通过，4 项跳过；覆盖普通首消息、带附件消息、过期 ask 和连续恢复载荷。
- 仓库 lint：18 个 workspace 全部通过。
- VSIX manifest、扩展入口、任务进度协议标记和 Marketplace README 校验通过。
- VSCodium 安装验证：`deeptask.deeptask@9.0.3`，无 stale 安装目录。
- 代码提交：`2e50056a4bcd3a85e00198f75e54c408a1c6537a`。

## 产物

- 文件：`deeptask-9.0.3.vsix`。
- 大小：40,433,717 字节。
- SHA-256：`e9d6cdcd501f2f1259ba419ca58a15b0663850b2e64ddbc2ef7a06217608d47d`。
- Release：<https://github.com/kurzcraft/DeepTask/releases/tag/v9.0.3>。
