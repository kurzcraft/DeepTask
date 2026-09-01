---
"deeptask": patch
---

Fix the "proceed while running" hard freeze with no buttons: a blocking ask that lost its webview broadcast (focus race / pending-new-conversation window / hidden webview) now re-posts the chat state every ~2.5s while waiting so controls reappear; typed text arriving with a stale askTs answers the pending ask instead of being dropped; ask responses route to the focused conversation's task instead of the stack-top background task.
