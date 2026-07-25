#!/usr/bin/env bash
set -euo pipefail

cd /media/kurz/aleber/vscode/deeptask/src
pnpm test \
  core/webview/__tests__/ClineProvider.flicker-free-cancel.spec.ts \
  core/webview/__tests__/webviewMessageHandler.spec.ts \
  core/webview/__tests__/webviewMessageHandler.edit.spec.ts \
  core/message-manager/index.spec.ts \
  core/task/__tests__/Task.spec.ts

cd /media/kurz/aleber/vscode/deeptask
pnpm check-types
pnpm lint
