---
"kilo-code": patch
---

Fix the "force continue" stuck state after multi-line or quoted inline commands finish, recover swallowed terminal output via screen-transcript fallback, harden system-prompt rules requiring every command to be scripted under EXTRA/bash with teed logs in EXTRA/output, and stop parallel-conversation model cross-talk.
