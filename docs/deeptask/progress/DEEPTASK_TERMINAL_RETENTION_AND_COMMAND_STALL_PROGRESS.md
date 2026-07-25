# Deeptask terminal retention and command stall progress

- [x] Create regression progress file
- [x] Locate why the retention limit counts the terminal selected for a new command
- [x] Fix completed terminal retention so a terminal being reused for execution is not counted as retained completed terminal
- [x] Locate why the latestLog/tail/readlink command stalls
- [x] Fix command parsing behavior for command substitution assignment
- [x] Add dynamic terminal-state detection and regression tests
- [x] Run focused verification
- [x] Commit, push, rebuild VSIX, and update release
- [-] Store final learning in universe memory

## Reported Issues

### Terminal Retention

When the completed terminal limit is set to 3 and two completed terminals are kept, starting a command keeps only two terminals including the terminal being used to execute the command. Expected behavior: the currently executing terminal must not count against the completed-terminal retention limit.

A later observation showed the opposite edge after command completion: when the limit is set to 4, a command can finish with 5 completed terminals. This indicates completed-terminal pruning must dynamically inspect terminal state after completion, and, if simple/safe, include cross-session Deeptask-created integrated terminal leftovers in the count.

### Command Stall

The following command can still get stuck:

```bash
latestLog=$(ls -t /home/kurz/Obsidian/任务记录/vscodium-code9-config-fix2-stable-backup-*.txt 2>/dev/null | head -1); echo "LOG=$latestLog"; tail -n 120 "$latestLog" 2>/dev/null || true; echo '## latest'; readlink -f /home/kurz/Obsidian/VSCodium配置备份/latest; echo '## latest files'; ls -l /home/kurz/Obsidian/VSCodium配置备份/latest/SHA256SUMS.txt /home/kurz/Obsidian/VSCodium配置备份/latest/extensions-list.txt 2>/dev/null
```

## Memory Query

- Queried universe memory for Deeptask terminal retention and command stall history.
- Result: no direct matches found.

## Findings

- Retention issue 1 root cause: when a completed terminal is selected for reuse, it was moved to the end of the registry but still had `hasCompletedCommand = true` until the command actually started. During this window, pruning still counted it as a completed terminal. Fix: `markTerminalInUse()` clears `hasCompletedCommand`.
- Command parsing root cause: `parseCommand()` treated any token containing a `__SUBSH_*__` placeholder as an independent subshell command. For `latestLog=$(ls ... | head -1)`, this dropped the assignment prefix and exposed the inner pipeline as top-level commands. Fix: only standalone `__SUBSH_*__` tokens are emitted as independent commands; embedded placeholders remain in their parent token.
- Dynamic completion root cause: pruning only considered registry-tracked completed terminals, so cross-session Deeptask integrated terminals could remain outside the count. Fix: pruning now dynamically scans `vscode.window.terminals`, maps tracked completed Deeptask terminals back to their VS Code terminals, and also counts open untracked `Kilo Code` integrated terminals as legacy Deeptask terminals.
- Trim-order root cause: registry insertion/reuse order did not necessarily match the visible integrated-terminal list. Fix: pruning uses `vscode.window.terminals` order, so the topmost visible completed Deeptask terminal is closed first when the limit is exceeded.

## Verification

Ran focused tests from `src` after formatting:

```bash
pnpm exec vitest run integrations/terminal/__tests__/TerminalRegistry.spec.ts shared/__tests__/parse-command.spec.ts core/auto-approval/__tests__/commands.spec.ts
```

Result: 3 test files passed, 35 tests passed.

## Release

- Code commit: `c62639e fix: stabilize completed terminal retention`
- Release URL: `https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`
- VSIX asset: `https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`
- VSIX asset size: 43,754,048 bytes
