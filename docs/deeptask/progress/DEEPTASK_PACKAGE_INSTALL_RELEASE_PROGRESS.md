# Deeptask 打包安装 VSCodium 并发布 Release 进度

## Checklist

- [x] 查询宇宙记忆与既有打包/发布流程
- [x] 阅读 `DEEPTASK_PACKAGING.md`、打包脚本、发布脚本与当前 release notes
- [x] 确认未提交修复与版本目标（继续覆盖 `v5.5.0`）
- [x] 更新 release notes 纳入本轮完成后续发/总结 todo 修复
- [x] 执行 `scripts_package_deeptask_vsix.sh` 打包 VSIX
- [x] 验证 VSIX 含本轮关键修复标记
- [x] 安装到 VSCodium 并校验扩展目录
- [x] 提交并推送 main
- [x] 覆盖发布 GitHub Release `v5.5.0`
- [x] 更新进度文件与宇宙记忆

## 目标

1. 将本轮完成后续发无回复 / 总结 todo 修复打包为 `deeptask-5.5.0.vsix`
2. 安装到本地 VSCodium
3. 覆盖发布 GitHub Release `v5.5.0` 并上传新 VSIX

## 当前结果

- Commit: `0213823b` on `main` / `origin/main`
- Message: `fix(condense): prevent failed compression from leaking into reasoning`
- Local VSIX: `deeptask-5.5.0.vsix`
- Size: `42412639` bytes
- SHA-256: `98668bdf7f3d94e9ec85540322826360edd6b71d9d437d931e4540a1956b35c0`
- VSCodium install: `codium --install-extension deeptask-5.5.0.vsix --force`
- Installed version: `deeptask.deeptask@5.5.0`
- Installed path: `/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0`
- Release: https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0
- Tag: `v5.5.0`
- Asset: `deeptask-5.5.0.vsix`
- Asset size: `42412639` (local == remote)
- Asset URL: https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix
- 本轮新增：压缩 API 超时/中断采用事务语义，失败时保留原历史并发送 `condense_context_error`，成功结果只在历史写回后确认。

## 发布步骤

1. 更新 [`DEEPTASK_RELEASE_5.5.0_NOTES.md`](DEEPTASK_RELEASE_5.5.0_NOTES.md)
2. `bash scripts_package_deeptask_vsix.sh`
3. `codium --install-extension deeptask-5.5.0.vsix --force`
4. 提交并推送本轮 soft-completion continuation 修复
5. `node scripts_publish_github_release.mjs`
6. 校验 tag/body/asset size

## 验证

```json
{
  "ok": true,
  "commit": "a35063ac",
  "releaseUrl": "https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0",
  "tagName": "v5.5.0",
  "name": "Deeptask 5.5.0",
  "assetName": "deeptask-5.5.0.vsix",
  "assetSize": 42412413,
  "assetUrl": "https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix",
  "localSize": 42412413,
  "bodyHasSoftCompletion": true,
  "bodyHasSize": true
}
```

## 决策

- 继续覆盖同一 tag `v5.5.0` 与同名 VSIX（与历史热修复一致）
- 发布前先 push main，保证源码与资产对应
- 使用外置 Node 20 + `bash scripts_package_deeptask_vsix.sh`
- 安装路径使用 VSCodium OSS 扩展目录 `~/.vscode-oss/extensions`

## Blockers

- 无

## 2026-07-20 终端共享流修复重新打包安装发布

- 发布源码基线：`5161c960`（`main` 与 `origin/main` 一致）。
- 执行 `bash scripts_package_deeptask_vsix.sh`：通过，强制重建 webview 与 extension bundle。
- 本地 VSIX：`deeptask-5.5.0.vsix`。
- 镜像 VSIX：`bin/deeptask-5.5.0.vsix`。
- 大小：`42415899` bytes。
- SHA-256：`2fe97d778dde36528bc1f10ad6f752ab1fd76e77cac5b357520365b4fec5d233`。
- VSCodium 强制安装：通过，版本为 `deeptask.deeptask@5.5.0`。
- 安装目录：`/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0`。
- 安装目录大小：`181670185` bytes。
- 安装 bundle source map 已验证包含 `getTerminalShellExecutionStream`。
- GitHub Release：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- 最终 asset ID：`482973843`，状态 `uploaded`。
- 鉴权校验：本地与远端均为 `42415899` bytes，远端下载内容 SHA-256 与本地一致。
- Release notes 顶部 artifact 哈希已同步为本次重新打包后的真实哈希。

## Entropy

任务前：本轮完成后续发修复只在源码，未进 VSIX / VSCodium / GitHub Release。
任务后：强制重建 webview+extension、安装到 VSCodium、覆盖 `v5.5.0` 资产；本地与远端 size 一致。净熵下降。

本次发布前：已知旧资产有效，但重新打包后的 ZIP 元数据会改变哈希，Release 正文可能仍引用旧值。
本次发布后：重新构建、强制安装、同步 notes、二次覆盖并鉴权下载，确认 size 与 SHA-256 全链路一致。净熵下降。
