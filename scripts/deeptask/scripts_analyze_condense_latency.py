#!/usr/bin/env python3
"""Summarize persisted context-condense latency by model without mutating task data."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from statistics import median
from typing import Any

TASKS_DIR = Path(
    "/home/kurz/.config/VSCodium/User/globalStorage/deeptask.deeptask/tasks"
)


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_events(path: Path) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def collect_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for task_dir in TASKS_DIR.iterdir():
        debug_path = task_dir / "context_condense_debug.jsonl"
        if not debug_path.is_file():
            continue

        starts: dict[str, list[dict[str, Any]]] = defaultdict(list)
        seen_results: set[tuple[Any, ...]] = set()
        for event in load_events(debug_path):
            phase = event.get("phase")
            instance_id = str(event.get("instanceId", ""))
            if phase in {"context_management_start", "manual_start"}:
                starts[instance_id].append(event)
                continue
            if phase not in {"context_management_result", "manual_result"}:
                continue

            result_key = (
                event.get("timestamp"),
                instance_id,
                event.get("condenseId"),
                event.get("outcome"),
            )
            if result_key in seen_results:
                continue
            seen_results.add(result_key)

            result_time = parse_time(str(event["timestamp"]))
            candidates = [
                start
                for start in starts.get(instance_id, [])
                if parse_time(str(start["timestamp"])) <= result_time
            ]
            if not candidates:
                continue
            start = max(candidates, key=lambda item: parse_time(str(item["timestamp"])))
            elapsed = (result_time - parse_time(str(start["timestamp"]))).total_seconds()
            if elapsed < 0 or event.get("outcome") != "condensed":
                continue

            rows.append(
                {
                    "task": task_dir.name,
                    "timestamp": event["timestamp"],
                    "model": start.get("modelId", "unknown"),
                    "provider": start.get("apiProvider", "unknown"),
                    "seconds": elapsed,
                    "inputTokens": event.get("prevContextTokens"),
                    "outputTokens": event.get("newContextTokens"),
                    "summaryLength": event.get("summaryLength"),
                    "messages": event.get("messagesBefore"),
                    "canCommit": event.get("canCommit"),
                }
            )
    return rows


def main() -> int:
    rows = collect_rows()
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[str(row["model"])].append(row)

    print("MODEL_SUMMARY")
    for model, model_rows in sorted(groups.items()):
        durations = [float(row["seconds"]) for row in model_rows]
        print(
            model,
            f"n={len(model_rows)}",
            f"median={median(durations):.1f}s",
            f"min={min(durations):.1f}s",
            f"max={max(durations):.1f}s",
        )

    print("\nLATEST_ROWS")
    for row in sorted(rows, key=lambda item: str(item["timestamp"]), reverse=True)[:30]:
        print(json.dumps(row, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
