# Deeptask 9.0.6

本补丁修复工具调用永不返回、异常路径或工具迟到时导致任务状态机卡死的问题：

- 为普通工具、动态 MCP 工具和自定义工具执行增加显式有界超时；超时会生成模型可见的错误并释放 presenter 锁，后续任务轮次仍可继续。
- 在工具执行被拒绝、抛出异常、清理浏览器失败或等待结果超时时，保留错误上下文并执行有限恢复，不再把未结算的异步操作留给任务循环。
- 对当前轮次所有带 ID 的 `tool_use`/`mcp_tool_use` 补发唯一错误 `tool_result`，保证 native 工具协议闭合；迟到结果会被去重，避免重复 ID 或缺失结果再次阻塞模型。
- 为永不结算的自定义工具和旧 unknown-tool fixture 增加回归覆盖，并通过扩展 bundle 与全仓类型检查。
- 更新中英文 README、扩展包内 Marketplace 介绍页、安装命令和版本信息至 9.0.6。

## 验证

- `presentAssistantMessage-unknown-tool.spec.ts`、`presentAssistantMessage-custom-tool.spec.ts`、`Task.spec.ts`：147 项通过，4 项跳过。
- 扩展 bundle 构建成功；全仓 `check-types`：22 个任务成功。
- `git diff --check` 通过。
- 发布阶段将复验 VSIX manifest、扩展入口、工具防卡死标记、包内 README、VSCodium 安装版本和 GitHub Release 资产。

## 待发布产物

- 文件：`deeptask-9.0.6.vsix`。
- Release：<https://github.com/kurzcraft/DeepTask/releases/tag/v9.0.6>。
