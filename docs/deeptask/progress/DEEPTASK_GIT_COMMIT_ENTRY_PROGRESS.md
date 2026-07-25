# Deeptask Git Commit 入口修复进度

- [x] 明确问题范围：VSCode Git 图形界面的 commit 补全入口中，Deeptask 按钮无反应，KiloCode 按钮有反应。
- [x] 检查 `package.json` / `src/package.json` 中 SCM、命令、菜单、activation 注册。
- [x] 检查 commit message provider / command 实现是否仍注册旧 KiloCode 标识：确认 provider 只注册 `kilo-code.vsc.generateCommitMessage`。
- [x] 修复 Deeptask Git commit 入口映射：源码 provider 同时注册 `deeptask.vsc.generateCommitMessage` 与旧 `kilo-code.vsc.generateCommitMessage`。
- [x] 打包 VSIX 并验证 manifest / bundle 中入口注册正确：已对 legacy `src/dist/extension.js` 仅补 `deeptask.vsc.generateCommitMessage` 命令注册别名，VSIX 大小 `42304418`。
- [x] 将本次经验写入宇宙记忆：已追加 manifest/runtime command id 错配经验。

## 追加修复：Deeptask 入口生成英文而 KiloCode 入口生成中文

- [x] 复核源码：`src/services/commit-message/CommitMessageGenerator.ts` 已使用 `language: "zh-CN"`，`src/shared/support-prompt.ts` 已包含简体中文 commit 约束。
- [x] 确认 legacy runtime 问题：当前打包依赖 `src/dist/extension.js`，其 commit prompt 仍保留 `language:"en"` 且缺少简体中文约束。
- [x] 新增并执行 `scripts_patch_git_commit_chinese_dist.py`，仅修补 `src/dist/extension.js` 的 commit prompt 语言与中文约束，不修改 webview 压缩包和终端完成逻辑。
- [x] 重新打包 `deeptask-5.5.0.vsix` / `bin/deeptask-5.5.0.vsix`，新包大小 `42304519`。
- [x] 包内验证通过：`runtime_commit_language_zh_cn=True`、`runtime_commit_prompt_simplified_chinese=True`、`runtime_deeptask_command=True`、`runtime_terminal_risky_patch_absent=True`、`runtime_webview_risky_patch_absent=True`。
