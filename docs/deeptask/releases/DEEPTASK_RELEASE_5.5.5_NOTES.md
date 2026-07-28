# Deeptask 5.5.5

This patch makes the Execute auto-approval permission a reliable master switch for command execution.

## Fixed

- Respect an explicit decision to disable the Execute auto-approval permission.
- Prevent an allowed-command wildcard (`*`) from bypassing the disabled Execute permission.
- Preserve existing allowed and denied command rules when Execute auto-approval is enabled again.

## Verification

- Four focused auto-approval tests passed, covering disabled/enabled Execute permission with wildcard and deny-list combinations.
- Backend TypeScript checking passed.
- Focused backend ESLint checks passed.

## Artifact

- `deeptask-5.5.5.vsix`
- Size: `42,427,391` bytes
- SHA-256: `8a6794b6e173b9c5a5b9640a80b56ecd73a4ff19024fdd20e6d1a2bb4d644670`
