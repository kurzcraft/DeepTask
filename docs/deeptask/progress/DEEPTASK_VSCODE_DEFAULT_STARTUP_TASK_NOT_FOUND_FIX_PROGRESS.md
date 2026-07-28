# Deeptask VS Code 默认启动卡住与 Task Not Found 修复进度

## 目标

- 复现并定位 VS Code 市场安装后发送消息一直转圈的首个异常。
- 确保点击取消不依赖可能缺失的任务持久化文件，不显示 `Task file not found` 红色报错。
- 证伪或确认 VS Code 内置 Agent API 冲突假说。
- 确保新用户默认配置在 VS Code 中可直接发送、取消并恢复，不需要手工修系统资源或状态库。
- 完成源码测试、VSIX 重建、VS Code 安装与真实运行时验收，再同步市场和 GitHub Release。

## 里程碑

- [x] 查询 universe-memory 与否证库
- [x] 采集当前 VS Code 扩展宿主、安装资源、扩展状态和半写入任务证据
- [x] 定位首个阻断异常并证伪 Agent API 冲突假说
- [x] 设计默认 fail-soft 修复与迁移/自愈策略
- [x] 实现源码修复及回归测试
- [x] 运行聚焦测试、类型检查、lint 与差异检查（聚焦测试 26/26 已通过）
- [x] 添加用户可见 changeset 并确定补丁版本 `5.5.1`
- [x] 重建并审计 `deeptask-5.5.1.vsix`
- [ ] 安装到 VS Code/VSCodium（用户后续要求本轮不用安装）
- [ ] 使用隔离 user-data-dir 完成首次启动、配置引导、发送与取消验收
- [x] 更新 Visual Studio Marketplace 至 `5.5.1`
- [ ] 更新 Open VSX 与 GitHub Release
- [ ] 提交推送并系统性存储 universe-memory

## 已确认结论

- 🟠 C1（0.95）：全新安装 seeded OpenAI Compatible profile 只有模型元数据，没有 API key 或自定义 endpoint；旧逻辑却将模型 ID 当成可用配置，允许创建无法完成请求的任务。
- 🟠 C2（0.95）：任务启动早期只写入 UI 历史时，取消路径读取缺失 API 历史会命中 `Task file not found`；该内部可恢复状态不应成为用户可见红错。
- 🟠 C3（0.92）：配置存在性前端门禁、`createTask()` 后端门禁和取消无条件清栈构成三层保护，不依赖本机历史设置。
- 🟡 C4（0.85）：没有激活事件、调用栈或协议证据支持 VS Code 内置 Agent API 冲突；当前应否决该假说，而不是禁用内置功能。
- 🔬 新洞见（0.92）：默认配置中的“模型元数据”与“可连接凭据”必须分离建模；OpenAI Compatible 只有 API key 或自定义 endpoint 至少一个存在时才可启动任务。

## 验收门槛

- 新安装或隔离状态下首次发送能进入正常响应，不永久转圈。
- 发送前任意异常都必须回滚半初始化任务并释放前端 busy 状态。
- 任务文件缺失时点击取消仍立即停止并恢复输入，不弹用户可见红色错误。
- 不依赖修改 `/usr/share/code`、手工清理数据库或关闭 VS Code 内置 Agent 功能。
- 安装后的 extension host 必须晚于 VSIX 安装时间，并产生真实交互证据。

## 决策与边界

- 不先禁用 VS Code 内置 Agent/Copilot；只有确定性冲突证据才做兼容隔离。
- 不清空全部用户配置；诊断和迁移只处理 Deeptask 自身 namespace，并先备份。
- 不把本地系统修复当成产品修复；市场包必须在普通用户环境中自包含或 fail-soft。
- 原始日志和状态库可能含敏感信息，只保存在 `EXTRA/output/`，不提交仓库。

## Visual Studio Marketplace 5.5.1 验证

- 2026-07-26：上传产物 `deeptask-5.5.1.vsix`，SHA-256 为 `7377a80d61890767f470d3208c75dbef387864257644389bb8e9b2b30351a4ef`。
- 发布者后台先显示 `Verifying 5.5.1`，随后验证完成；当前版本行显示 `5.5.1`、`Public`，不再显示 `Verifying` 或错误状态。
- 公开页 `https://marketplace.visualstudio.com/items?itemName=deeptask.deeptask` 已显示版本 `5.5.1`、发布者 `deeptask`、唯一标识 `deeptask.deeptask`。
- 公开安装命令为 `ext install deeptask.deeptask`，说明 VS Code 用户可从商店发现并安装更新。
- 剩余非阻断内容瑕疵：公开 Overview 正文仍提到 `5.5.0 legacy source line` 和 `deeptask-5.5.0.vsix`；这不影响版本分发，但后续应更新 README/市场说明以避免用户混淆。
