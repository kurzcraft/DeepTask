<p align="center">
  <img src="./assets/deeptask-logo-v2.png" alt="Deeptask compass logo" width="512" />
</p>

<h1 align="center">Deeptask</h1>

<p align="center">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  An AI coding agent engineered for long-running tasks and production delivery.<br />
  Beyond code generation: sustained focus, reliable execution, continuous verification, and recoverable delivery.
</p>

<p align="center">
  <a href="https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0">Download</a>
  ·
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="#why-deeptask">Key Improvements</a>
  ·
  <a href="#architecture">Architecture</a>
</p>

> **First production release: v5.5.0**
>
> Deeptask evolves from the proven Kilo Code 5.5.0 architecture with systematic hardening for message delivery, terminal lifecycle management, context condensation, task continuation, and delivery verification.

## What is Deeptask?

Deeptask is an open-source AI coding agent for VS Code and VSCodium. It understands natural-language requirements, reads and modifies projects, executes terminal commands, invokes tools, maintains task checklists, and advances complex work across long contexts.

Rather than treating a task as a one-shot code-generation request, Deeptask models it as a recoverable state machine. Users can add requirements during execution, resume after interruption, and extend completed work with new goals. The agent preserves valid history, refocuses on the latest instruction, and delivers only after concrete verification.

## Why Deeptask?

### 1. Direct message delivery without queue-induced friction

- User messages follow a single backend consumption path instead of depending on a fragile visible waiting queue.
- Pause, cancellation, command wait, and post-completion continuation states have explicit routing, preventing silent message loss.
- A short 1.5-second window suppresses only identical duplicate submissions; distinct consecutive instructions remain unaffected.
- Waiting indicators do not repeat full message bodies, keeping the conversation readable and avoiding the appearance of duplicate sends.

### 2. Predictably bounded integrated terminals

- Deeptask retains only the three most recent completed integrated terminals by default; the limit is configurable.
- Running terminals are excluded from the completed-terminal limit and are never closed as part of completed-terminal pruning.
- Convergence checks run when commands complete, shells exit, fallback completion occurs, and terminals are reused, reducing race-induced limit violations.
- Command output is persisted before it is returned to the model. Empty output, non-zero exits, duplicate completion events, and missing shell events all resolve to deterministic terminal states.
- Long commands follow a script-file, durable-log, and read-back verification workflow to reduce stalls and output loss.

### 3. Preserved focus after context condensation

- Automatic and manual condensation share input sanitation, summary instructions, provider selection, tool protocol, and focus anchors.
- Condensed history is committed transactionally: invalid token counts, stale results, and failed summaries cannot corrupt the original conversation.
- When automatic summarization fails, Deeptask can generate a budgeted local structured summary that preserves the initial objective, latest user instruction, key decisions, and recent evidence.
- Reasoning traces and environment noise are filtered, while native tool-call pairs are repaired to prevent protocol errors after condensation.
- Manual failures are reported explicitly. Automatic failures prioritize safe task continuation. Successful output quality remains aligned across both paths.

### 4. Feedback becomes a first-class work turn

- A requirement submitted after completion is atomically registered by the host as new in-progress work instead of prompting a repetition of the previous conclusion.
- Existing checklist state and genuine completions are preserved while the latest feedback is classified as an extension, revision, or replacement objective.
- History restoration, cross-workspace continuation, and edited-message resend share one task loop, preventing concurrent loops from competing over state.
- The agent cannot close a new turn with an empty or premature completion before performing concrete tool-backed work.
- Final delivery is constrained by unresolved checklist items and actual verification evidence, reducing the gap between apparent and real completion.

### 5. Productive defaults with transparent configuration

- Fresh installations open directly into the Deeptask workspace without a mandatory onboarding flow.
- OpenAI Compatible is the default provider. Users supply their own endpoint, model, and API key; no credentials are embedded in the repository or release package.
- Context-window limits can be detected from model metadata, with editable fallback values for unknown compatible models.
- Code, Architect, Debug, and other mode-based workflows remain available alongside custom modes and MCP extensions.

## Key improvements over the Kilo Code 5.5 baseline

Deeptask respects and inherits Kilo Code's extension host, tool system, provider ecosystem, and React Webview foundation. The branch is not a cosmetic rebrand; its primary differences are engineering improvements for sustained task execution.

| Area | Kilo Code 5.5 baseline | Deeptask focus |
| --- | --- | --- |
| User messages | General ask and queue interaction | Direct single-entry delivery, atomic cancellation continuation, precise short-window deduplication |
| Integrated terminals | General terminal execution and reuse | Hard completed-terminal limits, running-terminal protection, deterministic output finalization |
| Context condensation | Summarization and sliding-window management | Transactional commit, local structured fallback, latest-task focus anchoring |
| Post-completion feedback | General task restoration | Host-managed feedback turns, preserved checklist state, one active loop |
| Delivery verification | Model-driven completion | Concrete-work gating, unresolved-item constraints, premature-completion rejection |
| Default experience | General Kilo service configuration | OpenAI Compatible defaults and a Deeptask-branded workspace |

These statements are supported by implementation and regression tests in this repository. They are not intended as a comprehensive comparison with other or newer Kilo Code releases.

## Core capabilities

- Generate, modify, and refactor code from natural-language requirements
- Read project context and implement coordinated cross-file changes
- Execute terminal commands and track their output lifecycle
- Maintain task checklists and recoverable progress files
- Condense long conversations automatically or manually
- Connect to OpenAI Compatible and other model providers
- Use Architect, Code, Debug, and custom modes
- Extend tooling through MCP, browser automation, and Agent Manager
- Support inline completion and standalone CLI / Agent Runtime architectures

## Quick start

### Install

Download `deeptask-5.5.0.vsix` from [GitHub Release v5.5.0](https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0).

Install in VSCodium:

```bash
codium --install-extension ./deeptask-5.5.0.vsix --force
```

Or install in VS Code:

```bash
code --install-extension ./deeptask-5.5.0.vsix --force
```

You can also open the Extensions panel menu and select **Install from VSIX...**.

### Initial configuration

1. Open Deeptask settings.
2. Select the default **OpenAI Compatible** provider.
3. Enter the API base URL, API key, and model ID.
4. Detect or manually specify the context-window size when needed.
5. Create a task and describe the expected result, acceptance criteria, and constraints.

> API keys are configured locally by the user. The repository and production release do not contain credentials.

## Recommended workflow

1. **Define the objective:** describe the feature, fix, or research result to deliver.
2. **Specify acceptance criteria:** include test scope, artifact paths, installation targets, or release requirements.
3. **Provide feedback continuously:** add requirements during execution without waiting for the previous turn to finish.
4. **Track structured progress:** Deeptask preserves completed items and appends concrete new work.
5. **Require evidence:** pair code changes with tests, command logs, build artifacts, or installation verification.

## Architecture

```text
VS Code / VSCodium
├── React Webview                         Chat, settings, tasks, and Agent Manager
├── Extension Host
│   ├── ClineProvider / Webview Handler   State synchronization and message routing
│   ├── Task Runtime                      Single task loop, continuation, condensation, completion gating
│   ├── Tool System                       File, command, MCP, browser, and other tools
│   ├── Terminal Integration              Command execution, output capture, and terminal retention
│   └── Provider Layer                    OpenAI Compatible and other model adapters
└── Agent Runtime / CLI                   Standalone agent processes and command-line entry points
```

### Repository layout

- `src/`: VS Code extension host, task runtime, providers, tools, and services.
- `webview-ui/`: React chat, settings, marketplace, and Agent Manager interfaces.
- `packages/`: shared types, IPC, telemetry, cloud services, and Agent Runtime.
- `cli/`: standalone command-line package.
- `apps/`: documentation, Storybook, and end-to-end applications.
- `jetbrains/`: JetBrains plugin and Node.js host.

## Local development

Requirements: Node.js 20.20.0 and pnpm 10.8.1. See [`DEVELOPMENT.md`](./DEVELOPMENT.md) for complete instructions.

```bash
pnpm install
pnpm check-types
pnpm lint
```

Focused tests must run from the workspace that declares Vitest. For example:

```bash
cd src && pnpm test core/task/__tests__/Task.spec.ts
cd webview-ui && pnpm test src/components/chat/__tests__/ChatView.spec.tsx
```

Build the production VSIX:

```bash
./scripts_package_deeptask_vsix.sh
```

## Quality and contribution standards

- New features and bug fixes require regression coverage.
- Changes to shared upstream code retain `kilocode_change` markers to reduce future synchronization conflicts.
- API keys, passwords, and other sensitive configuration must never be committed.
- Product changes require a changeset; commit messages follow Conventional Commits.

## License

Deeptask is released under the [Apache License 2.0](./LICENSE). Contributors must also follow the [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
