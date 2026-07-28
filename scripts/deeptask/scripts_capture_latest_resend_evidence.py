from __future__ import annotations

import json
import os
from pathlib import Path

TASKS = Path("/home/kurz/.config/VSCodium/User/globalStorage/deeptask.deeptask/tasks")
TERMS = ("重发", "重新发送", "还是卡", "没有任何改变", "Deeptask遇到问题", "streaming_failed")


def text(item: dict) -> str:
    value = item.get("text", "")
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def print_message(index: int, item: dict) -> None:
    print(
        index,
        item.get("ts"),
        item.get("type"),
        item.get("say") or item.get("ask"),
        text(item).replace("\n", " ")[:700],
    )


def main() -> None:
    candidates = []
    for task in TASKS.iterdir():
        ui = task / "ui_messages.json"
        if ui.is_file():
            candidates.append((ui.stat().st_mtime, task, ui))
    sorted_candidates = sorted(candidates, reverse=True)
    if sorted_candidates:
        _, latest_task, latest_ui = sorted_candidates[0]
        latest_items = json.loads(latest_ui.read_text())
        print(f"LATEST TASK {latest_task.name} UI_MTIME {latest_ui.stat().st_mtime} COUNT {len(latest_items)}")
        print("-- LATEST UI TAIL --")
        for index, item in enumerate(latest_items[-40:], start=max(0, len(latest_items) - 40)):
            print_message(index, item)
        latest_api = latest_task / "api_conversation_history.json"
        if latest_api.is_file():
            api_items = json.loads(latest_api.read_text())
            print(f"-- LATEST API TAIL COUNT {len(api_items)} --")
            for index, item in enumerate(api_items[-12:], start=max(0, len(api_items) - 12)):
                print(index, item.get("ts"), item.get("role"), text(item).replace("\n", " ")[:1000])
        print()

    for _, task, ui in sorted_candidates[:12]:
        try:
            items = json.loads(ui.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        hits = [i for i, item in enumerate(items) if any(term in text(item) for term in TERMS)]
        if not hits:
            continue
        print(f"TASK {task.name} UI_MTIME {ui.stat().st_mtime} COUNT {len(items)}")
        for hit in hits[-4:]:
            print(f"-- HIT {hit} --")
            for i in range(max(0, hit - 2), min(len(items), hit + 11)):
                print_message(i, items[i])
        api = task / "api_conversation_history.json"
        if api.is_file():
            print(f"API_MTIME {api.stat().st_mtime} SIZE {api.stat().st_size}")
        print()

    extension = Path("/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0/dist/extension.js")
    print("EXTENSION_EXISTS", extension.exists())
    if extension.exists():
        print("EXTENSION_MTIME", extension.stat().st_mtime, "SIZE", extension.stat().st_size)
        bundle = extension.read_text(errors="ignore")
        for marker in ("submitEditedMessage", "consumePendingCancelledTaskContinuation", "setTimeout", "createTaskWithHistoryItem"):
            print("MARKER", marker, bundle.count(marker))


if __name__ == "__main__":
    main()
