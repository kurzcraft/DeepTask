# Deeptask 9.3.6

## Historical commands stay collapsed; only the live last row expands

Historical command rows used to auto-expand whenever shell integration was disabled, and they always highlighted as `shell`. That mounted a Shiki token tree for every past command in the 64-row tail. 9.3.6 keeps historical output collapsed until the user expands it; only the live last command auto-expands. Historical command text renders as `txt` so Shiki is skipped. Diff highlighting now honors the same skip gate instead of building a token tree per hunk.

Field: projector identity-cache 3.9MB did not explain a 1.1GB renderer. The next holders were historical command CodeBlocks plus `highlightHunks` bypassing skip.

## Keep the first conversation on the main workspace

Starting a second parallel chat used to create a worktree and also evict the first conversation from the parent repo. The first chat now stays on the main workspace; only later chats get isolated worktrees.

## Isolate live command chrome

`commandExecutionStatus` used to bypass `shouldBroadcastTaskToChat` and paint Continue/Terminate over the focused conversation. 9.3.6 closes that hole:

- Host drops unscoped or background events via `shouldBroadcastCommandExecutionToChat`.
- Missing `taskId` is fail-closed: the host cannot prove the focused chat owns the event.
- The webview also fail-closes when the focused task id is known. A new task not yet in history still trusts the host.

Background shells must not replace the focused chat's Cancel with Continue/Terminate.

## Re-project in-place streaming updates

9.3.5 compact-projected appends, but same-ts `messageUpdated` replaces still swapped full image blobs back onto already-stripped rows inside the 800-row window. The projector now re-runs on in-place replaces (Scientist field: webview V8 3885/4096MB with resident ≈803 and tombstonedCount 1521).

## Omit unchanged same-ts images from incremental IPC

Fingerprint by length plus prefix/suffix; never hash the full base64. The webview merges omitted images back onto the resident row before projecting, so `JSON.parse` does not re-inflate the blob. Storage and model I/O stay full.

## Compress plugin system prompt without dropping hard rules

- `ask_followup_question` stays available even when timeout auto-selects the first suggestion.
- Skills catalog is short trigger + path; full text stays in `SKILL.md`.
- TASK PROGRESS FILE, MODES, SCRIPT-FIRST, SYSTEM INFORMATION, and RULES are de-duplicated so terminal `cd` no longer contradicts the workspace.
- Custom-layer prompts are not in this release.

## Keep the live provider when evolving

Switching `evolve` → `evolve-N` (or `evolve-N` → `evolve-M`) used to activate the new copy's sticky provider profile. Historical copies often still pointed at a stale default. 9.3.6 binds the live provider onto the new copy instead.

## Hide historical evolve copies from system-prompt MODES

The MODES catalog now lists the newest evolve copy only. Historical Evolve-N entries belong in `~/.deeptask/PROMPT_EVOLUTION_LOG.md`.

## Incremental transcript persist

Host used to `JSON.stringify` the entire `api_conversation_history` on every save (36MB+), doubling peak RSS. 9.3.6 copies frozen prefix bytes from disk and stringifies only the dirty tail. Unchanged saves skip I/O. After resume, a sidecar of fingerprints and byte offsets reuses that prefix. If the sidecar is missing (upgrade or persist failure), resume still seeds those offsets from the already-read JSON bytes instead of stringifying the parsed prefix.

Do not treat a WeakRef miss as a full rewrite. Condense, rewind, slice, and GC used to drop identity on the first row and stringify the whole 38MB history. Fingerprints still copy the on-disk prefix; only a real content mismatch dirties from that row. Same-file saves are serialized, and the sidecar is committed before the lock is released so overlapping saves cannot stringify the prefix or leave a stale `.inc-idx.json`.

First writes and stale on-disk size checks no longer stringify the same history twice. The in-lock path reuses the pre-lock dirty snapshot instead of snapshotting the whole array again.

## Follow-up suggestions do not switch mode or provider

Clicking an `ask_followup_question` option used to send `suggestion.mode` through `handleSuggestionClickInRow` → `switchToMode` → sticky `activateProviderProfile`. Options now keep `mode: null`; the tool forwards `{ answer }` only. A real mode change still goes through `switch_mode` / `manage_mode`.

## Continuous full-history list, not a 64-row sliding page

64-row sliding pages broke scroll continuity. The body is one continuous Virtuoso list of every saved row. Historical payloads keep a 120-char preview so a 13k-row / 22MB snapshot stays under 3MB of IPC JSON; the newest 64 rows stay 8k-truncated and images cap at 4 rows. Storage and model I/O stay full. The left user-message rail is a light full-history index (`ts` + placement index + capped preview); clicking a tick jumps inside the same list.

## Projector identity cache keeps only the final clone

Cheap-previewing historical rows was not enough: the projector cached `{source, clone}`, so every 8k/base64 payload stayed pinned after React had already switched to the preview. Compact and image-strip now happen in one object; the cache stores only that clone. Field: renderer still at 90% after the previous compact-only pass until Reload replaced pid 4102873 (rss ≈4.1GB, started 2026-11-14) with a new renderer (rss 379–620MB, OVERFLOW=False). Infinite-run gray-screen is not claimed; host full `clineMessages`, Shiki, and live command output remain the next candidates.

Falsification condition: historical command rows still auto-expand or highlight as `shell` without `isLast`, `highlightHunks` still builds a Shiki tree for `txt`/oversized hunks, starting a second parallel chat still evicts the first conversation from the parent repo, a background conversation running a command still paints Continue/Terminate over the focused Cancel, a same-ts streaming update still re-inflates a previously stripped image blob, evolving to a new copy switches the live provider, the system-prompt MODES list still enumerates historical Evolve-N copies, the compressed prompt drops `ask_followup_question` / TASK PROGRESS FILE / SCRIPT-FIRST hard rules, a resume/save of a large `api_conversation_history` still doubles host RSS because the prefix was fully stringified, a WeakRef miss / overlapping save still `JSON.stringify`s the frozen prefix, a first write or stale-size rewrite still stringifies the same rows twice, clicking a follow-up suggestion still switches mode or provider, scrolling a long transcript still drops rows or jumps position, or after Reload a long session's renderer still grows linearly because historical command CodeBlocks or diff hunks pin Shiki token trees.

**Full Changelog**: https://github.com/kurzcraft/DeepTask/compare/v9.3.5...v9.3.6
