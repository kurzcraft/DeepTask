from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

GLOBAL_STORAGE = Path("/home/kurz/.config/VSCodium/User/globalStorage/deeptask.deeptask")
TASKS_DIR = GLOBAL_STORAGE / "tasks"
TARGET_TEXT = (
    "重新发送消息那个还没解决",
    "重发消息就是有问题",
    "Deeptask遇到问题",
    "MODEL_NO_TOOLS_USED",
)


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def message_text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts)
    text = message.get("text")
    return text if isinstance(text, str) else ""


def main() -> None:
    if not TASKS_DIR.exists():
        print(f"missing tasks directory: {TASKS_DIR}")
        return

    candidates: list[tuple[float, Path]] = []
    for task_dir in TASKS_DIR.iterdir():
        ui_path = task_dir / "ui_messages.json"
        if ui_path.is_file():
            candidates.append((ui_path.stat().st_mtime, task_dir))

    for modified, task_dir in sorted(candidates, reverse=True)[:30]:
        ui_messages = load_json(task_dir / "ui_messages.json")
        api_messages = load_json(task_dir / "api_conversation_history.json")
        if not isinstance(ui_messages, list):
            continue

        serialized = json.dumps(ui_messages, ensure_ascii=False)
        has_target = any(term in serialized for term in TARGET_TEXT)
        mistakes = [
            message
            for message in ui_messages
            if isinstance(message, dict)
            and (
                message.get("ask") == "mistake_limit_reached"
                or message.get("text") == "MODEL_NO_TOOLS_USED"
                or "Deeptask遇到问题" in message_text(message)
            )
        ]
        if not has_target and not mistakes:
            continue

        print("=" * 100)
        print(task_dir.name, datetime.fromtimestamp(modified).isoformat())
        print("ui_count", len(ui_messages), "api_count", len(api_messages) if isinstance(api_messages, list) else None)
        print("-- matching UI windows --")
        matching_indexes: set[int] = set()
        for index, message in enumerate(ui_messages):
            if not isinstance(message, dict):
                continue
            text = message_text(message)
            kind = message.get("say") or message.get("ask")
            if (
                any(term in text for term in TARGET_TEXT)
                or kind in {"mistake_limit_reached", "api_req_failed", "error"}
                or "streaming_failed" in text
            ):
                matching_indexes.update(
                    range(max(0, index - 4), min(len(ui_messages), index + 6))
                )
        previous_index = -2
        for index in sorted(matching_indexes):
            message = ui_messages[index]
            if not isinstance(message, dict):
                continue
            if index > previous_index + 1:
                print("...")
            text = message_text(message).replace("\n", " ")[:1000]
            print(
                f"[{index}]",
                message.get("ts"),
                message.get("type"),
                message.get("say") or message.get("ask"),
                "partial=" + str(message.get("partial")),
                text,
            )
            previous_index = index
        if isinstance(api_messages, list):
            print("-- recent API timeline --")
            for message in api_messages[-16:]:
                if not isinstance(message, dict):
                    continue
                text = message_text(message).replace("\n", " ")[:700]
                block_types = [
                    block.get("type")
                    for block in message.get("content", [])
                    if isinstance(block, dict)
                ] if isinstance(message.get("content"), list) else []
                print(message.get("ts"), message.get("role"), block_types, text)


if __name__ == "__main__":
    main()
