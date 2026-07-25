# Deeptask completed terminal limit progress

- [x] Create progress file and capture requirement
- [x] Locate terminal settings UI, config schema, and terminal lifecycle code
- [x] Add completed terminal limit enable checkbox and default count 3
- [x] Prune only Deeptask-created finished VSCodium integrated terminals
- [x] Add tests and run focused verification
- [x] Commit, push, and update release
- [-] Store final learning in universe memory

## Requirement

Add a terminal setting at the top of the plugin terminal settings area:

- A checkbox enables limiting completed terminals.
- Default completed terminal count is 3.
- The count limits only completed terminals created by Deeptask in VSCodium integrated terminals.
- Running command terminals must not count toward the limit and must not be closed.

## Memory Query

- Queried universe memory for Deeptask terminal setting and completed integrated terminal retention.
- Result: no direct matches found.

## Implementation

- Added global settings:
    - `terminalCompletedTerminalLimitEnabled`, default `true`.
    - `terminalCompletedTerminalLimit`, default `3`.
- Added terminal settings UI as the first terminal basic setting.
- Wired settings through extension state, save messages, startup initialization, and runtime registry setters.
- Added `hasCompletedCommand` to terminal state so the retention policy only applies after Deeptask command completion.
- Prunes only Deeptask-created VS Code integrated terminals where:
    - provider is `vscode`.
    - terminal is not busy or running.
    - terminal has no active process.
    - terminal has completed at least one Deeptask command.

## Verification

- Passed: `cd src && pnpm test integrations/terminal/__tests__/TerminalRegistry.spec.ts`
    - 8 tests passed.
- Passed: `cd webview-ui && pnpm exec vitest run src/components/settings/__tests__/SettingsView.change-detection.spec.tsx src/components/settings/__tests__/SettingsView.unsaved-changes.spec.tsx`
    - 2 test files passed, 3 tests passed, 5 skipped.

## Release

- Commit pushed to `main`: `65bdd37 feat: limit completed integrated terminals`.
- Release updated: `https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`.
- VSIX asset uploaded: `https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`.
- VSIX asset size: 43,754,047 bytes.
