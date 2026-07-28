# Deeptask 5.5.9

Deeptask 5.5.9 keeps the newest user request authoritative after context condensation, repairs product documentation navigation, and removes Kilo/Roo commercial and support entry points from the user experience while retaining independent AI model providers.

## Continuation focus

- Preserve the newest user extension or correction as the active task boundary after context condensation.
- Retain verified checklist facts without allowing stale goals or completed work to override the latest instruction.
- Keep the local task-state capsule bounded and replace older capsules instead of accumulating repeated context.
- Avoid extra model requests: focus recovery remains local and adds no network round trip.

## Links and product boundaries

- Replace broken GitHub directory-style documentation URLs with direct links to real Chinese and English guide files in the repository.
- Keep repository, release, issue, documentation, and source actions on the Deeptask GitHub project.
- Remove user-facing Kilo/Roo commercial, Cloud account, organization indexing, upsell, community, social, pricing, and support entry points.
- Keep independent AI model provider configuration and provider documentation links available.
- Force the indexing badge onto the local Deeptask indexer so stale organization settings cannot reactivate managed commercial UI.

## Acceptance quality

- Add regression coverage proving long-running and resumed tasks do not display commercial upsells.
- Add direct documentation-link coverage and onboarding checks.
- Retain evidence-backed completion gates, cross-session progress under `EXTRA/task/`, durable command logs under `EXTRA/output/`, and task-specific long-command scripts under `EXTRA/bash/`.
- Keep real Windows acceptance as an explicit platform boundary when no Windows host is available; Linux automation is not reported as Windows hardware evidence.

## Verification

Completed before final packaging:

- Focused Webview regression: 4 files passed, 28 tests passed.
- Webview TypeScript check passed.
- User-triggerable Kilo/Roo commercial and support URL scan returned zero matches in production TSX sources.

Final source and local artifact acceptance completed:

- Focused backend regression: 2 files passed, 113 tests passed, 4 existing tests skipped.
- Focused terminal-state hydration regression: 1 test passed, 102 unrelated tests skipped.
- Focused Webview regression: 4 files passed, 28 tests passed.
- All 22 monorepo TypeScript or build-check tasks passed.
- All 18 monorepo ESLint tasks passed with no disabled rules.
- Clean ten-stage VSIX packaging passed package-level identity, link, runtime, focus-state, and stale-brand audits.
- VSCodium reports `deeptask.deeptask@5.5.9` installed.
- Authenticated GitHub Release asset verification by size and SHA-256 remains required after publication.

## Artifact

- `deeptask-5.5.9.vsix`
- Size: 40,404,490 bytes.
- SHA-256: `021af021cfb64c0e09862b9c210940d9494512c1d50cdbb31c846a65745df059`.
- The root and `bin/` artifacts are byte-identical; the published asset must match this size and hash.
