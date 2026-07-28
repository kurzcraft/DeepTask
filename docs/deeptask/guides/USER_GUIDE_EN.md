# Deeptask User Guide

[English Home](../../../README_EN.md) · [中文指南](./USER_GUIDE.md) · [Packaging and Release](./DEEPTASK_PACKAGING.md)

## 1. Install

Download the latest `deeptask-*.vsix` from
[GitHub Releases](https://github.com/kurzcraft/DeepTask/releases/latest).

Install in VSCodium:

```bash
codium --install-extension ./deeptask-5.5.9.vsix --force
```

Install in VS Code:

```bash
code --install-extension ./deeptask-5.5.9.vsix --force
```

You can also select **Install from VSIX...** from the Extensions panel menu. Reload the editor window after an upgrade and confirm that the Extensions view reports the new version.

## 2. Configure a model

### OpenAI Compatible

1. Open Deeptask settings and select **OpenAI Compatible**.
2. Enter the API base URL, API key, and model ID.
3. Refresh the catalog or run model detection to read server metadata.
4. If the server does not provide reliable metadata, enter the context window and maximum output tokens manually.

This path works with cloud services, proxies, gateways, and local inference servers that implement OpenAI-style Chat Completions or Responses APIs. Model IDs, authentication headers, reasoning parameters, and tool-call support vary by service. Start with a small read-only task before granting file-write or command permissions.

### Dedicated providers

DeepSeek, Groq, Mistral, and Cerebras can refresh their model catalogs using the credentials and endpoint currently entered in the form. Catalog caches are isolated by account scope. You can still enter a model ID and override its context window when discovery is unavailable.

> API keys are entered only in local extension configuration. The repository and release package do not contain user credentials.

## 3. Choose your level of control

Deeptask does not force a choice between total automation and entirely manual operation.

### Fully managed execution

With **YOLO Mode** enabled, the Agent can invoke allowed tools and continue without repeated intervention. This works best in repositories with tests, rollback paths, and clear permission boundaries. Still specify:

- final artifacts and acceptance criteria;
- directories or interfaces that must not change;
- whether dependency installation, commits, pushes, or releases are allowed;
- durable log and artifact paths for long commands.

### Human-reviewed execution

Disable YOLO Mode, or grant only selected read, edit, and command capabilities in Auto-Approve settings. The Agent will wait for approval at tool, command, and final-completion checkpoints. You can approve, reject, and attach revised instructions.

Use incremental approval for unfamiliar repositories, production configuration, data migration, and release work. Expand automation later through tool permissions and command allowlists.

## 4. Control long-running work

### Correct the task while it runs

You can send new requirements while a task is active instead of waiting for the current turn to finish. Phrase feedback as an executable change, for example:

- "Keep the existing API; do not perform a breaking refactor."
- "Add mobile acceptance and save screenshots under `EXTRA/output/`."
- "Pause the release and fix the newly discovered regression first."

Deeptask registers the latest feedback as an extension, revision, or replacement objective, retains genuinely completed work, and anchors subsequent condensation and restoration on the newest instruction. "Infinite context" here means a durable engineering workflow built from repeated condensation, persistent progress, and continued feedback. It does not mean that one model request has unlimited tokens.

### Observe and stop background services

Commands run in VS Code or VSCodium integrated terminals. Multiple development servers, test watchers, builds, or training jobs can remain visible in the terminal list. At any time you can:

1. Open the editor's **Terminal** panel.
2. Select the relevant Deeptask terminal from the terminal list.
3. Inspect live output and the original command.
4. Stop that specific job with the terminal stop/trash action or `Ctrl+C`.

Running terminals are never removed by completed-terminal cleanup. Deeptask retains the three newest completed terminals by default; the setting can be adjusted or disabled.

### Durable long commands

For commands expected to exceed roughly 30 seconds, contain multiple stages, or produce substantial output, instruct the Agent to:

1. create a task-specific script under `EXTRA/bash/`;
2. persist complete stdout and stderr under `EXTRA/output/`;
3. execute only the short script entry point in the terminal;
4. read the log and verify the exit status afterward.

This preserves live visibility in the integrated terminal while keeping complete evidence available after context condensation, window reload, or cross-session recovery.

## 5. Continue work through EXTRA

`EXTRA/` is a recoverable workspace for long-running tasks, not a miscellaneous temporary directory:

```text
EXTRA/
├── task/    Checklists, findings, decisions, blockers, and acceptance status
├── bash/    Long-command, release, migration, and diagnostic scripts
└── output/  Complete logs, screenshots, reports, checksums, and status files
```

For non-trivial work, ask the Agent to create a task-specific Markdown checklist under `EXTRA/task/`. A new session should read the matching checklist first, then reconcile it with Git state and durable logs instead of depending on the model to recall the complete original conversation.

Historical commands remain traceable through four paths: integrated terminals, command blocks in the conversation, scripts in `EXTRA/bash/`, and logs in `EXTRA/output/`. Release and migration work should preserve rerunnable scripts rather than terminal text alone.

## 6. Context condensation and recovery

Deeptask condenses early conversation when approaching the model's context limit and falls back to sliding-window truncation when necessary. Improve recovery quality by:

- defining the objective, constraints, and acceptance criteria at task start;
- recording real status in the checklist without marking plans as completed;
- keeping scripts and complete logs for critical commands;
- stating whether each new instruction adds, replaces, or cancels work;
- confirming that the latest instruction remains the focus after condensation before high-risk steps.

Condensed summaries are committed transactionally, so a failed summary does not replace the original history. When automatic summarization fails, the runtime prioritizes a continuation-safe fallback.

## 7. Complete and extend a task

A final result should answer three questions: what changed, how it was verified, and what boundaries remain. The Agent should not declare completion while checklist items remain open or before concrete tool-backed work has occurred.

A requirement sent after completion creates a new work turn instead of repeating the old conclusion. State the acceptance delta explicitly, for example: "Add Windows acceptance to the existing fix; do not rerun tests that already passed."

## 8. Troubleshooting

### A sent message does not execute immediately

Check whether the task is waiting for tool approval, command completion, or cancellation confirmation. With YOLO Mode disabled, approve/deny buttons are intentional control points; approving resumes the task.

### The terminal list looks large

The limit applies only to completed Deeptask integrated terminals. Running terminals, never-run terminals, and terminals created by users or other extensions are not deleted. Inspect each terminal's state before stopping background services you no longer need.

### The model catalog is empty

Verify the endpoint, API key, and account permissions, then refresh manually. If the service has no catalog API, enter the model ID directly and set its context window from the provider documentation.

### Focus is wrong after condensation

Send an explicit correction that names the single current objective, completed work to preserve, and obsolete direction to cancel. Update the `EXTRA/task/` checklist as well. Do not continue a high-risk release or migration until focus is confirmed.

### Stop work safely

Use Deeptask's cancel action to stop the current Agent request. Stop any surviving background command separately in its integrated terminal. Do not indiscriminately terminate every Node.js, Python, or shell process on the system.
