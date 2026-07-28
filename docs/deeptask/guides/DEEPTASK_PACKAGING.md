# Deeptask VSIX 打包与发布

本文档记录当前 Deeptask 在 Ubuntu 环境中的可复现构建、安装、验收和 GitHub Release 流程。版本号以 `src/package.json` 为唯一事实源，以下命令不硬编码具体版本。

## 产物与证据

- 根目录发布资产：`deeptask-<version>.vsix`
- 本地归档资产：`bin/deeptask-<version>.vsix`
- 完整打包日志：`artifacts/deeptask/logs/DEEPTASK_PACKAGE_PROGRESS.log`
- 版本说明：`docs/deeptask/releases/DEEPTASK_RELEASE_<version>_NOTES.md`
- 跨会话发布进度：`EXTRA/task/`
- 长发布命令脚本：`EXTRA/bash/`
- 发布、哈希与远端校验日志：`EXTRA/output/`

## 前置条件

1. 工作区依赖已经安装，`pnpm` 可用。
2. 项目外置 Node 20 位于：

    ```text
    /media/kurz/aleber/vscode/tools/node-v20.20.0-linux-x64/bin
    ```

3. VSCodium 安装命令 `codium` 可用。
4. GitHub 发布凭据可由 `GITHUB_TOKEN`、`GH_TOKEN` 或 Git credential helper 提供。
5. 发布前已完成相关测试、类型检查和 lint。

打包脚本会显式设置 Node 20 的 `PATH`，并通过 `npx --yes @vscode/vsce` 调用 VSIX 打包器。

## 标准打包入口

在仓库根目录执行：

```bash
bash scripts/deeptask/scripts_package_deeptask_vsix.sh
```

这是唯一受维护的发布打包入口。不要直接对历史构建产物运行 `vsce package`，否则可能把旧 Webview 或旧扩展 bundle 带入发布包。

脚本执行 10 个阶段：

1. 验证 Node 与 npm 环境。
2. 强制重建 `webview-ui`，拒绝复用 Turbo 缓存中的旧界面。
3. 生产模式重建扩展 bundle，并检查关键运行时修复标记。
4. 同步 legacy 兼容产物与用户可见品牌。
5. 验证临时 `@vscode/vsce` 可用。
6. 临时移除 `vscode:prepublish`，避免 `vsce` 重复触发第二次 bundle。
7. 打包到 `bin/deeptask-<version>.vsix`。
8. 复制发布资产到仓库根目录。
9. 打开 VSIX 执行包内身份、资源、运行时和 Marketplace 审计。
10. 报告完成，并通过退出 trap 恢复 `vscode:prepublish`。

第 6 步不是跳过构建。真实 Webview 与扩展 bundle 已分别在第 2、3 步强制生成；临时移除 prepublish 只用于避免 `vsce` 重复构建和引入第二条不一致路径。

## 包内审计

打包脚本失败即表示资产不可发布。当前审计至少覆盖：

- 包身份与版本和 `src/package.json` 一致。
- `dist/extension.js`、Webview、Agent Manager 和扩展图标存在。
- 已完成终端硬限制、命令完成续跑、新安装配置门禁、取消恢复和 Windows 有界终止路径已进入生产 bundle。
- Webview 含当前 Continue 行为，不含已知旧清按钮逻辑。
- Marketplace README 包含 Deeptask 标题、长程任务价值主张、正确仓库、突出 GitHub 主按钮和用户指南入口。
- Marketplace 首图 `assets/deeptask-logo-v2.png` 确实位于 VSIX 内。
- 包内不含已知 Kilo 品牌、旧仓库 URL、旧支持链接和远程头像残留。

品牌首图的单一源文件是根目录 `assets/deeptask-logo-v2.png`。标准 bundle 会把它同步到 `src/assets/deeptask-logo-v2.png`，`.vscodeignore` 只放行这个必要文件，避免扩大包体范围。

## 安装与本机验收

读取版本并强制安装到 VSCodium：

```bash
VERSION="$(node -p "require('./src/package.json').version")"
codium --install-extension "./deeptask-${VERSION}.vsix" --force
codium --list-extensions --show-versions | rg '^deeptask\.deeptask@'
```

至少验证：

1. 扩展列表显示目标版本。
2. Deeptask 视图可以打开，设置页和对话页无加载错误。
3. OpenAI Compatible 可填写 endpoint、API Key 和模型 ID。
4. 运行命令会出现在集成终端中，完成终端会收敛到配置上限，运行中终端不会被误删。
5. 任务运行中发送新要求能进入当前工作轮次。
6. Marketplace/扩展介绍中的品牌首图、GitHub 主入口和文档链接可见。

若修改涉及跨平台终端行为，应在可用的真实 Windows VS Code 与 VSCodium 主机补做双编辑器验收；没有真实主机时必须把它记录为明确的验收边界，不得把 Linux 测试描述为 Windows 实机通过。

## 提交与 GitHub Release

发布顺序固定为：

1. 完成测试、类型检查、lint、VSIX 打包和本机安装验收。
2. 把最终验证结果写入版本说明与 `EXTRA/task/` 进度文件。
3. 检查 Git 差异，只提交本次相关源码、测试、文档、changeset 和必要资源。
4. 推送 `main`，确认远端提交与本地发布基线一致。
5. 执行维护脚本：

    ```bash
    node scripts/deeptask/scripts_publish_github_release.mjs
    ```

6. 下载远端资产，认证比较本地与远端的文件大小和 SHA-256。
7. 将 Release URL、资产大小、哈希和提交号写回发布证据与长期记忆。

发布脚本从 `src/package.json` 读取版本，使用 `docs/deeptask/releases/DEEPTASK_RELEASE_<version>_NOTES.md` 作为正文，并创建或更新对应的 `v<version>` Release。

## 依赖与安全约束

- 打包过程不应重新安装项目依赖。
- 若确实重新安装或新增 Python 依赖，必须同步更新项目 `requirements.txt`；当前项目主要使用 pnpm，不能凭空创建与实际环境不对应的 Python 清单。
- 不把 API Key、GitHub token 或本机密码写入脚本、日志、提交或发布资产。
- 长命令和发布闭环应写入 `EXTRA/bash/`，完整 stdout/stderr 写入 `EXTRA/output/`，避免依赖短暂终端输出。
- 不发布未提交源码构建出的资产；Release tag、源码提交、版本说明和 VSIX 必须指向同一基线。

## 常见失败

### Webview 资产过旧

表现：第 2 或第 9 阶段报告缺少 Continue 标记，或命中旧清按钮逻辑。

处理：不要手工修改压缩后的 JavaScript；修复源码后重新运行标准打包入口，让 Webview 强制重建。

### 扩展 bundle 缺少运行时标记

表现：第 3 或第 9 阶段提示 `completedTerminalOrder`、`hasPendingWebviewAskResponse` 等标记缺失。

处理：确认源码修复仍存在、`pnpm bundle --production` 成功，并检查是否有构建缓存或错误工作区。

### Marketplace 图片或链接缺失

表现：第 9 阶段报告 hero image、GitHub action、仓库 URL 或用户指南缺失。

处理：检查根 README、`src/esbuild.mjs` 的复制规则、`src/.vscodeignore` 的单文件放行，以及包内 `extension/assets/deeptask-logo-v2.png`。

### `vscode:prepublish` 未恢复

脚本使用退出 trap 恢复该字段。任何异常退出后都应检查：

```bash
node -p "require('./src/package.json').scripts['vscode:prepublish']"
```

预期值为：

```text
pnpm bundle --production
```

### 远端资产与本地不一致

不要重复盲目发布。先读取持久发布日志，核对目标 tag、提交号、资产名、文件大小与 SHA-256，再只替换错误资产。
