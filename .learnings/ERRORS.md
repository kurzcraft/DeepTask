# Errors

## [ERR-20260720-001] recent-task-storage-diagnostic

**Logged**: 2026-07-20T04:11:37Z
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
最近任务诊断脚本在打印结果时使用了越界元组索引。

### Error

```text
IndexError: tuple index out of range
```

### Context
- 脚本成功只读扫描 VSCodium Deeptask 任务存储。
- 每行元组共有 7 个字段，但打印消息尾部时错误访问 `row[7]`。
- 错误只发生在输出阶段，未修改任务历史。

### Suggested Fix
将扫描结果改为字典或命名结构，避免位置索引；长诊断逻辑写入文件后执行。

### Metadata
- Reproducible: yes
- Related Files: scripts_diagnose_cross_workspace_completion.py

### Resolution
- **Resolved**: 2026-07-20T04:11:57Z
- **Notes**: 后续诊断改用具名字典字段，并按用户规则写入脚本文件执行。

---

## [ERR-20260720-002] diagnostic-output-pipeline

**Logged**: 2026-07-20T04:14:30Z
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
诊断脚本输出被 `head` 提前关闭后抛出 `BrokenPipeError`。

### Error

```text
BrokenPipeError: [Errno 32] Broken pipe
```

### Context
- 上游 Python 脚本持续输出 JSONL，下游 `head -n 6` 读取足够行后正常退出。
- 错误是 Unix 管道生命周期噪声，不代表扫描或数据解析失败。

### Suggested Fix
顶层输出捕获 `BrokenPipeError`，将提前关闭管道视为正常终止。

### Metadata
- Reproducible: yes
- Related Files: scripts_diagnose_cross_workspace_completion.py

### Resolution
- **Resolved**: 2026-07-20T04:14:47Z
- **Notes**: 已在输出循环外捕获 `BrokenPipeError` 并正常返回。

---

## [ERR-20260726-001] execa-shell-contract-test

**Logged**: 2026-07-26T11:45:31Z
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
Windows shell 一致性修复后，旧单测仍把 `shell: true` 这一实现细节当作契约。

### Error

```text
ExecaTerminalProcess.spec.ts: expected shell: true, received shell: "/bin/bash"
Tests: 1 failed | 10 passed
```

### Context
- 扩展 bundle 成功，说明 execa 9.5.2 支持显式 shell 路径与 `windowsHide`。
- 失败断言来自旧实现；旧实现让 Windows 的提示词按 PowerShell 生成命令，却由 Execa 默认 CMD 执行。
- 正确契约应是提示词与执行器共享 `getShell()` 的结果，而不是委托给平台默认 shell。

### Suggested Fix
更新单测以 mock `getShell()`，分别断言 PowerShell/CMD/Unix shell 透传、Windows 不注入 POSIX locale、控制台隐藏及取消使用有界 `taskkill /T /F`。

### Metadata
- Reproducible: yes
- Related Files: src/integrations/terminal/ExecaTerminalProcess.ts, src/integrations/terminal/__tests__/ExecaTerminalProcess.spec.ts

### Resolution
- **Resolved**: 2026-07-26T11:53:36Z
- **Notes**: 已更新为 shell 路径透传、Win32 环境与有界 taskkill 契约测试，49 项聚焦测试全部通过。

---

## [ERR-20260726-002] gh-release-create-flag-drift

**Logged**: 2026-07-26T12:07:28Z
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary

本机 GitHub CLI 的 `gh release create` 不支持预期的 `--verify-tag` 参数。

### Error

```text
unknown flag: --verify-tag
```

### Context

- 命令在参数解析阶段失败，未创建远端标签、Release 或资产。
- 本机帮助输出确认支持 `--target`、`--title`、`--notes-file`，不支持 `--verify-tag`。
- 不同 GitHub CLI 版本的子命令参数集合不能由新版本文档反推。

### Suggested Fix

在发布自动化中先以本机 `gh release create --help` 为能力真源；仅使用已确认支持的参数，并在创建后通过 `gh release view` 独立验证标签、目标提交和资产。

### Metadata

- Reproducible: yes
- Related Files: DEEPTASK_RELEASE_5.5.2_NOTES.md

### Resolution

- **Resolved**: 2026-07-26T12:07:44Z
- **Notes**: 已从本机帮助输出确认参数集合，发布将移除不支持的参数并采用创建后验证。

---

## [ERR-20260726-003] windows-simulation-misclassified-as-product-fix

**Logged**: 2026-07-26T13:27:53Z
**Priority**: critical
**Status**: in_progress
**Area**: tests

### Summary

在没有真实 Windows 验收和故障阶段证据时，把 Linux 上的 Win32 模拟测试与 Universal VSIX
静态审计过早解释为 Windows 产品问题已修复；用户实机反馈“Windows 依旧不能用”已否证该结论。

### Error

```text
Windows 依旧不能用
```

### Context

- 专项进度明确记录真实 Windows 主机不可用，验收项仍为 pending。
- 49 个聚焦测试只证明 mock 下的 shell、taskkill 和 fail-soft 契约，不证明真实 Windows
  Extension Host、PowerShell/CMD、任务存储、ripgrep、provider 请求或 Webview 时序正常。
- 现有持久化日志只有 Linux 模拟质量门，没有 Windows VS Code/VSCodium 实机输出。
- 历史证据表明“发送后不能用”还可能发生在终端执行之前，例如 ripgrep 资源缺失、半写入任务、
  provider 参数无效或 Agent Runtime 子进程退出；不能由操作系统相关性直接锁定终端层。

### Suggested Fix

先获得最小实机症状分流与 Windows Extension Host/Deeptask 输出尾部，再根据首个失败边界建立回归；
在 Windows VS Code 与 VSCodium 双编辑器真实验收通过前，不得将模拟测试标记为产品修复完成或发布。

### Metadata

- Reproducible: yes
- Related Files: DEEPTASK_WINDOWS_VSCODE_VSCODIUM_FREEZE_FIX_PROGRESS.md,
  EXTRA/output/windows-terminal-compat-quality.log
- See Also: ERR-20260726-001

---

## [ERR-20260727-001] vsix-changelog-entry-case

**Logged**: 2026-07-27T00:44:06+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

独立 VSIX 审计器假定 changelog ZIP 条目保留源文件大写，导致成功构建被误报为审计失败。

### Error

```text
KeyError: "There is no item named 'extension/CHANGELOG.md' in the archive"
```

### Context

- `vsce package` 已成功生成并完成内置品牌/身份审计的 `deeptask-5.5.5.vsix`。
- `vsce` 文件清单明确显示实际条目为 `extension/changelog.md`。
- 失败只在新增的独立审计器读取错误大小写时发生，不代表产物构建失败。

### Suggested Fix

VSIX 审计应以 ZIP 中实际规范化条目名为准，或建立大小写不敏感的条目映射；修复后只重跑轻量审计，避免重复完整构建。

### Metadata

- Reproducible: yes
- Related Files: EXTRA/bash/audit-execute-permission-vsix-5.5.5.py

### Resolution

- **Resolved**: 2026-07-27T00:44:58+08:00
- **Notes**: 审计器改为大小写不敏感 ZIP 条目映射；未重复构建，直接对既有 5.5.5 VSIX 轻量复验通过。

---
