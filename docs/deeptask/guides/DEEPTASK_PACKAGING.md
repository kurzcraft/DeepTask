# Deeptask VSIX 打包方式说明

本文档记录 Deeptask 5.5.0 在当前 Ubuntu 环境中的可复现打包方式。

## 产物

- 根目录产物：`deeptask-5.5.0.vsix`
- 备份产物：`bin/deeptask-5.5.0.vsix`
- 打包日志：`artifacts/deeptask/logs/DEEPTASK_PACKAGE_PROGRESS.log`

最近一次验证通过结果：

```text
VSIX verified: deeptask-5.5.0.vsix 42395893
```

## 推荐打包命令

在仓库根目录执行：

```bash
bash scripts_package_deeptask_vsix.sh
```

脚本会打印 9 个阶段的进度，并同步写入
`artifacts/deeptask/logs/DEEPTASK_PACKAGE_PROGRESS.log`：

1. 检查 Node 与 npm 环境。
2. 检查扩展构建产物。
3. 同步旧 webview 构建产物中的 Deeptask 品牌。
4. 检查临时 `@vscode/vsce` 可用性。
5. 临时移除 `src/package.json` 的 `vscode:prepublish`。
6. 执行 VSIX 打包到 `bin/deeptask-5.5.0.vsix`。
7. 复制 VSIX 到仓库根目录。
8. 验证 VSIX 内容与品牌资源。
9. 打包完成并自动恢复 `vscode:prepublish`。

## 环境约束

当前环境推荐使用项目外置 Node 20：

```text
/media/kurz/aleber/vscode/tools/node-v20.20.0-linux-x64/bin
```

脚本会主动设置：

```bash
PATH="/media/kurz/aleber/vscode/tools/node-v20.20.0-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
```

不要在此环境中优先依赖 `corepack pnpm` 打包。此前 `corepack pnpm --version` 在该机器上可能卡住或输出异常重复内容。当前脚本改用：

```bash
npx --yes @vscode/vsce
```

## 为什么临时移除 `vscode:prepublish`

`src/package.json` 中的 `vscode:prepublish` 会触发完整 bundle：

```json
"vscode:prepublish": "pnpm bundle --production"
```

当前工作区可能没有完整安装 `webview-ui` 依赖，直接触发 bundle 会失败或进入不稳定路径。脚本会：

1. 读取并保存原始 `vscode:prepublish` 到 `/tmp/deeptask_vscode_prepublish_value.txt`。
2. 打包前临时从 `src/package.json` 删除它。
3. 通过 `trap restore EXIT` 在成功或失败退出时恢复原值。

因此打包后应看到：

```text
restored vscode:prepublish: True
```

## 旧 webview 构建产物品牌同步

当没有重新构建 webview 时，`src/webview-ui/build/assets/*.js` 可能仍含旧 Kilo Code 文案或旧 Logo。打包脚本会在打包前执行：

```bash
python3 scripts_patch_legacy_webview_branding.py
```

该脚本会同步以下内容：

- `About Kilo Code` → `About Deeptask`
- 旧 `Kilo_Code_Branding` SVG → Deeptask 指北针 SVG
- `https://kilo.ai/support` → Deeptask GitHub issues
- 旧 Kilo GitHub/Reddit/Discord 链接 → Deeptask GitHub 仓库或讨论区
- 部分用户可见通知文案中的 `Kilo Code` → `Deeptask`

脚本可重复运行。若构建产物已经修补，会打印 `WARN no match ...`，只要最终输出 `legacy webview branding patch complete` 且打包脚本第 8 阶段验证通过即可。

## VSIX 验证项

打包脚本第 8 阶段会打开 `deeptask-5.5.0.vsix` 并检查：

- `extension/package.json` 中：
  - `name` 为 `deeptask`
  - `publisher` 为 `deeptask`
  - `version` 为 `5.5.0`
  - `main` 为 `./dist/extension.js`
- 必要文件存在：
  - `extension/dist/extension.js`
  - `extension/assets/icons/logo-outline-black.png`
  - `extension/assets/icons/kilo-light.svg`
  - `extension/assets/icons/kilo-dark.svg`
  - `extension/webview-ui/build/assets/agent-manager.js`
- 图标 SVG 包含更大侧边栏占比与较细左侧描边：
  - `L62 220`
  - `L194 220`
  - `stroke-width="10"`
- webview bundle 中不再包含：
  - `About Kilo Code`
  - `alt="Kilo Code"`
  - `Kilo_Code_Branding`
  - `Kilo Code Branding`
  - `Development: Allocate memory`
  - `settings:footer.support`
  - `https://kilo.ai/support`

## 手动诊断命令

查看 VSIX 包内 webview 文件：

```bash
python3 - <<'PY'
from zipfile import ZipFile
with ZipFile('deeptask-5.5.0.vsix') as z:
    web = sorted(n for n in z.namelist() if n.startswith('extension/webview-ui/'))
    print('webview count', len(web))
    print('\n'.join(web[:80]))
PY
```

扫描旧品牌残留：

```bash
grep -RIn "About Kilo Code\|alt=\"Kilo Code\"\|Kilo_Code_Branding\|Kilo Code Branding\|settings:footer.support\|https://kilo.ai/support" \
  src/webview-ui/build/assets/*.js | head -n 80
```

## 注意事项

- 当前打包方式是“legacy artifact packaging”：使用已有 `src/dist/extension.js` 与 `src/webview-ui/build/assets/*.js`，不重新安装依赖、不重新 bundle。
- 如果未来完整依赖恢复，应优先运行标准构建，再用本脚本做最终 VSIX 验证。
- 若重新安装了依赖，需要按用户规则同步更新项目的 `requirements.txt`；本次未重新安装 Python 或 Node 依赖，因此未改动该文件。
