# Deeptask README 架构与优势完善进度

## 目标

- 通读项目关键架构与现有 README，形成准确的产品定位。
- 以可验证代码能力为依据，说明 Deeptask 的便利性及相对 Kilo Code 的改进。
- 重构 README，使安装、上手、核心工作流、架构、差异与开发说明层次清晰。

## Checklist

- [x] 查询历史记忆
- [x] 审读 README、项目清单和核心架构
- [x] 提炼代码证据与差异化能力
- [x] 重构 README
- [x] 修复 README 图片显示并创建 Deeptask 科技风自有横幅
- [x] 校验文档
- [x] 首次正式成品 changeset、提交、推送
- [x] 首次正式成品 universe-memory
- [x] 恢复主页与扩展侧边栏原有 Deeptask 指北针图标
- [x] 移除编辑重发的本地临时消息/队列式 UI
- [x] 运行图标、重发和队列 UI 回归验证
- [x] 打包、安装 VSCodium、更新 GitHub Release
- [x] 提交、推送并更新 universe-memory

## 当前原则

- 不写无法从仓库代码、配置或测试证实的营销承诺。
- 将“比 Kilo Code 的优势”表述为本分支明确实现的工程改进，而非贬低上游。
- 优先回答用户最关心的三个问题：为什么方便、为什么稳定、如何立即使用。

## 图片修复记录

- 最终确认根目录 `deeptask.jpg` 不是可用原图，而是 724 bytes、14×14 的近白色残缺占位图；在 GitHub 白色背景中几乎不可见，放大后仅呈灰白色块。
- 用户所指的既有 Deeptask 原图为 `src/assets/icons/` 下的指北针品牌资源；不再重新设计或使用新横幅。
- README 使用 GitHub 支持的 `<picture>` 主题切换：暗色主题加载 `kilo-dark.svg`，亮色主题加载 `kilo-light.svg`，并以完整 256×256 的 `logo-outline-black.png` 回退。
- 三份资源均已由 Git 跟踪；`identify` 确认回退 PNG 为 256×256；README 已无 `deeptask.jpg` 引用；`git diff --check` 通过。
- 额外诊断发现 GitHub 账号、仓库主页、Release 与 raw 地址对匿名访问均返回 404，但认证 API 可读取公开仓库对象；这是独立的账号可见性异常，不是登录后图标不可见的直接原因。

## README 重构结果

- 首屏明确定位为“面向长任务与真实工程交付的 AI 编程智能体”，并标记 `v5.5.0` 为首次正式成品发布。
- 从代码和既有回归记录提炼五类可验证优势：消息直达、终端硬限制、压缩焦点、反馈工作轮次、透明默认配置。
- 增加相对 Kilo Code 5.5 基线的克制对比，明确仅比较本分支已验证改进，不作无法证实的全面优劣声明。
- 增加 VSCodium / VS Code 安装命令、推荐工作流、运行时架构图、目录说明和开发验证入口。
- 新增 changeset，发布文案为“首次正式发布 Deeptask 成品”；最终 Git 提交说明固定为 `release: 首次正式发布 Deeptask 成品`。

## 主页图标与编辑重发续修

- 用户澄清“用原来的图片”仅指 README；主页、Activity Bar、侧边栏视图和命令图标已恢复既有 Deeptask 指北针资源，不使用本轮新绘制的青紫图标。
- `ChatView` 删除编辑重发的 `optimisticCommandFeedbackMessages` 本地渲染层，消息历史成为唯一 UI 数据源。
- `ChatRow` 提交编辑后仅发送 `submitEditedMessage`，不再回调创建临时 `user_feedback` 行；旧文案与修改后文案在 rewind 窗口均不显示为队列卡片。
- 回归测试改为验证：修改发送后没有本地队列行，rewind 期间旧消息消失，只有宿主确认后的新消息出现一次。
- Webview 聚焦回归：20 passed、12 skipped；Webview TypeScript 检查通过。
- 源码搜索仅在测试否定断言中保留 `queueMessage`，生产 TSX 已无 `QueuedMessages`、本地乐观队列或临时消息正文。
- `git diff --check` 通过；本轮没有重新安装依赖，无需更新 `requirements.txt`。
- 恢复原图后强制重建 webview 与 extension，生成 `deeptask-5.5.0.vsix`，大小 42,420,612 bytes。
- VSCodium 已重新安装并确认 `deeptask.deeptask@5.5.0`。
- GitHub Release `v5.5.0` 已覆盖，远端资产状态 `uploaded`，本地/远端大小一致。
- VSIX SHA-256：`89600627d0367971e261599c7be50615107169f7cd10573f598bcb4420f6f2ec`。
- 完整日志：`EXTRA/output/package-install-release-first-product.log`，最终状态 0。
- 图标修正提交 `57805f2b` 已推送到 `origin/main`；本段最终验收记录待提交。
- Universe memory：`宇宙/记忆/项目记忆/2026-07-24-Deeptask重发无队列UI与主页侧边栏图标.md`。

## 用户图片纠正

- 用户原意是 README 使用仓库原有 `deeptask.jpg`，不是替换插件主页和侧边栏图标。
- README 头图已改回 `./deeptask.jpg`；插件内图标已恢复原有 `kilo-light.svg` / `kilo-dark.svg` 与对应 PNG 资源。
- 删除本轮误新增的 `deeptask-light.svg` 与 `deeptask-dark.svg`，避免两套图标继续分叉。
