---
"kilo-code": patch
---

Root-fix for ghost subagents: settled subagents are evicted from the task stack when they finish, cancelling a focused subagent no longer rehydrates it back to life, the parallel-session stop button clears non-running zombie sessions, and the subagent/workspace permission toggles now round-trip real persisted values instead of always rendering ON.
