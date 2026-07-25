# Deeptask terminal reuse prune progress

- [x] Create progress record for terminal reuse and stale completed terminals
- [x] Analyze TerminalRegistry reuse/prune strategy and setting semantics
- [x] Fix stale completed terminal cleanup and new command terminal selection
- [x] Add focused tests for same-terminal reuse and stale terminal pruning
- [x] Run tests and rebuild VSIX verification
- [x] Commit, push, and update GitHub release
- [x] Store learning

## User Feedback

Terminal retention limit of 3 now works, but new commands keep running in the same terminal. The two older completed terminals are not cleared.

## Working Hypothesis

The previous fix made the completed terminal cap effective, but the reuse policy likely keeps reusing the newest available completed terminal. If the completed set remains at the limit, reusing one existing terminal does not increase the count, so pruning is not triggered and older completed terminals can remain indefinitely. Desired behavior appears to be rotating/creating command terminals so each completed command becomes the newest terminal, allowing older completed terminals to fall out of the retained set.

## Fix

- Retained completed VS Code terminals are excluded from both task-local and global terminal reuse searches.
- New commands now create a fresh command terminal when only completed retained terminals match the cwd.
- When that fresh terminal completes, completion-order pruning keeps the newest configured N completed terminals and disposes the stale oldest terminal.

## Verification

- `pnpm exec vitest run integrations/terminal/__tests__/TerminalRegistry.spec.ts`: 1 file passed, 14 tests passed.
- `./scripts_package_deeptask_vsix.sh`: rebuilt and verified `deeptask-5.5.0.vsix`, size `42,395,714` bytes.
- VSIX contains `isRetainedCompletedTerminal` and `completedTerminalOrder`.
- Installed into VS Code and VSCodium; both installed `dist/extension.js` files contain `isRetainedCompletedTerminal` and `completedTerminalOrder`.

## Constraints

- Preserve the behavior that at most the configured number of completed terminals remain.
- Avoid killing active/running terminals.
- Keep changes minimal and covered by focused tests.
