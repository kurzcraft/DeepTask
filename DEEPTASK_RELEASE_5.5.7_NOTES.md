# Deeptask 5.5.7

This patch improves provider model discovery, streaming reasoning follow behavior, and cross-session task recovery.

## Improved

- Refresh DeepSeek, Groq, Mistral, and Cerebras model catalogs with the currently entered account credentials and endpoint.
- Isolate provider model caches by account scope while preserving manually entered model IDs and context overrides.
- Parse nested subscription catalog metadata and use a 256,000-token safety context for unknown dedicated-provider models.
- Keep streaming Agent reasoning pinned to the latest output across same-message growth and asynchronous Markdown layout changes.
- Respect explicit wheel, touch, keyboard, and scrollbar navigation, then restore automatic following when the user returns to the bottom.
- Store cross-session task progress files under `EXTRA/task/`, alongside long-command scripts in `EXTRA/bash/` and durable logs in `EXTRA/output/`.

## Verification

- 218 focused backend tests passed, with 1 existing test skipped.
- 56 focused Webview tests passed, with 12 existing tests skipped.
- Backend and Webview TypeScript checks passed.
- Focused backend and Webview ESLint checks passed.
- Prompt generation tests confirmed both injection paths require `EXTRA/task/` and reject workspace-root task progress files.
- Streaming scroll tests covered content growth, temporary bottom loss, wheel and touch intent, and resuming follow at the bottom.

## Artifact

- `deeptask-5.5.7.vsix`
- Final size and SHA-256 are recorded after packaging and authenticated release verification.
