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
