# Learnings

## [LRN-20260807-001] correction

**Logged**: 2026-08-07T10:58:00Z
**Priority**: critical
**Status**: in_progress
**Area**: backend

### Summary

Editing and resending an earlier user message can still expose reasoning from the discarded future branch to the replacement model request.

### Details

The earlier implementation established a strict local rewind, forced persistence, and an instance-scoped Responses session ID. User observation demonstrates that these controls are insufficient as an end-to-end guarantee: a replacement request can still contain or recover old future-branch context. The durable acceptance criterion is request-level isolation: after editing a turn, the first replacement request may contain only the proven pre-edit prefix plus the new edited content, and must not contain discarded assistant output, summaries that cover it, or an opaque continuation reference to it.

### Suggested Action

Trace the edit-confirmation, disk-reload, continuation construction, effective-history filtering, and provider request paths. Add an integration-style regression that captures the first replacement request and asserts exclusion of distinct old-branch sentinel text, including summary/truncation and no-timestamp variants. Preserve the existing strict persistence and unique provider-session protections.

### Metadata

- Source: user_feedback
- Related Files: src/core/webview/webviewMessageHandler.ts, src/core/message-manager/index.ts, src/core/task/Task.ts, src/api/providers/openai-native.ts, src/api/providers/openai-codex.ts
- Tags: edit-resend, branch-isolation, history-persistence, request-payload, regression
- Pattern-Key: harden.edit_resend_branch_isolation
- Recurrence-Count: 1
- First-Seen: 2026-08-07
- Last-Seen: 2026-08-07

---
