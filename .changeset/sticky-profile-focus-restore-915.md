---
"kilo-code": patch
---

Fix parallel-conversation provider/model memory pollution: switching provider or model inside a brand-new not-yet-created conversation no longer overwrites the remembered profile and task history of the older conversation at the stack top, and all sticky-persist, profile-activate, and focused-restore paths now resolve their target task through one shared focus-aware resolver.
