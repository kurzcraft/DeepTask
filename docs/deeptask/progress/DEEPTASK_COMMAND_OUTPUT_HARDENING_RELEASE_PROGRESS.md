# Deeptask 命令完成续推与输出落盘加固

## 目标

- 排查并修复命令完成后卡住、不继续推理、终端返回不可读的剩余路径。
- 对长命令建立系统提示词硬约束：先创建脚本文件，再执行脚本，并将 stdout/stderr 完整落盘。
- 命令 UI 仍展示可读反馈，模型始终收到确定性的完成结果或恢复指令。
- 通过回归测试后重新打包、安装 VSCodium 并更新 GitHub Release。

## Checklist

- [x] 查询 universe-memory
- [x] 审计命令执行/输出/继续推理状态机
- [x] 修复后端命令生命周期竞态
- [x] 修复前端命令完成交互竞态
- [x] 增加长命令脚本化与输出落盘系统提示
- [x] 增加测试并联合验证
- [x] changeset、提交、推送
- [x] 打包、安装、发布
- [x] 写入 universe-memory

## 当前基线

- 上一轮代码 commit：`cbc3cb7d`，随后已补进度文档提交。
- 已发布 `v5.5.0`，资产大小 42,418,084 bytes。
- 当前已存在未穷尽的命令输出修复：`ExecuteCommandTool`、`ChatView` 及对应测试。
- 本轮不重新安装依赖；若后续确需安装，将同步维护依赖清单。

## 验收矩阵

- 短命令：正常输出、空输出、stderr、非零退出。
- 长命令：持续输出、长时间静默、后台运行、用户继续、用户取消。
- Shell 形态：普通命令、管道、重定向、heredoc、嵌套 shell、脚本文件。
- 终端事件：shell end 正常、stream 先关、shell end 缺失、重复完成、输出延迟到达。
- UI：完成消息可见、输入可发送、不遗留灰色按钮、不把 finished output 当 live wait。
- 模型：每种完成路径都收到一次且仅一次终态结果，并自动继续推理。

## 根因与决策

- Shell exit 可以早于或完全替代 final-output callback；旧 fallback 在空输出时不会持久化 `command_output`，也不会确保终态 status，导致前端 active execution ID 残留。
- 重复 completion callback 会重复写最终输出；加入 completed 幂等门。
- 最终 `say: command_output` 是证据行而非交互 ask；在 execution ID 已退出时继续展示 Continue 会覆盖下一次 API 推理状态。因此退出时清理命令按钮，只在仍有 live ID 时保留。
- 系统提示与 XML/native 工具描述统一禁止直接执行 heredoc、内联多行程序和长命令，要求脚本文件 + workspace 日志 + `read_file` 验证。

## 验证结果

- 后端命令/任务/消息路由/系统提示联合：96 passed。
- Webview ChatView：18 passed，12 skipped。
- 新增 shell-only exit、空输出持久化、重复 completion 幂等、系统提示约束、退出 UI 清理回归覆盖。
- `git diff --check` 通过。

## 发布结果

- commit：`0751534d`，`origin/main...main = 0/0`。
- VSIX：`deeptask-5.5.0.vsix`，42,419,205 bytes，内容与品牌校验通过。
- VSCodium：已强制安装并确认 `deeptask.deeptask@5.5.0`。
- GitHub Release：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- Release 资产已替换：`https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`。
- 完整打包输出：`DEEPTASK_COMMAND_OUTPUT_HARDENING_PACKAGE.log`。
- Release API 输出：`DEEPTASK_COMMAND_OUTPUT_HARDENING_RELEASE.log`。
- universe-memory：`宇宙/记忆/项目记忆/2026-07-24-Deeptask命令终态闭环与长任务耐久日志.md`。
