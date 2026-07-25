# Deeptask command still stuck heredoc progress

- [x] Create progress file for the remaining command-stuck reproduction
- [x] Review execute_command state flow for the reported heredoc append command
- [x] Add minimal regression coverage for no-output/quick-exit command completion
- [x] Fix remaining command completion wait state
- [x] Run focused verification
- [x] Commit, push, rebuild VSIX, and update release
- [ ] Store final learning in universe memory

## Reported Command

```bash
cat >> /home/kurz/Obsidian/任务集合/进度清单-VSCodium-KiloCode启动报错配置修复-20260705.md <<'MD'
- [x] 2026-07-05 14:11 用户反馈“还是失败”：已否证“重新启用 KiloCode + 规范化 allowedCommands”足以解决 `code:9` 的假设；下一步只采集小范围运行时错误证据，不读取大日志/大缓存。
MD
```

## Initial Interpretation

- The previous fix reduced one self-supersede path but the reported command still stalls.
- The command is a fast heredoc append that can complete with little or no terminal output.
- The next hypothesis to test is that completion can happen before any command-output ask is actually created or before the auto-response path has a live consumer, leaving the task waiting on a different state than the prior fix covered.

## Fixes

- Command completion now waits briefly for a fast `command_output` ask to become observable before sending the automatic `yesButtonClicked`, preventing a fast heredoc/no-output command from racing ahead of ask creation.
- Completed terminal retention now records explicit command completion order and keeps the latest completed N terminals, pruning all earlier completed terminals. It no longer sorts registered terminals by creation ID.
- Reusing a completed terminal clears its completion order before the next command starts, and every command end path marks completion then prunes.

## Verification

- `cd src && pnpm exec vitest run core/tools/__tests__/executeCommandTool.spec.ts`: 1 file passed, 13 tests passed.
- `cd src && pnpm exec vitest run integrations/terminal/__tests__/TerminalRegistry.spec.ts`: 1 file passed, 13 tests passed.
- Combined command/webview/chat regression before terminal follow-up: backend 3 files passed, 37 tests passed; frontend ChatView 1 file passed, 6 tests passed, 12 skipped.

## Memory Query

- Queried universe memory for Deeptask command still stuck, code 9, VSCodium KiloCode startup configuration repair.
- Result: no direct matches found.

## Release

Commit pushed:

```text
14f185b fix: stabilize fast commands and terminal retention
```

GitHub release updated:

```text
Release: https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0
VSIX: https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix
Asset size: 43,754,048 bytes
```
