# Deeptask 5.5.2

This patch hardens command execution on Windows and keeps task state recoverable when terminal processes fail or are cancelled.

## Fixed

- Align generated commands and Execa execution with the configured VS Code shell, including PowerShell and Command Prompt profiles.
- Use bounded Windows process-tree termination through `taskkill` instead of POSIX-only signal and process-list assumptions.
- Always release command busy state after startup, stream, or cancellation failures so chat can continue instead of remaining stuck.
- Keep the default execution provider consistent during startup state hydration, preventing an unexpected switch from the VS Code terminal to Execa.
- Preserve the Deeptask 5.5.1 fresh-install configuration and cancellation recovery fixes.

## Verification

- 49 focused terminal and command tests passed.
- TypeScript type checking and ESLint passed.
- Universal VSIX content and Windows runtime markers were audited.
- Installed and version-verified in VSCodium 1.121.03429 on Linux.

## Artifact

- `deeptask-5.5.2.vsix`
- SHA-256: `dd64a08f0fe0611585b77368ad2296ac1c4994a1c42f73d0ffd27d3fd9fd8fd6`
