---
"deeptask": patch
---

Fix the parallel-conversation running spinner disappearing when a finished task is reopened: stale `completedAt` is cleared on session reuse, the live-task broadcast no longer skips actively running tasks that still carry the marker, and the rail treats a running session as running even when the marker lingers.
