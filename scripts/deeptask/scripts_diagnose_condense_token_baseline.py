#!/usr/bin/env python3
"""Correlate context-condense debug events with persisted UI token baselines."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

TASK_ID = "019f5512-cd5e-7646-97c6-2b864eb9bb6c"
TASK_DIR = Path(
    "/home/kurz/.config/VSCodium/User/globalStorage/deeptask.deeptask/tasks"
) / TASK_ID


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def event_ms(timestamp: str) -> int:
    return int(datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp() * 1000)


def parse_usage(message: dict[str, Any]) -> tuple[int, int] | None:
    if message.get("say") != "api_req_started" or not message.get("text"):
        return None
    try:
        payload = json.loads(message["text"])
    except json.JSONDecodeError:
        return None
    tokens_in = payload.get("tokensIn")
    tokens_out = payload.get("tokensOut")
    if not isinstance(tokens_in, int) and not isinstance(tokens_out, int):
        return None
    return int(tokens_in or 0), int(tokens_out or 0)


def main() -> int:
    ui_messages = load_json(TASK_DIR / "ui_messages.json")
    debug_events = load_jsonl(TASK_DIR / "context_condense_debug.jsonl")

    compact_ui: list[tuple[int, str, str]] = []
    for message in ui_messages:
        timestamp = message.get("ts")
        if not isinstance(timestamp, int):
            continue
        usage = parse_usage(message)
        if usage is not None:
            compact_ui.append((timestamp, "api", f"{usage[0]}+{usage[1]}={sum(usage)}"))
        elif message.get("say") == "condense_context":
            condense = message.get("contextCondense") or {}
            compact_ui.append(
                (
                    timestamp,
                    "condense",
                    f"id={condense.get('condenseId')} new={condense.get('newContextTokens')}",
                )
            )

    results = [
        event
        for event in debug_events
        if event.get("phase") == "context_management_result"
        and event.get("outcome") == "condensed"
    ]
    print(f"task={TASK_ID} ui_events={len(compact_ui)} condensed_results={len(results)}")
    for result in results[-12:]:
        timestamp_ms = event_ms(result["timestamp"])
        nearby = [
            item
            for item in compact_ui
            if abs(item[0] - timestamp_ms) <= 120_000
        ]
        print(
            "RESULT",
            result["timestamp"],
            f"instance={result.get('instanceId')}",
            f"id={result.get('condenseId')}",
            f"new={result.get('newContextTokens')}",
        )
        for item in nearby[-8:]:
            delta = (item[0] - timestamp_ms) / 1000
            print(f"  UI {delta:+7.1f}s {item[1]:8s} {item[2]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
