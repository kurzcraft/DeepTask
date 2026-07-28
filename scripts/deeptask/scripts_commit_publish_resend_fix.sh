#!/usr/bin/env bash
set -euo pipefail

cd /media/kurz/aleber/vscode/deeptask

git add \
  src/core/condense/index.ts \
  src/core/condense/__tests__/index.spec.ts \
  src/core/message-manager/index.ts \
  src/core/message-manager/index.spec.ts \
  src/core/task/Task.ts \
  src/core/task/__tests__/Task.spec.ts \
  src/core/webview/ClineProvider.ts \
  src/core/webview/__tests__/ClineProvider.flicker-free-cancel.spec.ts \
  src/core/webview/__tests__/webviewMessageHandler.edit.spec.ts \
  src/core/webview/__tests__/webviewMessageHandler.spec.ts \
  src/core/webview/webviewMessageHandler.ts \
  .changeset/fix-condense-reasoning-provider-leak.md \
  .changeset/fix-resend-tool-protocol-stuck.md \
  DEEPTASK_CONDENSE_REASONING_LEAK_PROVIDER_FIX_PROGRESS.md \
  DEEPTASK_RESEND_TOOL_PROTOCOL_STUCK_FIX_PROGRESS.md \
  scripts/deeptask/scripts_diagnose_resend_runtime.py

git commit -m "fix(task): make repeated resend continuation atomic"
git push origin main
git status -sb
git rev-parse --short HEAD
