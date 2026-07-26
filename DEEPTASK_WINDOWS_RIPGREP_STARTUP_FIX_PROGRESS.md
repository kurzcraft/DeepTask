# Deeptask Windows Ripgrep 启动失败修复进度

## 目标

- 修复 Windows 发送消息后任务启动失败并返回主界面：`Task failed to start: Could not find ripgrep binary`。
- 让 ripgrep 解析覆盖宿主编辑器、显式环境变量、扩展/依赖位置和系统 PATH。
- 即使所有 ripgrep 来源均不可用，工作区初始文件枚举也不得阻断任务启动。
- 构建、审计、安装并发布新的 GitHub 补丁 Release。

## 里程碑

- [x] 查询 universe-memory；未发现直接匹配的既有修复
- [x] 定位错误由任务启动期文件枚举调用 `getBinPath()` 后抛出
- [x] 确认文档宣称存在 `RIPGREP_PATH`/PATH 回退，但运行时代码未实现
- [x] 设计并实现统一跨平台 ripgrep 解析与文件系统回退
- [x] 添加 Windows 路径、环境变量、PATH 和无二进制启动回归测试
- [x] 运行聚焦测试、类型检查和 lint（聚焦测试 25/25、类型检查、聚焦 ESLint 均通过）
- [x] 提升补丁版本至 5.5.4 并更新 changelog/changeset
- [x] 构建并审计 Universal VSIX（42,427,313 bytes；运行时四类回退标记通过）
- [x] 安装 VSCodium 并验证 `deeptask.deeptask@5.5.4`
- [ ] 提交、推送并发布 GitHub Release
- [ ] 独立下载远端资产并逐字节验收
- [ ] 存储 universe-memory 项目经验与否证记录

## 当前结论

- `src/services/glob/list-files.ts` 原先在任务初始化列目录前强制要求 ripgrep，找不到即抛出用户看到的精确错误；现在缺失或 spawn 失败均自动切换 Node 文件系统扫描。
- `src/services/ripgrep/index.ts` 现按显式 `RIPGREP_PATH`、宿主编辑器、扩展资源、开发依赖、系统 PATH 的顺序跨平台解析。
- Universal VSIX 使用 `--no-dependencies`，当前 Linux 依赖树中的 Windows 平台包只有元数据而无 `rg.exe`，不能假装复制不存在的二进制；Node 回退才是无平台依赖的启动保障。
- 25 项 ripgrep/glob 聚焦测试通过，覆盖 Windows PATH、显式路径、全来源缺失和无二进制文件枚举。

## 验收边界

- Linux 自动化和 VSIX 内容审计可以证明回退逻辑与包结构，但不能冒充真实 Windows VS Code/VSCodium 实机验收。
- 本轮 GitHub Release 必须使用新版本号，不能覆盖已公开的 `v5.5.3`。
