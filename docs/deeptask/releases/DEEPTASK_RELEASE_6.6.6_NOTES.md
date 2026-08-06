# Deeptask 6.6.6

本版本强化长任务中的终端保留、任务续发与交付一致性：

- 修复强制继续或发送新反馈时错误裁剪正在运行的集成终端。
- 终端数量设置仅约束已完成终端；运行中的服务器、监听器和长命令不计入限制，也不会被自动关闭。
- 修复快速命令（例如 `echo test-terminal-ok`）的 shell-integration 事件乱序：即使 shell 结束事件先于开始状态到达，当前命令仍会收到权威终态、返回工具结果并让 Agent 自动继续。
- 命令完成、Shell 退出和兜底终态都会触发已完成终端收敛，避免事件竞争导致数量持续超出设置。
- 上下文压缩后继续以最新用户扩展或修订为工作焦点，同时保留已验证完成的历史事实。
- README、扩展清单与交付文件名统一到 6.6.6。

## 验证

- 快速命令 end-before-start 回归已覆盖并通过：shell-end 会向当前 process 发布 exit code 0，不再因 `running=false` 丢失终态。
- 终端定向回归通过：`TerminalProcessExec.bash` 13 passed / 1 skipped、`TerminalRegistry` 23 passed、`TerminalProcess` 20 passed、`executeCommand` 13 passed。
- 扩展类型检查通过；ChatView 命令状态回归 28 passed / 12 skipped。
- 十阶段 VSIX 构建、覆盖安装 VSCodium、安装 bundle 比对与 GitHub Release 资产校验将在发布时重新执行。

## 产物

- 文件：`deeptask-6.6.6.vsix`
- 大小：40,415,704 字节。
- SHA-256：`9a7080699782bb77cbea4b4b4aa5b4245cca85f3211c5a0907c1f2536f15a814`。
- 根目录、`bin/`、VSCodium 安装 bundle 与 GitHub Release 资产均已完成一致性校验。
