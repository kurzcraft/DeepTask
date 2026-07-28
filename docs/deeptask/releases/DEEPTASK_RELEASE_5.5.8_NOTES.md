# Deeptask 5.5.8

Deeptask 5.5.8 strengthens long-running Agent work from execution through acceptance: background commands remain visible and bounded, new feedback regains focus after context condensation, cross-session state becomes easier to recover, and model configuration reflects the account and endpoint currently in use.

## Long-running work

- Keep development servers, watchers, builds, training jobs, and other active commands visible in real VS Code or VSCodium integrated terminals, where each job can be inspected or stopped independently.
- Converge completed integrated terminals to the configured retention limit across command completion, shell exit, cancellation, and fallback finalization paths without pruning active jobs.
- Store cross-session checklists under `EXTRA/task/`, long-command scripts under `EXTRA/bash/`, and durable logs and release evidence under `EXTRA/output/`.
- Preserve the newest extension or correction as the active work boundary after context condensation and post-completion continuation instead of repeating an obsolete result.
- Keep completion evidence-driven: unfinished checklist items, missing tool-backed work, and absent verification continue to block a premature final result.

## Models and APIs

- Refresh DeepSeek, Groq, Mistral, and Cerebras model catalogs with the credentials, endpoint, and subscription information currently entered in settings.
- Isolate provider model caches by account scope so changing an account or endpoint cannot silently reuse another catalog.
- Preserve manually entered model IDs and support model-bound context-window overrides for dedicated providers.
- Parse nested provider metadata and distinguish trusted detected limits from conservative safety estimates.
- Improve OpenAI-compatible context and output-token detection while retaining explicit manual overrides.
- Use a 256,000-token safety context for unknown dedicated-provider models when trusted metadata is unavailable.

## Interaction stability

- Keep streaming Agent reasoning pinned to the latest output across same-message growth and asynchronous Markdown layout changes.
- Respect wheel, touch, keyboard, and scrollbar navigation, then restore automatic following when the user returns to the bottom.
- Preserve direct feedback delivery while commands are active so mid-task corrections do not become an inert queue.
- Respect the disabled Execute permission even when wildcard command approval is configured.
- Retain cancellation recovery, fresh-install provider guards, Windows bounded process-tree termination, and ripgrep filesystem fallback behavior from the preceding stability releases.

## User experience and documentation

- Rebuild the Chinese and English project homepages around concrete workflows: visible background terminals, fully managed and human-reviewed operation, continuous correction, EXTRA recovery, broad OpenAI-compatible access, and evidence-backed completion.
- Make GitHub the dominant first-screen action with current repository, release, issue, and star links.
- Add complete Chinese and English user guides covering installation, model configuration, permissions, long-running work, integrated terminals, EXTRA, context recovery, acceptance, and troubleshooting.
- Improve Marketplace title, description, keywords, brand image, documentation navigation, and long-task value proposition.
- Package the Marketplace hero image locally and reject releases whose README, repository URL, GitHub action, documentation link, or brand asset is missing from the actual VSIX.

## Project organization

- Move Deeptask release notes, progress records, analysis, guides, reports, and dedicated automation into stable `docs/deeptask/`, `artifacts/deeptask/`, and `scripts/deeptask/` boundaries.
- Keep the repository root focused on product entry points and standard monorepo configuration while preserving file history through Git renames.
- Replace the obsolete legacy-artifact packaging guide with the current ten-stage rebuild, package audit, VSCodium installation, and authenticated release workflow.

## Verification

The release is accepted only after all of the following complete against the final source baseline:

- 15 focused backend test files passed: 411 tests passed and 8 existing tests skipped across provider catalogs, terminal retention, continuation focus, completion gates, context condensation, and auto-approval.
- 4 focused Webview test files passed: 73 tests passed and 14 existing tests skipped across provider settings, API options, chat output following, and Agent Manager scrolling.
- All 22 monorepo TypeScript or build-check tasks passed.
- All 18 monorepo ESLint tasks passed with no disabled rules.
- A clean ten-stage VSIX build that force-rebuilds both Webview and extension bundles.
- Package-level audit of identity, runtime markers, Marketplace content, local brand assets, and known stale-brand exclusions.
- Forced installation into VSCodium and verification of `deeptask.deeptask@5.5.8`.
- Authenticated comparison of the published GitHub Release asset against the local VSIX by size and SHA-256.

Real Windows VS Code and VSCodium acceptance remains an explicit platform boundary when no Windows host is available; Linux automation is not reported as Windows hardware evidence.

## Artifact

- `deeptask-5.5.8.vsix`
- Final file size and SHA-256 are recorded after packaging and authenticated remote-asset verification.
