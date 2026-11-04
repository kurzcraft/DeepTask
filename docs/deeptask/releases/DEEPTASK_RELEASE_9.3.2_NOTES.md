# Deeptask 9.3.2

## Subagent transcript memory bound (the last gray-screen gap)

9.3.1 bounded only the MAIN conversation transcript. Subagent sessions (`parallelSessionMessages`) still accumulated verbatim — a 3-day image-reading run pushed the renderer to 5.4GB and system memory to 92% (host stayed at ~1.1GB).

- **Per-session projectors**: every subagent session now flows through its own `boundTranscript` projector (tombstones + batched boundary + reset semantics identical to the main conversation). Projectors are released when their session disappears.
- **Image budget inside the verbatim window**: even within the 800-row tail, only the newest 24 image-bearing rows keep their `images` payloads; older image rows are cloned without images (text preserved, clone identity stable per ts+source object so `messageUpdated` replacements rebuild correctly).
- **Subagent panel**: tombstoned rows are filtered out and the same collapsed-messages banner appears.

Falsification condition: a long subagent image-reading run whose renderer anon memory still grows linearly after 9.3.2 refutes this fix.

## Docs

- README.md / README_EN.md now document the multi-level task-splitting folder system (authoritative checklist + `<short-title>/` light files + `finished/` archive).
- Marketplace descriptions (en/zh-CN) mention the folder system.

**Full Changelog**: https://github.com/kurzcraft/DeepTask/compare/9.3.1...9.3.2
