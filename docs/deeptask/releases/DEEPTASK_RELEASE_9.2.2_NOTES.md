# Deeptask v9.2.2 Release Notes

## Subagent & Todo Reliability

- **Subagent results no longer double-truncated**: per-subagent result cap raised from 4 000 to 20 000 characters (`dispatch_subagents`) and the ParallelManager fallback extraction tail from 2 000 to 8 000. Long structured results (file inventories, diffs, analysis reports) now survive intact.
- **`update_todo_list` fails fast on wrong format**: a non-empty payload that parses to zero checklist items (plain-text arrays, JSON objects, prose) now returns an explicit error with the exact expected markdown checklist format. Both expansion gates append the same hint, so the retry succeeds instead of looping on "expansion required".

## Background Task Green Dot

- **The green unread dot now reliably appears when a background conversation finishes**: the rail remembers a conversation as "seen running" until its `completedAt` marker actually arrives (even in a later broadcast frame) and consumes the transition exactly once per run. Reopened conversations re-arm the notification.

## Conversation Ordering

- **Deterministic conversation order**: new conversations use a monotonic in-process clock (same-millisecond creations no longer tie), and both sort paths fall back to `createdAt` then `id`, so equal-`lastActiveAt` rows can never swap between renders.

## Mode Evolution

- **`manage_mode` copy/update on a numbered series numbers the fork as the next sibling** (`evolve-3` → `evolve-4`, not `evolve-3-1`), writes a delta description ("相比 evolve-3 的更新: …") that outranks the inherited source blurb, and switches the current task to the new copy immediately.
- **The bottom-left mode dropdown pins the current mode first** and shows each mode's description as subtitle text, making numbered evolve variants distinguishable at a glance.

## Install

```bash
codium --install-extension deeptask-9.2.2.vsix --force
```

Requires a window reload after installation.
