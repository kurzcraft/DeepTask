# 命令运行完卡住不继续：通用修复

## Checklist

- [x] 查询记忆并定位命令完成链路
- [x] 复现/构造回归测试，确认受影响命令类型
- [x] 修复通用命令完成后无法继续问题
- [x] 运行定向测试并检查依赖文件
- [x] 更新 universe-memory

## 新增任务：压缩 API 中断恢复

- [x] 查询 API stream timeout 与上下文压缩记忆
- [x] 定位压缩失败结果泄漏到普通推理的路径
- [x] 将手动 condense 改为失败不提交的事务语义
- [x] 添加 API timeout 回归测试
- [x] 运行压缩/上下文/任务测试与类型检查
- [x] 打包、安装 VSCodium、覆盖发布 v5.5.0
- [x] 更新 universe-memory

## 当前结论

- 用户看到的 `API stream timed out ... no model output was received` 可能来自压缩请求或主任务请求，不能仅凭文案判断来源。
- 手动压缩工具此前先推送成功结果，再调用摘要 API；摘要失败时会把失败操作泄漏成成功并继续普通推理。
- 修复后，手动压缩只有在摘要成功且历史写回完成后才推送成功结果；失败只发送 `condense_context_error`，原始历史保持不变。
- 自动压缩已有 sliding-window fallback；本轮不改变自动 fallback 语义，避免把可恢复的截断路径误改成阻断。

## 验证

- 用户复合命令真实退出码：0。
- 命令/终端回归：33 passed。
- 压缩、上下文管理、任务、condenseTool 回归：161 passed，7 skipped。
- 类型检查：22 个任务成功。
- 依赖：未重新安装，无 requirements.txt 变更。

## 当前线索

用户命令是 `py_compile && python heredoc` 的复合诊断命令。已有历史表明主要风险在：

- `TerminalProcess` 的 shell stream / shell-execution-complete 顺序
- `ExecuteCommandTool` 的 `command_output` advisory ask
- 完成后 `process.continue()` 与任务 loop 的衔接
- 复杂 heredoc/管道命令的非零退出或无输出路径

## 记忆结论

完成信号必须分层收敛：shell exit、stream close、process promise、command_output ask 均不能单独成为无限等待的必要条件；有限命令在 shell 已退出或 stream 已关闭后必须在有限时间内向模型返回工具结果。
