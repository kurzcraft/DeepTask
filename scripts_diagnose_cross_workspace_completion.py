#!/usr/bin/env python3
"""Find recent tasks that received user feedback after a completion boundary."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

GLOBAL_STORAGE_ROOT = Path("/home/kurz/.config/VSCodium/User/globalStorage")
TASKS_ROOT = GLOBAL_STORAGE_ROOT / "deeptask.deeptask" / "tasks"
STATE_DB = GLOBAL_STORAGE_ROOT / "state.vscdb"
CURRENT_TASK_ID = "019f7b14-b7e5-738e-a306-b72185745c9a"


def load_json(path: Path) -> Any:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def message_kind(message: dict[str, Any]) -> str | None:
    return message.get("ask") or message.get("say")


def summarize_tail(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "type": message.get("type"),
            "kind": message_kind(message),
            "text": str(message.get("text", ""))[:120].replace("\n", "\\n"),
            "partial": message.get("partial"),
            "ts": message.get("ts"),
        }
        for message in messages[-10:]
    ]


def load_history_workspaces() -> dict[str, str | None]:
    workspaces: dict[str, str | None] = {}
    with sqlite3.connect(f"file:{STATE_DB}?mode=ro", uri=True) as connection:
        row = connection.execute(
            "SELECT value FROM ItemTable WHERE key = ?",
            ("deeptask.deeptask",),
        ).fetchone()

    if not row:
        return workspaces
    try:
        value = json.loads(row[0])
    except (TypeError, json.JSONDecodeError):
        return workspaces

    candidates = value.get("taskHistory", []) if isinstance(value, dict) else []
    if not isinstance(candidates, list):
        return workspaces
    for item in candidates:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            workspaces[item["id"]] = item.get("workspace")
    return workspaces


def main() -> None:
    history_workspaces = load_history_workspaces()
    rows: list[dict[str, Any]] = []
    for task_dir in TASKS_ROOT.iterdir():
        if not task_dir.is_dir() or task_dir.name == CURRENT_TASK_ID:
            continue
        try:
            messages = load_json(task_dir / "ui_messages.json")
            api_messages = load_json(task_dir / "api_conversation_history.json")
            metadata = load_json(task_dir / "task_metadata.json")
        except (OSError, json.JSONDecodeError):
            continue

        completion_index = max(
            (
                index
                for index, message in enumerate(messages)
                if message_kind(message) == "completion_result"
            ),
            default=-1,
        )
        messages_after_completion = (
            messages[completion_index + 1 :] if completion_index >= 0 else []
        )
        feedback = [
            message
            for message in messages_after_completion
            if message_kind(message) == "user_feedback"
        ]
        if not feedback:
            continue

        rows.append(
            {
                "last_ts": max(
                    (message.get("ts", 0) for message in messages), default=0
                ),
                "task_id": task_dir.name,
                "workspace": history_workspaces.get(task_dir.name),
                "message_count": len(messages),
                "api_count": len(api_messages),
                "completion_index": completion_index,
                "feedback_count": len(feedback),
                "tail": summarize_tail(messages),
            }
        )

    try:
        for row in sorted(rows, key=lambda item: item["last_ts"], reverse=True)[:30]:
            print(json.dumps(row, ensure_ascii=False))
    except BrokenPipeError:
        return


if __name__ == "__main__":
    main()
