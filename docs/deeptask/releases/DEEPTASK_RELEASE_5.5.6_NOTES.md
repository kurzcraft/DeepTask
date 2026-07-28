# Deeptask 5.5.6

This patch restores reliable Git commit message suggestions for OpenAI-compatible reasoning models.

## Fixed

- Use the normalized streaming response path first for Git commit message generation.
- Avoid waiting indefinitely for non-streaming relay responses that hang or omit message content.
- Preserve a direct-completion fallback when the streaming response is empty or unavailable.
- Keep the existing 75-second timeout, cancellation handling, empty-response validation, and SCM command activation safeguards.

## Verification

- 21 focused tests passed across the lightweight completion handler and commit message generator.
- Backend TypeScript checking passed.
- Focused backend ESLint checks passed.
- The packaged VSIX passed identity, version, activation, command contribution, changelog, and runtime marker audits.
- Version 5.5.6 was installed and audited in both VSCodium and VS Code.
- The user confirmed the Git commit suggestion feature works in actual use.

## Artifact

- `deeptask-5.5.6.vsix`
- Size: `42,427,550` bytes
- SHA-256: `5f79dde87787ad184933c2ba412dff1aec8a59d6e0f6866369cfd92e38a14eba`
