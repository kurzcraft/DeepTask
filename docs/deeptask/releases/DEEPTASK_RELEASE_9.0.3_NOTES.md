# Deeptask 9.0.3

本补丁修复任务进度清单首次创建、同一对话连续工作和任务完成后首条消息的状态边界：

- 首个模型创建的 `EXTRA/task/*.md` 文件在 marker 使用宿主任务 ID、而不是内部 Task UUID 时，可通过唯一活动候选完成验证绑定，不再要求第二次人工修改 marker。
- 原生 TODO 只读取已验证的权威 Markdown 清单；绑定成功后持久化文件路径和 marker 身份，保留任意嵌套层级并拒绝歧义的多文件候选。
- 同一对话的后续可执行需求继续扩展原清单文件和原 marker，不再为每一轮创建新的 `host-task-id:work-instance-id` 文件。
- 任务完成后的第一条用户消息继续进入可恢复工作轮次，保留原文与必要附件，避免被旧完成态、空消息路径或重复消费吞失。
- 更新中英文项目 README、插件打包内 README、安装命令和 Marketplace 介绍页至 9.0.3。

## 验证

- 任务进度绑定与完成门禁回归：`src/core/task/__tests__/Task.spec.ts`，125 项通过，4 项跳过。
- 系统提示和自定义指令回归：2 个测试文件，60 项通过。
- VSIX 版本、manifest、扩展入口、Marketplace README、安装结果和 SHA-256：打包与安装后回填。
- GitHub `main` 远端提交、tag、Release URL 和资产：推送与发布后回填。

## 产物

- 文件：`deeptask-9.0.3.vsix`。
- 大小：打包后回填。
- SHA-256：打包后回填。
- VSCodium 安装验证：安装后回填。
- 提交：推送 `main` 后回填。
- Release：发布后回填。
