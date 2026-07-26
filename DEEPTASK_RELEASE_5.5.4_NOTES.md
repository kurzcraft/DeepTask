# Deeptask 5.5.4

This patch prevents task startup from failing when a Windows VS Code or VSCodium installation does not provide a ripgrep binary.

## Fixed

- Resolve ripgrep from an explicit `RIPGREP_PATH`, supported editor layouts, packaged resources, development dependencies, or the system `PATH`.
- Handle Windows path separators and `rg.exe` lookup independently of the build host platform.
- Fall back to native Node.js filesystem scanning when ripgrep is missing or cannot be started.
- Preserve file limits, directory visibility, ignore rules, and task startup continuity in fallback mode.

## Verification

- 25 focused ripgrep resolution and file-listing tests passed.
- Backend TypeScript checking passed.
- Focused backend ESLint checks passed.
- Universal VSIX identity, version, runtime fallback markers, and assets were audited.

## Artifact

- `deeptask-5.5.4.vsix`
- Size: `42,427,390` bytes
- SHA-256: `3ae4a1ecf1706d8796f5a56cc76e27474f4b712af6bc2ec174b503092269f44a`
