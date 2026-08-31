---
"kilo-code": patch
---

Fix the agent ignoring short negative user feedback like "没有用" or "didn't work" after a repair attempt: continuation guidance is now semantic and chat-first (every user message first gets a natural conversational reply; failure diagnosis and a materially different approach follow within the same reply), and bare negative replies now expand the progress list as executable defect feedback.
