# Deeptask 5.5.3

This patch improves Windows command stability and keeps dedicated provider model catalogs current without requiring an extension update.

## Fixed

- Align command startup and process cleanup with the configured Windows shell, including PowerShell and Command Prompt profiles.
- Use bounded Windows process-tree termination and always release command busy state after startup, stream, or cancellation failures.
- Preserve terminal completion and cancellation recovery guards so chat remains usable after command failures.
- Refresh DeepSeek, Groq, Mistral, and Cerebras model catalogs through their authenticated model APIs.
- Preserve the last known non-empty model catalog when discovery fails or returns an empty response.
- Migrate a removed selected model only after a successful authoritative catalog refresh, with deterministic fallback selection.

## Verification

- 49 focused Windows terminal and command tests passed.
- 56 focused provider catalog, selection, validation, and router tests passed.
- Backend and Webview TypeScript checks passed.
- Focused backend and Webview ESLint checks passed.
- Universal VSIX contents, identity, version, Windows runtime markers, and Webview assets were audited.

## Artifact

- `deeptask-5.5.3.vsix`
- Size: `42,426,415` bytes
- SHA-256: `e8fc5ecad298342d2578b11bc5314ffaf6fecdddbec3b77e4a79fbb30ce760b9`
