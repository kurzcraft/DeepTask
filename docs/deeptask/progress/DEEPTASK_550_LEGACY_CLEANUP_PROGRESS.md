# Deeptask 5.5.0 Legacy 清理进度

## 目标

- 不再从当前最新版 KiloCode monorepo 内容打包 Deeptask。
- 将当前仓库清理/替换为 KiloCode 5.5.0 legacy 基线。
- 只保留 Deeptask 5.5.0 插件必需内容与用户要求的品牌修改。
- 重新打包并验证 VSIX 不含最新版 KiloCode 特征。

## 进度

- [x] 确认问题：此前只修改并打包 `packages/kilo-vscode`，但仓库整体仍保留最新版 KiloCode monorepo 结构。
- [x] 创建本清理进度清单。
- [x] 检查当前仓库与本地 5.5.0 legacy 基线是否存在。
- [x] 制定只保留 5.5.0 的清理/替换方案。
- [x] 创建安全备份分支或备份点。
- [x] 用 5.5.0 legacy 基线替换当前最新版 monorepo 内容。
- [x] 重新应用 Deeptask 品牌、About 去 Kilo 与指北针图标。
- [x] 打包并验证 VSIX 不含最新版 KiloCode 特征。
- [-] 提交并推送 main。
- [ ] 存储本次纠错经验。

## VSIX 验证结果

- 产物：`deeptask-5.5.0.vsix`，大小 `42,389,882` 字节。
- VSIX 清单：`name=deeptask`、`publisher=deeptask`、`version=5.5.0`、`main=./dist/extension.js`。
- VSIX 内已不存在 `packages/kilo-vscode` 路径。
- VSIX 内存在 legacy 结构路径：`extension/dist/extension.js`。
- 图标 `logo-outline-black.png`、`kilo.png`、`kilo-dark.png` 均为 `RGBA 256x256`，alpha 范围为 `0-255`。
- SVG 图标包含左空心、右实心双三角指北针路径，且无背景 `<rect>`。
- About/设置页目标 Kilo 外链残留检索为 0。

## 2026-07-03 重新打包记录

- 按用户要求重新打包。
- 使用 legacy 扩展目录 `src` 作为打包目录，而不是新版 `packages/kilo-vscode`。
- 为避免本地依赖问题触发 `vscode:prepublish`，临时移除 `src/package.json` 中该脚本，打包完成后恢复。
- 重新生成 `deeptask-5.5.0.vsix`。
- 验证结果：
  - VSIX 大小：`42,389,882` 字节。
  - `name=deeptask`。
  - `publisher=deeptask`。
  - `version=5.5.0`。
  - `main=./dist/extension.js`。
  - `HAS_PACKAGES_KILO_VSCODE=False`。
  - 必需文件 `extension/dist/extension.js`、`extension/assets/icons/logo-outline-black.png`、`extension/assets/icons/kilo-light.svg`、`extension/assets/icons/kilo-dark.svg` 均存在。
  - PNG 图标均为 `RGBA 256x256`，alpha 范围 `0-255`。
  - SVG 图标包含双三角指北针路径且无背景 `<rect>`。

## 当前判断

此前 `deeptask-5.5.0.vsix` 的 `extension/package.json` 虽然显示 Deeptask 5.5.0，但构建来源仍是当前仓库的 `packages/kilo-vscode`，而当前仓库根目录仍包含最新版 KiloCode monorepo 特征。因此必须从仓库基线层面处理，而不是只改 VSIX 表层元数据。

## 基线检查结果

- 当前仓库 `main` 已推送到 `origin/main`，当前新增本进度文件尚未提交。
- 当前扩展清单在 `packages/kilo-vscode/package.json`，这是新版包结构。
- 本地存在官方 legacy 基线目录：`/media/kurz/aleber/vscode/deeptask-kilocode-5.5.0-official`。
- legacy 基线 Git 指向 `v5.5.0` 标签，提交为 `9aa1019d1`。
- legacy 基线扩展清单不在 `packages/kilo-vscode/package.json`，而在 `src/package.json`。
- 结论：要避免继续打出新版结构，必须把当前工作树替换为 legacy `v5.5.0` 结构，再在 `src` 路径重新做 Deeptask 品牌修改。

## 拟定方案

1. 先从当前 `main` 创建备份分支，防止大规模删除不可恢复。
2. 用 legacy `v5.5.0` 工作树覆盖当前仓库内容，排除 `.git` 与 `node_modules`。
3. 删除当前新版结构中 legacy 不存在的内容，例如 `packages/kilo-vscode`、新版文档/应用残留和临时脚本。
4. 在 legacy 的 `src/package.json`、`src/package.nls.json`、`src/assets/icons/*` 和对应 About/i18n 文件上重新应用 Deeptask 修改。
5. 从 legacy 结构重新打包 `deeptask-5.5.0.vsix` 并验证 VSIX 内部入口不再是 `packages/kilo-vscode` 结构。
