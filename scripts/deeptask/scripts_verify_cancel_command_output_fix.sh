#!/usr/bin/env bash
set -euo pipefail

cd /media/kurz/aleber/vscode/deeptask/src
pnpm test \
  core/tools/__tests__/executeCommandTool.spec.ts \
  core/webview/__tests__/ClineProvider.flicker-free-cancel.spec.ts \
  core/webview/__tests__/webviewMessageHandler.spec.ts \
  integrations/terminal/__tests__/TerminalProcess.spec.ts \
  integrations/terminal/__tests__/TerminalShellExecutionStream.spec.ts \
  integrations/terminal/__tests__/TerminalProcessExec.bash.spec.ts

cd /media/kurz/aleber/vscode/deeptask
pnpm check-types
pnpm lint
git diff --check
