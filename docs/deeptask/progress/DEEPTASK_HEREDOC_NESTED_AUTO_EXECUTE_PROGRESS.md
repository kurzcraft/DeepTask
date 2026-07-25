# Deeptask nested heredoc auto execute follow-up progress

- [x] Re-query universe memory and create progress checklist
- [x] Locate why command containing nested Python heredoc still does not auto-execute
- [x] Fix auto-execute parsing/completion and add exact reproduction tests
- [x] Run focused verification
- [x] Commit, push, and update release
- [-] Store final learning in universe memory

## Observation

The prior fix preserved heredoc command blocks for command auto-approval parsing. The user reports a still-failing command whose outer heredoc writes a shell script and whose script body contains an inner Python heredoc: `python3 - <<'PY' ... PY`.

## Memory Query

- Initial query containing heredoc operators failed because Obsidian parsed `<<` as a comparison operator.
- Retried query without special operators and found `宇宙/记忆/项目记忆/2026-07-05-Deeptask-heredoc命令自动执行修复.md`.

## Root Cause

`parseCommand()` already preserved the outer heredoc block and returned two commands, but `getCommandDecision()` still returned `ask_user` because `containsDangerousSubstitution()` scanned the full raw command string. The quoted heredoc body contains Python f-strings and shell text such as `${stamp}`; those are data written into the script, not current-shell syntax.

The safety scan now skips only heredoc bodies whose delimiters suppress shell expansion, such as `<<'EOF'`, `<<"EOF"`, and `<<\EOF`. Unquoted heredoc bodies still participate in dangerous substitution scanning because the shell expands them at runtime.

## Verification

- Ran focused tests from `src`:

```bash
pnpm test core/auto-approval/__tests__/commands.spec.ts shared/__tests__/parse-command.spec.ts core/tools/__tests__/executeCommandTool.spec.ts
```

- Result: 3 test files passed, 35 tests passed.
- Re-ran the exact nested heredoc diagnostic script; `getCommandDecision()` now returns `auto_approve` for the reported command with wildcard auto-approval.

## Release

- Commit pushed: `bb947c8 fix: ignore quoted heredoc bodies in safety scan`.
- Release updated: `https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`.
- VSIX asset: `https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`.
- Asset size: 43,748,719 bytes.
