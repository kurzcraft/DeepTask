#!/usr/bin/env bash
set -uo pipefail

ROOT="/media/kurz/aleber/vscode/deeptask"
LOG="$ROOT/EXTRA/output/verify-agent-queue-product-stability.log"
mkdir -p "$ROOT/EXTRA/output"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

status=0
run_step() {
  local name="$1"
  shift
  printf '\n===== %s =====\n' "$name"
  if "$@"; then
    printf 'PASS: %s\n' "$name"
  else
    local code=$?
    printf 'FAIL(%s): %s\n' "$code" "$name"
    status=1
  fi
}

run_step "webview queue and send UI tests" \
  bash -lc "cd '$ROOT/webview-ui' && pnpm exec vitest run src/components/chat/__tests__/ChatView.spec.tsx"
run_step "backend direct-routing tests" \
  bash -lc "cd '$ROOT/src' && pnpm exec vitest run core/webview/__tests__/webviewMessageHandler.spec.ts"
run_step "task continuation, condense, and dedupe tests" \
  bash -lc "cd '$ROOT/src' && pnpm exec vitest run core/task/__tests__/Task.spec.ts"
run_step "cancel rehydration tests" \
  bash -lc "cd '$ROOT/src' && pnpm exec vitest run core/webview/__tests__/ClineProvider.flicker-free-cancel.spec.ts"
run_step "terminal completion feedback tests" \
  bash -lc "cd '$ROOT/src' && pnpm exec vitest run core/tools/__tests__/executeCommandTool.spec.ts"
run_step "webview type check" \
  bash -lc "cd '$ROOT/webview-ui' && pnpm exec tsc --noEmit"
run_step "backend type check" \
  bash -lc "cd '$ROOT/src' && pnpm exec tsc --noEmit"

printf '\nLOG=%s\nFINAL_EXIT_STATUS=%s\n' "$LOG" "$status"
exit "$status"
