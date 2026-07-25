# Deeptask terminal retention real runtime progress

- [x] Create third-round progress file for terminal retention still failing
- [x] Verify installed extension/VSIX contains the latest completion-order fix
- [x] Check whether terminal end event and provider paths actually trigger pruning
- [x] Fix the real runtime path that still fails to prune or prunes the latest terminal
- [x] Add tests covering the real trigger path
- [x] Run focused verification
- [x] Commit, push, rebuild VSIX, and update release
- [x] Store falsification and correction learning

## User Feedback

Terminal retention still fails: integrated terminal count still exceeds the configured limit, and pruning still removes the latest completed terminal. Desired behavior remains: after a terminal command ends, keep the latest N completed terminals and remove every earlier completed terminal.

## Falsified Hypothesis

- Falsified: unit tests over `pruneCompletedVscodeTerminals()` with explicit completion order are sufficient to fix the real runtime behavior.
- Falsified: publishing after `scripts_package_deeptask_vsix.sh` necessarily includes source changes in `src/dist/extension.js`.
- Confirmed evidence: source contains `completedTerminalOrder`, but `src/dist/extension.js`, the VSIX asset, and installed extension bundles did not contain it. The packaging script only checked that an old bundle existed, then removed `vscode:prepublish`, so VSIX packaging reused stale dist output.

## Fix

- `scripts_package_deeptask_vsix.sh` now runs `pnpm bundle --production` in `src` before packaging.
- The script now fails if `src/dist/extension.js` or the VSIX `extension/dist/extension.js` lacks `completedTerminalOrder` or `hasPendingWebviewAskResponse`.
- The script PATH now includes `/home/kurz/nodejs/node/bin`, because the fixed packaging flow needs `pnpm` and the previous narrowed PATH only exposed the temporary Node 20 `node/npm/npx` binaries.

## Verification

- Focused tests passed: `TerminalRegistry.spec.ts` and `executeCommandTool.spec.ts`, 2 files, 26 tests.
- First fixed packaging attempt failed because `pnpm` was not on the script PATH; this is now corrected.
- Fixed packaging script rebuilt `src/dist/extension.js`, produced `deeptask-5.5.0.vsix` with size `42,395,593` bytes, and verified the VSIX bundle contains both `completedTerminalOrder` and `hasPendingWebviewAskResponse`.
- Installed the rebuilt VSIX into both VS Code and VSCodium locations; both installed `dist/extension.js` files now contain `completedTerminalOrder` and `hasPendingWebviewAskResponse`.

## Constraints

- Collect small runtime evidence only.
- Do not read large VS Code logs or caches.
