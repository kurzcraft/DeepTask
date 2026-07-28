# Deeptask 取消自动执行命令修复与发布进度

## 目标

- 修复输入框上方自动批准菜单中“执行命令”权限关闭后仍自动执行的问题。
- “执行命令”权限关闭后，允许列表中的通配符 `*` 也不得旁路总闸；命令必须回到人工确认。
- 添加聚焦回归测试，完成类型检查、lint、打包与发行资产审计。
- 安装到 VSCodium 与 VS Code。
- 发布 GitHub Release、Visual Studio Marketplace 与 Open VSX，并验证公开资产。

## 里程碑

- [x] 查询 universe-memory；未找到精确同类记忆
- [x] 定位 UI 执行权限开关到持久化状态及命令自动批准的完整链路
- [x] 定义权限总闸与允许/拒绝列表边界
- [x] 实现执行权限关闭时禁止通配符旁路
- [x] 添加四态聚焦回归测试（4/4 通过）
- [x] 运行聚焦测试、后端类型检查和聚焦 lint
- [x] 提升补丁版本至 5.5.5 并更新 changeset/changelog
- [x] 构建、审计 Universal VSIX
- [x] 安装并验证 VSCodium 与 VS Code
- [x] 提交、推送并发布 GitHub Release
- [x] 发布并验证 Visual Studio Marketplace（用户确认已发布）
- [x] 发布并验证 Open VSX
- [ ] 独立下载三个发行通道资产并校验（GitHub/Open VSX 已完成；Visual Studio Marketplace 发布后验证受专用安全流程边界限制）
- [x] 系统性存储 universe-memory 经验与否证记录

## 当前发现

- 用户澄清问题是自动批准菜单中的“执行命令”权限无法关闭，不是终止正在运行的命令。
- UI 会正确发送并乐观设置 `alwaysAllowExecute: false`；扩展的 `updateSettings` 也会写入 `contextProxy` 并回传状态。
- 根因在 `checkAutoApproval()`：旧逻辑使用 `alwaysAllowExecute === true || allowedCommands 包含 "*"`，导致通配符反向覆盖显式关闭权限。
- 修复后 `alwaysAllowExecute` 是命令自动批准的总闸；允许列表（包括 `*`）与拒绝列表只在总闸开启时参与决策。
- 否决“关闭时删除 `*`”方案：允许列表是范围配置，不能替代或覆盖权限总闸。
- 聚焦 Vitest 4/4、后端 `tsc --noEmit`、聚焦 ESLint 均通过；ESLint 仅报告项目既有 TypeScript 5.9.3 支持范围警告。
- 发行版本已提升至 `5.5.5`，根目录与扩展内 changelog 已同步。
- Universal VSIX 构建与独立审计通过：`42,427,391` bytes，SHA-256 `8a6794b6e173b9c5a5b9640a80b56ecd73a4ff19024fdd20e6d1a2bb4d644670`。
- VSCodium 与 VS Code 均安装并列出 `deeptask.deeptask@5.5.5`；两个安装目录内版本、运行时标记和 changelog 审计通过。
- 提交 `36ba709c26bd4f02f0f7e90210facb51c9777365` 已推送到远端 `main`；GitHub Release `v5.5.5` 已发布，目标提交精确，资产 `deeptask-5.5.5.vsix` 状态为 `uploaded`、大小为 `42,427,391` bytes。
- Visual Studio Marketplace 已由用户确认发布完成。
- Open VSX 管理页确认 `deeptask@5.5.5` 收件并进入 `Under review`；公开 latest API 约 2 分钟后由 `5.5.4` 切换至 `5.5.5`。
- 从 Open VSX 官方版本 URL 独立下载远端资产并通过完整校验：身份 `deeptask.deeptask`、版本 `5.5.5`、大小 `42,427,391` bytes、SHA-256 `8a6794b6e173b9c5a5b9640a80b56ecd73a4ff19024fdd20e6d1a2bb4d644670`，与本地构建完全一致。
- 初版独立审计器误假设 VSIX 保留 `CHANGELOG.md` 大小写；实际由 vsce 规范化为 `changelog.md`。已改为大小写无关 ZIP 条目映射，并在不重复构建的情况下复验通过。

## 验收边界

- 必须用测试覆盖：关闭执行 + `*`、关闭执行 + 拒绝命中、开启执行 + `*`、开启执行 + 拒绝命中。
- 用户关闭执行权限后，任何允许列表配置都不得使命令自动批准；重新开启后既有列表仍应正常生效。
- 市场上传成功不等于公开完成；以公开版本/API/远端字节为准。
