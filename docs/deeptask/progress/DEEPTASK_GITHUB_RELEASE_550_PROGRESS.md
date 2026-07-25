# Deeptask GitHub Release v5.5.0 发布进度

## Checklist

- [x] 查询 kilo 记忆与既有 GitHub release 流程
- [x] 确认 VSIX 产物、版本号与发布脚本
- [x] 生成/校验 release notes
- [x] 提交未推送修复并推送 main
- [x] 执行 GitHub release 发布
- [x] 验证 release 与资产已上线
- [x] 更新进度文件与记忆

## 当前结果

- Commit: `909df8b8` on `main` / `origin/main`
- Message: `fix: 强制终端裁剪并打包 Continue 按钮`
- Release: https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0
- Tag: `v5.5.0`
- Asset: `deeptask-5.5.0.vsix`
- Asset size: `42409529` (local == remote)
- Asset URL: https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix
- Asset updatedAt: `2026-07-11T15:07:40Z`
- Notes: 已包含 `Latest Hotfix (2026-07-11)` 与 size `42,409,529`

## 发布步骤

1. 更新 [`DEEPTASK_RELEASE_5.5.0_NOTES.md`](DEEPTASK_RELEASE_5.5.0_NOTES.md)
2. 提交并推送本轮 Continue + terminal prune 修复
3. `node scripts_publish_github_release.mjs`
4. 认证 GitHub API 校验 tag/body/asset size

## 验证

```json
{
  "ok": true,
  "commit": "909df8b8",
  "releaseUrl": "https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0",
  "tagName": "v5.5.0",
  "name": "Deeptask 5.5.0",
  "assetName": "deeptask-5.5.0.vsix",
  "assetSize": 42409529,
  "assetUrl": "https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix",
  "updatedAt": "2026-07-11T15:07:40Z",
  "localSize": 42409529
}
```

## 决策

- 继续覆盖同一 tag `v5.5.0` 与同名 VSIX（与历史热修复一致）
- 发布前先 push main，保证源码与资产对应
- 用 Node fetch + git credential token 做认证 API 校验（避免 conda Python SSL 证书问题）

## Blockers

- 无
