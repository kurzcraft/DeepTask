from hashlib import sha256
import json
from pathlib import Path
from zipfile import ZipFile

root = Path("/media/kurz/aleber/vscode/deeptask")
vsix = root / "deeptask-5.5.0.vsix"
installed_dir = Path("/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0/dist")

with ZipFile(vsix) as archive:
    bundled = archive.read("extension/dist/extension.js")
    bundled_map = archive.read("extension/dist/extension.js.map")
installed_bytes = (installed_dir / "extension.js").read_bytes()
installed_map = (installed_dir / "extension.js.map").read_bytes()
source_map = json.loads(bundled_map)
sources = source_map["sources"]
bundle_text = bundled.decode("utf-8")

execute_source_present = any(
    name.endswith("/core/tools/ExecuteCommandTool.ts") for name in sources
)
provider_source_present = any(
    name.endswith("/core/webview/ClineProvider.ts") for name in sources
)
task_source_present = any(
    name.endswith("/core/task/Task.ts") for name in sources
)
task_source_text = (root / "src/core/task/Task.ts").read_text(encoding="utf-8")
attempt_completion_source_present = any(
    name.endswith("/core/tools/AttemptCompletionTool.ts") for name in sources
)

cancel_anchor = bundle_text.index("[cancelTask] cancelling task")
cancel_window = bundle_text[cancel_anchor : cancel_anchor + 1_500]
cancel_markers = [
    'abortReason="user_cancelled"',
    "abandoned=!0",
    ".cancelCurrentRequest()",
    ".abortTask()",
    "await this.getTaskWithId(",
]
cancel_positions = [cancel_window.index(marker) for marker in cancel_markers]

command_anchor = bundle_text.index(
    "The command was terminated after exceeding a user-configured"
)
command_window = bundle_text[command_anchor : command_anchor + 3_000]
auto_clear_start = command_window.index("hasPendingWebviewAskResponse?.()")
auto_clear_end = command_window.index(",await F", auto_clear_start)
auto_clear_window = command_window[auto_clear_start:auto_clear_end]

checks = {
    "vsix_exists": vsix.stat().st_size > 1_000_000,
    "installed_bundle_matches_vsix": installed_bytes == bundled,
    "installed_map_matches_vsix": installed_map == bundled_map,
    "execute_command_source_mapped": execute_source_present,
    "cline_provider_source_mapped": provider_source_present,
    "task_source_mapped": task_source_present,
    "attempt_completion_source_mapped": attempt_completion_source_present,
    "cancel_state_precedes_history_io": cancel_positions == sorted(cancel_positions),
    "single_restoration_flow_present": "Error restoring task history:" in bundle_text,
    "parallel_continuation_flow_absent": (
        "Error processing cancelled-task continuation:" not in bundle_text
    ),
    "premature_completion_checked_in_stream_and_execute": (
        bundle_text.count("shouldRejectPrematureActiveContinuationCompletion()") >= 2
    ),
    "superseded_todo_content_signature_present": (
        "getTodoContentSignature(" in bundle_text
        and "supersededContinuationTodoSignature" in bundle_text
    ),
    "host_managed_feedback_turn_present": all(
        marker in bundle_text
        for marker in (
            "activeUserFeedbackTodoId",
            "establishUserFeedbackWorkTurn",
            "completeHostManagedFeedbackTodo",
            "hostManagedFeedbackTurn",
        )
    ),
    "feedback_turn_preserves_checklist_context": (
        all(
            marker in bundle_text
            for marker in (
                "extendedByContinuation",
                "preserving relevant context from the conversation and existing checklist",
                "extends, revises, or replaces earlier work",
            )
        )
        and "restoreTodoListForTask(this)" in task_source_text
    ),
    "discarded_checklist_contract_absent": (
        "host has already discarded the old checklist" not in bundle_text
        and "supersededByContinuation" not in bundle_text
    ),
    "stale_continuation_status_receipt_absent": (
        "The continued task is still active; continue working from the in-progress item"
        not in bundle_text
    ),
    "auto_clear_resolves_pending_ask": (
        'handleWebviewAskResponse("yesButtonClicked")' in auto_clear_window
    ),
    "auto_clear_keeps_capture": ".continue()" not in auto_clear_window,
}
for key, value in checks.items():
    print(key, value)
if not all(checks.values()):
    raise SystemExit(1)

print("size", vsix.stat().st_size)
print("sha256", sha256(vsix.read_bytes()).hexdigest())
