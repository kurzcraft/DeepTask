#!/usr/bin/env python3
"""Extract persisted evidence for Deeptask inline-resend context loss."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

GLOBAL_STORAGE = Path(
    "/home/kurz/.config/VSCodium/User/globalStorage/deeptask.deeptask"
)
TARGET_PHRASES = (
    "重新发送变成了Deeptask",
    "重新发送加入不了上下文",
    "模型看不到",
)


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def latest_task_dir(tasks_dir: Path) -> Path:
    candidates = [
        path
        for path in tasks_dir.iterdir()
        if path.is_dir() and (path / "ui_messages.json").is_file()
    ]
    if not candidates:
        raise FileNotFoundError(f"No persisted tasks found under {tasks_dir}")
    return max(candidates, key=lambda path: (path / "ui_messages.json").stat().st_mtime)


def parse_json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        text = block.get("text")
        if isinstance(text, str):
            parts.append(text)
        nested = block.get("content")
        if isinstance(nested, str):
            parts.append(nested)
        elif isinstance(nested, list):
            parts.append(content_text(nested))
    return "\n".join(part for part in parts if part)


def compact(value: str, limit: int = 220) -> str:
    normalized = " ".join(value.split())
    return normalized if len(normalized) <= limit else f"{normalized[:limit]}..."


def ui_label(message: dict[str, Any]) -> str:
    return str(message.get("say") or message.get("ask") or "")


def find_target_feedback(ui_history: list[dict[str, Any]]) -> int | None:
    for index in range(len(ui_history) - 1, -1, -1):
        message = ui_history[index]
        if message.get("type") != "say" or message.get("say") != "user_feedback":
            continue
        text = str(message.get("text") or "").strip()
        # Ignore later feedback that merely pasted a diagnostic transcript containing
        # the target phrases. The original failure reports are short direct messages.
        if len(text) <= 240 and any(text.startswith(phrase) for phrase in TARGET_PHRASES):
            return index
    return None


def print_ui_window(ui_history: list[dict[str, Any]], center: int, radius: int = 10) -> None:
    start = max(0, center - radius)
    end = min(len(ui_history), center + radius + 1)
    print(f"UI WINDOW [{start}:{end}]")
    for index in range(start, end):
        message = ui_history[index]
        detail = str(message.get("text") or message.get("partial") or "")
        print(
            f"  {index:04d} ts={message.get('ts')} "
            f"{message.get('type')}/{ui_label(message)} {compact(detail)}"
        )


def print_api_tail(api_history: list[dict[str, Any]], count: int = 12) -> None:
    print(f"API TAIL [{max(0, len(api_history) - count)}:{len(api_history)}]")
    for index in range(max(0, len(api_history) - count), len(api_history)):
        message = api_history[index]
        text = content_text(message.get("content"))
        print(
            f"  {index:04d} ts={message.get('ts')} role={message.get('role')} "
            f"blocks={len(message.get('content', [])) if isinstance(message.get('content'), list) else '-'} "
            f"text={compact(text)}"
        )


def main() -> int:
    tasks_dir = GLOBAL_STORAGE / "tasks"
    task_dir = tasks_dir / sys.argv[1] if len(sys.argv) > 1 else latest_task_dir(tasks_dir)
    ui_file = task_dir / "ui_messages.json"
    api_file = task_dir / "api_conversation_history.json"

    if not ui_file.is_file() or not api_file.is_file():
        print(f"Missing persisted history under {task_dir}", file=sys.stderr)
        return 1

    ui_history = load_json(ui_file)
    api_history = load_json(api_file)
    if not isinstance(ui_history, list) or not isinstance(api_history, list):
        print("Unexpected history JSON shape", file=sys.stderr)
        return 1

    print(f"TASK {task_dir.name}")
    print(f"UI_MESSAGES {len(ui_history)}")
    print(f"API_MESSAGES {len(api_history)}")
    print(f"UI_MTIME {ui_file.stat().st_mtime}")
    print(f"API_MTIME {api_file.stat().st_mtime}")
    print()

    target_index = find_target_feedback(ui_history)
    if target_index is None:
        print("TARGET_FEEDBACK not found")
        feedback = [
            (index, message)
            for index, message in enumerate(ui_history)
            if message.get("type") == "say" and message.get("say") == "user_feedback"
        ]
        for index, message in feedback[-10:]:
            print(f"  {index:04d} ts={message.get('ts')} {compact(str(message.get('text') or ''))}")
    else:
        target = ui_history[target_index]
        target_text = str(target.get("text") or "")
        print(f"TARGET_FEEDBACK index={target_index} ts={target.get('ts')}")
        print(f"TARGET_TEXT {target_text}")
        print_ui_window(ui_history, target_index)

        request_indices = [
            index
            for index, message in enumerate(ui_history)
            if message.get("type") == "say" and message.get("say") == "api_req_started"
        ]
        previous_request = max(
            (index for index in request_indices if index < target_index),
            default=None,
        )
        next_request = min(
            (index for index in request_indices if index > target_index),
            default=None,
        )
        for label, index in (("PREVIOUS_API_REQUEST", previous_request), ("NEXT_API_REQUEST", next_request)):
            if index is None:
                print(f"{label} none")
                continue
            message = ui_history[index]
            metadata = parse_json_object(message.get("text") or message.get("partial"))
            print(
                f"{label} index={index} ts={message.get('ts')} "
                f"tokensIn={metadata.get('tokensIn')} tokensOut={metadata.get('tokensOut')} "
                f"cancelReason={metadata.get('cancelReason')}"
            )

    print()
    print_api_tail(api_history)

    if target_index is not None:
        target_text = str(ui_history[target_index].get("text") or "").strip()
        matching_user_indices = [
            index
            for index, message in enumerate(api_history)
            if message.get("role") == "user" and target_text in content_text(message.get("content"))
        ]
        print(f"TARGET_API_USER_INDICES {matching_user_indices}")
        for index in matching_user_indices:
            start = max(0, index - 2)
            end = min(len(api_history), index + 3)
            print(f"TARGET_API_WINDOW [{start}:{end}]")
            for message_index in range(start, end):
                message = api_history[message_index]
                content = message.get("content")
                block_details: list[str] = []
                if isinstance(content, list):
                    for block in content:
                        if not isinstance(block, dict):
                            block_details.append(type(block).__name__)
                            continue
                        block_type = str(block.get("type") or "unknown")
                        block_id = block.get("id") or block.get("tool_use_id") or block.get("tool_call_id")
                        block_name = block.get("name")
                        block_details.append(
                            f"{block_type}(id={block_id!r},name={block_name!r})"
                        )
                print(
                    f"  {message_index:04d} ts={message.get('ts')} role={message.get('role')} "
                    f"blocks={block_details} text={compact(content_text(content), 600)}"
                )

    user_messages = [message for message in api_history if message.get("role") == "user"]
    last_user_text = content_text(user_messages[-1].get("content")) if user_messages else ""
    print()
    print(f"API_USER_MESSAGES {len(user_messages)}")
    print(f"LAST_API_USER_TEXT {compact(last_user_text, 600)}")
    for phrase in TARGET_PHRASES:
        print(f"LAST_API_USER_CONTAINS {phrase!r}={phrase in last_user_text}")

    condense_debug = task_dir / "context_condense_debug.jsonl"
    if condense_debug.is_file():
        lines = condense_debug.read_text(encoding="utf-8").splitlines()
        print(f"CONDENSE_DEBUG_LINES {len(lines)}")
        for line in lines[-5:]:
            print(f"  {compact(line, 500)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
