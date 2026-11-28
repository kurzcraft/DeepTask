# Deeptask 9.3.9

## Folder-rail spinner after completion

Soft `attempt_completion` paints a green `completion_result` without emitting `TaskCompleted`. A leftover `commandExecutionStatus` of `started`/`output` used to count as occupancy, and `runBroadcast()` only upgraded sessions to `running`. That combination pinned the left folder rail on the spinner after the loop had already ended.

9.3.9:

- `getLiveTasks()` / `syncLiveTask()` follow `isActivelyRunningTaskLoop()` (or `isStreaming` when the loop helper is missing). Leftover live-command entries do not keep occupancy.
- Broadcast downgrades an in-memory `running` session when the matching live task is idle, and writes that status back so the next broadcast cannot resurrect the spinner.
- `initiateTaskLoop` `finally` calls `syncLiveTask` after the loop generation that produced the completion exits.

Wait-command loops that are still active keep the spinner.

## Version lock

Local packaging no longer refuses versions other than 9.3.8. Iteration follows `src/package.json`.
