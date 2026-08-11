<p align="center">
  <img src="./assets/deeptask-logo-v2.png" alt="Deeptask compass logo" width="512" />
</p>

<h1 align="center">Deeptask</h1>

<p align="center">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <strong>Finish software work that runs for hours, spans sessions, and keeps changing.</strong><br />
  Long-running execution stays visible, feedback stays actionable, and automation never removes your control.
</p>

<p align="center">
  <a href="https://github.com/kurzcraft/DeepTask"><img src="https://img.shields.io/badge/GitHub-Explore%20DeepTask%20Source-181717?style=for-the-badge&logo=github&logoColor=white" alt="Explore the Deeptask GitHub repository" /></a>
</p>

<p align="center">
  <a href="https://github.com/kurzcraft/DeepTask/stargazers"><img src="https://img.shields.io/github/stars/kurzcraft/DeepTask?style=flat-square&logo=github&label=Star" alt="GitHub Stars" /></a>
  <a href="https://github.com/kurzcraft/DeepTask/releases/latest"><img src="https://img.shields.io/github/v/release/kurzcraft/DeepTask?style=flat-square&label=Latest%20Release" alt="Latest GitHub Release" /></a>
  <a href="https://github.com/kurzcraft/DeepTask/issues"><img src="https://img.shields.io/github/issues/kurzcraft/DeepTask?style=flat-square&logo=github&label=Issues" alt="GitHub Issues" /></a>
</p>

<p align="center">
  <a href="https://github.com/kurzcraft/DeepTask/releases/latest"><strong>Download Deeptask 9.0.6</strong></a>
  ·
  <a href="#start-in-three-minutes">Quick Start</a>
  ·
  <a href="./docs/deeptask/guides/USER_GUIDE_EN.md"><strong>Docs</strong></a>
  ·
  <a href="#built-for-long-running-work">Core Capabilities</a>
  ·
  <a href="#architecture-and-trust">Architecture</a>
</p>

> **Deeptask 9.0.6** gives every tool call a bounded completion path: a never-settling tool now times out with an
> explicit error, releases its lock, and keeps the task reachable. Native tool turns also receive unique error
> results, preventing late tool responses from causing duplicate or missing results and hanging the task.

## What you can do with Deeptask

| Scenario                                                 | Deeptask experience                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Delegate a well-tested engineering task                  | Enable fully managed YOLO mode so the Agent can read, edit, execute, and verify continuously  |
| Change unfamiliar or production code carefully           | Disable YOLO and approve or reject tools, commands, and final completion step by step         |
| Run several servers, watchers, or training jobs          | Keep every long-running job visible in the integrated terminal list and stop any one manually |
| Discover a new requirement while the Agent is working    | Send the correction immediately; the latest feedback becomes the active focus                 |
| Switch mode, provider, or model mid-task                 | Let the Agent auto-switch agent mode, provider profiles, and models after connectivity checks |
| Continue tomorrow or after the conversation becomes long | Condense context and restore real state from `EXTRA/task/`, scripts, logs, and Git            |
| Use a hosted proxy, gateway, or local model              | Configure an OpenAI-compatible endpoint and detect or override its context window             |

## Built for long-running work

### Background work stays visible and controllable

Commands run in real VS Code or VSCodium integrated terminals. Development servers, test watchers, builds, and training jobs can remain in the terminal list at the same time. You can inspect live output and the original command, then stop one specific job with the terminal action, trash button, or `Ctrl+C` without surrendering control to the Agent.

Deeptask retains only the three newest **completed** terminals by default. Running jobs do not count toward that limit and are never pruned. Command completion, shell exit, and fallback finalization all trigger convergence checks so event races cannot keep the completed-terminal count above its setting.

[Learn how to control background terminals and durable commands](./docs/deeptask/guides/USER_GUIDE_EN.md#4-control-long-running-work)

### Move between zero-touch automation and deliberate review

- **Fully managed:** enable YOLO Mode after defining permissions and acceptance criteria, then let the Agent continue.
- **Human reviewed:** disable YOLO and approve, reject, or revise critical tool calls, commands, and completion claims.
- **Progressive trust:** begin read-only, then open editing, command allowlists, and final delivery as confidence grows.

[Learn how to configure control modes and permissions](./docs/deeptask/guides/USER_GUIDE_EN.md#3-choose-your-level-of-control)

### Agent can auto-switch mode, provider, and model

Deeptask lets the Agent switch agent mode, provider profiles, and models mid-task instead of relying only on the bottom-left selector:

- **Live profile enumeration:** each tool call reads the latest saved profiles, so newly created or renamed configs are selectable without restart.
- **Same-profile model changes and cross-provider switches:** switch only the model, or move to another saved profile such as DeepSeek, OpenAI Compatible, or Nvidia.
- **Atomic preflight:** activation is saved only after the target API responds and the current context fits the destination model window; failures leave the active profile unchanged.
- **Dedicated auto-approval:** a separate model/provider-switch approval toggle defaults to on and can be turned off for manual confirmation.

### Correct a running task as the real requirement changes

You can send new instructions while the task is active. Deeptask registers the feedback as an extension, revision, or replacement objective, preserves genuinely completed work, and anchors subsequent execution and context condensation on the newest requirement. Feedback sent after completion creates a new work turn instead of repeating the previous conclusion.

When a tool throws unexpectedly, Deeptask returns an explicit failure to the model, releases the presenter lock, and keeps the next turn reachable. Even a failure while rendering the error cannot silently strand the task.

This produces an engineering form of near-infinite continuity: a task can evolve through repeated condensation, restoration, and cross-session continuation. The claim is based on durable state and verifiable evidence, not on pretending that a single model request has unlimited tokens.

[Learn how to correct and extend active work](./docs/deeptask/guides/USER_GUIDE_EN.md#correct-the-task-while-it-runs)

### EXTRA turns a conversation into a recoverable workspace

```text
EXTRA/
├── task/    Checklists, findings, decisions, blockers, and acceptance status
├── bash/    Long-command, release, migration, and diagnostic scripts
└── output/  Complete logs, screenshots, reports, checksums, and status files
```

Long commands do not disappear into transient terminal output. Scripts live in `EXTRA/bash/`, complete stdout and stderr live in `EXTRA/output/`, and cross-session checklists live in `EXTRA/task/`. A new session can reconcile these artifacts with Git state, while historical commands remain traceable through the terminal, conversation, scripts, and logs.

[Learn how to continue work through EXTRA](./docs/deeptask/guides/USER_GUIDE_EN.md#5-continue-work-through-extra)

### Connect broadly through OpenAI-compatible APIs

OpenAI Compatible is the productive default for cloud services, proxy gateways, and local inference servers implementing OpenAI-style Chat Completions or Responses APIs. Enter the base URL, API key, and model ID; detect server metadata when available; or override context and output-token limits manually.

DeepSeek, Groq, Mistral, and Cerebras also support account-aware model catalog refresh, account-scoped caches, manual model IDs, and context overrides. Release packages never embed user credentials.

[Learn how to configure models and APIs](./docs/deeptask/guides/USER_GUIDE_EN.md#2-configure-a-model)

### Completion requires evidence; extensions regain focus

Deeptask treats work as a recoverable state machine rather than a one-shot answer. Open checklist items, missing tool-backed work, and absent acceptance evidence constrain final delivery. Tests, builds, installations, logs, and remote release assets can be reported alongside the result. Context summaries commit transactionally and use continuation-safe fallback behavior when condensation fails.

## Start in three minutes

1. Download `deeptask-9.0.6.vsix` from [GitHub Releases](https://github.com/kurzcraft/DeepTask/releases/latest).
2. Install in VSCodium:

    ```bash
    codium --install-extension ./deeptask-9.0.6.vsix --force
    ```

    Or install in VS Code:

    ```bash
    code --install-extension ./deeptask-9.0.6.vsix --force
    ```

3. Open Deeptask settings, select **OpenAI Compatible**, and enter the API base URL, API key, and model ID.
4. Describe the objective, constraints, and acceptance criteria, then choose YOLO automation or incremental approval.
5. Send corrections while work is running and inspect concrete progress in integrated terminals and `EXTRA/`.

See the [complete Deeptask User Guide](./docs/deeptask/guides/USER_GUIDE_EN.md) for detailed steps.

## Documentation

| Document                                                              | Contents                                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [Complete User Guide](./docs/deeptask/guides/USER_GUIDE_EN.md)        | Installation, APIs, permissions, long tasks, terminals, EXTRA, context recovery, and troubleshooting |
| [中文使用指南](./docs/deeptask/guides/USER_GUIDE.md)                  | 完整中文使用文档                                                                                     |
| [Development](./DEVELOPMENT.md)                                       | Monorepo environment, build, and development workflows                                               |
| [Packaging and Release](./docs/deeptask/guides/DEEPTASK_PACKAGING.md) | Stable VSIX build, installation, and release workflow                                                |
| [Release Notes](./docs/deeptask/releases/)                            | Versioned improvements and acceptance summaries                                                      |
| [Engineering Records](./docs/deeptask/README.md)                      | Boundaries for architecture analysis, progress history, and internal evidence                        |
| [Contributing](./CONTRIBUTING.md)                                     | Code contribution, testing, and commit conventions                                                   |

## Architecture and trust

```text
VS Code / VSCodium
├── React Webview                         Chat, settings, tasks, and Agent Manager
├── Extension Host
│   ├── ClineProvider / Webview Handler   State synchronization and message routing
│   ├── Task Runtime                      Single loop, feedback continuation, condensation, completion gates
│   ├── Tool System                       File, command, MCP, browser, and other tools
│   ├── Terminal Integration              Command execution, live output, and terminal lifecycle
│   └── Provider Layer                    OpenAI Compatible and dedicated model adapters
└── Agent Runtime / CLI                   Isolated Agent processes and command-line entry points
```

Deeptask respects and inherits Kilo Code's extension host, tool system, provider ecosystem, and React Webview foundation. This branch is not a cosmetic rebrand. Its regression-tested focus is direct message delivery, hard completed-terminal bounds, feedback work turns, post-condensation focus, completion verification, and transparent default configuration.

Main directories:

- `src/`: extension host, task runtime, providers, tools, and services.
- `webview-ui/`: React chat, settings, and Agent Manager.
- `packages/`: shared types, IPC, cloud services, and Agent Runtime.
- `cli/`: standalone command-line package.
- `docs/deeptask/`: user guides, release notes, architecture analysis, and acceptance records.
- `scripts/deeptask/`: Deeptask-specific packaging, release, and diagnostic automation.

## Development and contribution

Requirements: Node.js 20.20.0 and pnpm 10.8.1. See [Development](./DEVELOPMENT.md) for the complete setup.

```bash
pnpm install
pnpm check-types
pnpm lint
```

Focused tests must run from the workspace that declares Vitest. Product changes require regression coverage and a changeset. Never commit API keys, passwords, or other sensitive configuration.

## License

Deeptask is released under the [Apache License 2.0](./LICENSE) and follows the [Code of Conduct](./CODE_OF_CONDUCT.md).
