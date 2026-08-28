# Deeptask 9.1.3

- Windows 默认集成终端为 `cmd.exe` 时命令开箱即用：插件检测到 cmd 默认 profile 后，直接走带完整 stdout/stderr 与真实退出码的子进程执行器，不再等待永远不会出现的 OSC 633;A shell 集成握手、不再 5 秒超时失败；`echo`、`.bat/.cmd`、`.ps1` 安装后第一条命令即可执行，无需修改任何 VS Code / VSCodium 设置。
- Windows 上 shell 集成初始化超时（PowerShell profile 慢、集成被禁用、扩展宿主卡顿）自动降级为子进程直接执行命令并回收输出与退出码，不再让 `execute_command` 失败；非 Windows 平台保持原有行为。
- 系统提示词加入硬性命令规范：超过 4 行的命令必须先写成脚本文件再用一行命令执行；含内嵌文档文本、嵌套引号、JSON/YAML/SQL 载荷、特殊数据管道等可能导致终端卡死结构的命令同样必须脚本化，防止终端挂起不返回。
- 消息编辑不再被静默丢弃：目标行已被前次 rewind 移除时，编辑内容以 edited_resend 续发方式投递；助手行编辑在 API 历史无法匹配时仍替换可见行并记录诊断日志，"编辑发送无反应"消除。
- 任务完成后继续发消息不再删除绿色完成总结：续发仍严格回滚 API 历史，但面板保留已展示的 completion 行。
- 新增 `manage_provider_profile` 工具：模型可列出、创建、更新提供商配置（provider、endpoint、key、模型、上下文窗口、原始 settings 字段）、重命名，并可直接切换自身推理强度（含关闭）；列表输出对密钥脱敏，所有变更均经用户确认。
- cmd/降级子进程执行的完整过程现在实时回显到集成终端：空的 shell 终端被替换为伪终端（pseudoterminal）转录视图，显示命令行、实时 stdout/stderr、退出码与用户中止（^C），模型侧捕获与退出码不受影响，终端不再只剩横幅与提示符。
- `manage_provider_profile` 的所有操作（含推理强度切换）随默认开启的配置切换审批门控自动批准，左下角推理强度弹窗不再触发审批提示。
- 推理强度在当前活动 profile 上变更时立即同步：界面选择器与下一次进行中的请求都读到新值，无需重新激活 profile。
- 任务完成后的即时回复现在作为续发轮次投递：模型直接回应用户的新消息，不再用空的完成总结直接结束任务。
- 更新中英文 README、扩展包内 Marketplace 介绍页、安装命令和版本信息至 9.1.3。

安装：

```bash
codium --install-extension ./deeptask-9.1.3.vsix --force
```
