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

## Continuity anchor comes from the full effective history, not the discarded half

Rewriting summary labels was not enough. The last assistant next-step almost always lives in the keep window; the discarded half is old tool tails. Searching only `messagesToSummarize` left Continuity anchor empty, recopied a D1 `read_file` as Current Work, and pinned stale host state in front of the live A4 statement.

9.3.3 now:

- Takes the continuity anchor, Current Work, and newest host state from the full effective history (discarded half + keep).
- Still builds Previous Conversation from the discarded half only.
- Quotes the live next-step as Current Work instead of dumping discarded-half tools.
- Falls back to the last `tool_use` as the declared step when keep has no prose.
- Strips fallback banners and empty “listed above” placeholders so they cannot compound on the next condensation.
- Prefers the last assistant statement over stale host state; only a later user instruction may override the anchor.

Field 2026-11-06 15:59: keep already held “先确认 backbone 输出通道和 enhance_losses 抽取路径…”, while the discarded half ended on a D1 `read_file`. After this change, condensed turns continue that keep-window step instead of reopening D1.

## Uncompressed turns no longer recap at every opening

The per-turn continuation prompt used to force “first show you understood / reply FIRST”. That recap fired even when there was no summary. Continuations now keep working on the current task without restating the original opening or old status. Defect-report wording is kept.

## Also in 9.3.3

- Preserve pre-condense progress: host EXTRA/task snapshots are deduplicated onto the live summary, truncation is tail-biased so newest milestones survive, and provider condensing input is bounded without slicing the host-state block.
- Align the keep window with the newest real user instruction so condensation cannot drop the latest continuation.

Falsification condition: condensed turns still reopen the original first task or discarded-half old work instead of the keep-window next step, or uncompressed turns still recap understanding/the original task, refutes this fix.

**Full Changelog**: https://github.com/kurzcraft/DeepTask/compare/9.3.2...9.3.3
