# Deeptask 双插件市场与 Star 入口发布进度

## 目标

- 将 Deeptask 发布到 Open VSX（供 VSCodium 安装）。
- 将 Deeptask 发布到 Visual Studio Marketplace（供 VS Code 安装）。
- 在插件内提供明显、克制且可用的 GitHub Star 入口。
- 对构建产物、市场页面和 Star 跳转进行真实验收。

## 里程碑

- [x] 查询 universe-memory；未发现直接匹配记忆
- [x] 审计扩展身份、版本、仓库元数据、既有 Star 功能和发布凭据状态
- [x] 设计并实现明显的 Star 入口
- [x] 添加或更新聚焦测试并通过
- [x] 添加 changeset 并更新必要发布元数据
- [x] 构建、审计并校验 VSIX
- [x] 发布到 Open VSX 并验证公开页面/版本
- [x] 发布到 Visual Studio Marketplace 并验证公开页面/版本
- [x] 提交并推送源码更改
- [x] 系统性存储发布经验

## 当前发现

- [`src/package.json`](src/package.json) 已有 `publish:marketplace`，会依次运行 `vsce publish --no-dependencies` 与 `ovsx publish --no-dependencies`。
- 本机 `VSCE_PAT` / `OVSX_PAT` 等发布凭据环境变量均未设置；两个市场首次发布需要完成发布者身份授权。
- 已有 v5.5.0 VSIX 和 GitHub Release；市场首发必须重新构建，确保包内包含本轮 Star UI 与正确仓库元数据。
- 首页 Logo/简介下方现已提供高对比 `Star Deeptask on GitHub` 按钮；设置 About 也保留持久 Star CTA。
- 点击统一通过宿主 `openExternal` 打开 `https://github.com/kurzcraft/DeepTask`，避免 webview 普通链接行为差异。
- `webview-ui` 原 `pretest` 指向不存在的 Turbo 包 `kilo-code#bundle`，导致任何常规 UI 测试在 Vitest 启动前失败；已修为真实包 `deeptask#bundle`。

## 决策

- 不在命令参数或日志中打印发布 Token。
- 发布前分别查询两个市场，避免同版本冲突或误发布到上游命名空间。
- 用户明确要求两个市场的首次发布版本为 `5.5.0`，不升到 `5.5.1`。两个市场当前均返回 404，因此 `deeptask.deeptask@5.5.0` 尚未占用；市场首发的 5.5.0 包将包含本轮新增 Star UI。
- 产品内 Star 入口必须通过受控外链打开 GitHub 仓库，并有测试覆盖。

## 5.5.3 更新轮次

- [x] 确认扩展标识保持 `deeptask.deeptask`，版本为 `5.5.3`
- [x] 完成后端与 Webview TypeScript 检查及 `git diff --check`
- [ ] 构建并审计 `deeptask-5.5.3.vsix`
- [ ] 安装到 VSCodium 并验证运行时版本与关键修复标记
- [ ] 提交并推送 `5.5.3` 源码
- [ ] 创建 GitHub Release `v5.5.3` 并校验资产
- [ ] 更新 Visual Studio Marketplace 并验证公开版本
- [x] Open VSX 不在本轮范围内（用户明确要求只更新 VS Code Marketplace）
- [ ] 存储本轮发布经验与残余风险

更新约束：本轮只更新 Visual Studio Marketplace。已有扩展必须更新原标识，禁止通过修改 publisher/name 创建重复扩展；上传前必须验证 VSIX 版本、大小与 SHA-256，上传后必须从公开接口确认服务端版本。

## 阻塞项

- 当前无已确认发布阻塞项；发布凭据和市场服务状态需在提交时实测。
- Open VSX 的 `deeptask` namespace 尚未完成官方 ownership verification；扩展已正常公开并可下载，但页面暂时显示未验证发布者警告。后续可通过 Claim Ownership 流程消除警告。

## 验证状态

- 2026-07-26：用户确认首个市场版本保持 `5.5.0`。
- 2026-07-26：Star CTA 组件测试与 ChatView 首页集成测试通过：2 个文件，24 passed，12 skipped；完整 `pretest -> deeptask#bundle -> vitest` 链成功。
- 完整日志：`EXTRA/output/test-marketplace-star-ui.log`，状态文件为 `0`。
- 2026-07-26：重建并审计 `deeptask.deeptask@5.5.0` VSIX，大小 42,422,316 字节，SHA-256 为 `5c9794d37f2eb77dc1da639bd2d153f8af92bbf5f48e0c7f2647d0a675f7c100`；包内已确认 Star UI 和规范 GitHub URL。
- 2026-07-26：创建 Visual Studio Marketplace 发布者 `deeptask`，上传后通过服务端验证；管理端显示版本 `5.5.0`、可见性 `Public`。
- 2026-07-26：Visual Studio Marketplace 公开页验收成功：`https://marketplace.visualstudio.com/items?itemName=deeptask.deeptask`，安装命令为 `ext install deeptask.deeptask`。
- 2026-07-26：完成 Eclipse 账号、ECA、GitHub `kurzcraft` 绑定及 Open VSX Publisher Agreement v1.1 签署，创建 `deeptask` namespace。
- 2026-07-26：Open VSX 公开页验收成功：`https://open-vsx.org/extension/deeptask/deeptask`，显示版本 `5.5.0`、别名 `latest`、唯一标识 `deeptask.deeptask`，下载入口可用。
- 2026-07-26：Star UI、测试、changeset 与市场元数据已提交为 `82d87bbca9dbace36411bb21db28fca1b1dedea7`，并成功推送到 `origin/main`。
- 2026-07-26：发布原理与边界已存入 universe-memory 的 `2026-07-26-Deeptask双插件市场首发与Star入口.md`。
