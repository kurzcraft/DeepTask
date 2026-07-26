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
**Status**: in_progress
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

---
