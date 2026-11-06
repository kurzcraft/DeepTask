# Deeptask 9.3.3

## Condensed turns no longer reopen the original task

Rewriting summary prose was not enough. After condensation the stored view is still `[original first task, summary, keep]`. Providers treat that first user turn as the live instruction and ignore host state buried in the assistant summary, so the model restarts the original task.

9.3.3 reshapes the **request-time** API payload only:

- When a summary exists, the original first user turn becomes a background stub.
- `<current_task_state>` is merged onto the last keep-window user message, or inserted after the summary if the keep window has no user turn.
- Uncompressed turns do not inject a stub or host-state recap.

Stored history stays `[original first, summary, keep]` so rewind remains accurate.

## Local fallback summaries keep newest work, not the opening task

The 15-second local fast path used to dump the original `<task>` into Previous Conversation and count the host-state snapshot against the Current Work budget. That emptied Current Work, so every condensation looked identical. 9.3.3:

- Does not dump the original `<task>` into Previous Conversation.
- Excludes host-state snapshots from the Current Work budget.
- Strips a live task block from already-persisted bad summaries during reshape/flatten.

## Uncompressed turns no longer recap at every opening

The per-turn continuation prompt used to force “first show you understood / reply FIRST”. That recap fired even when there was no summary. Continuations now keep working on the current task without restating the original opening or old status. Defect-report wording is kept.

## Also in 9.3.3

- Preserve pre-condense progress: host EXTRA/task snapshots are deduplicated onto the live summary, truncation is tail-biased so newest milestones survive, and provider condensing input is bounded without slicing the host-state block.
- Align the keep window with the newest real user instruction so condensation cannot drop the latest continuation.

Falsification condition: condensed turns still reopen the original first task, or uncompressed turns still recap understanding/the original task, refutes this fix.

**Full Changelog**: https://github.com/kurzcraft/DeepTask/compare/9.3.2...9.3.3
