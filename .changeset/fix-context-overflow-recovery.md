---
"kilo-code": patch
---

Recover from context window overflow by reducing context before retrying, with a retry cap to avoid loops.
