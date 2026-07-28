#!/usr/bin/env python3
"""Audit persisted Deeptask context-compression logs and histories without mutation."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

TASKS_DIR = Path(
    "/home/kurz/.config/VSCodium/User/globalStorage/deeptask.deeptask/tasks"
)
INSTALL_TIME = datetime(2026, 7, 19, 19, 15, 6).timestamp()
ERROR_TERMS = (
    "error",
    "failed",
    "provider",
    "reasoning",
    "stale",
    "reusedInFlight",
)
REASONING_FIELDS = {
    "reasoning_details",
    "reasoning_content",
    "encrypted_content",
    "thoughtSignature",
    "reasoning",
}


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def parse_jsonl(path: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return entries
    for line in lines:
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            entries.append(value)
    return entries


def content_has_reasoning(content: Any) -> bool:
    return isinstance(content, list) and any(
        isinstance(block, dict) and block.get("type") == "reasoning"
        for block in content
    )


def audit_history(task_dir: Path) -> tuple[int, int, int, list[str]]:
    history = load_json(task_dir / "api_conversation_history.json")
    if not isinstance(history, list):
        return 0, 0, 0, []
    summaries = 0
    summary_reasoning = 0
    hidden_reasoning = 0
    findings: list[str] = []
    for index, message in enumerate(history):
        if not isinstance(message, dict):
            continue
        is_summary = message.get("isSummary") is True
        has_reasoning = content_has_reasoning(message.get("content")) or bool(
            REASONING_FIELDS.intersection(message)
        )
        if is_summary:
            summaries += 1
            if has_reasoning:
                summary_reasoning += 1
                findings.append(f"summary_reasoning:index={index}")
        if message.get("condenseParent") and has_reasoning:
            hidden_reasoning += 1
    return summaries, summary_reasoning, hidden_reasoning, findings


def audit_events(entries: list[dict[str, Any]]) -> tuple[int, list[str]]:
    active_by_instance: dict[str, int] = defaultdict(int)
    overlaps = 0
    findings: list[str] = []
    for index, entry in enumerate(entries):
        phase = str(entry.get("phase", ""))
        instance = str(entry.get("instanceId", entry.get("taskId", "unknown")))
        phase_lower = phase.lower()
        if phase_lower.endswith("start") or phase_lower in {
            "context_management_start",
            "manual_start",
        }:
            if active_by_instance[instance] > 0:
                overlaps += 1
                findings.append(f"overlap:index={index}:phase={phase}:instance={instance}")
            active_by_instance[instance] += 1
        if any(token in phase_lower for token in ("result", "finish", "complete", "error")):
            active_by_instance[instance] = max(0, active_by_instance[instance] - 1)
        serialized = json.dumps(entry, ensure_ascii=False)
        if any(term.lower() in serialized.lower() for term in ERROR_TERMS):
            findings.append(f"signal:index={index}:{serialized[:500]}")
    return overlaps, findings


def main() -> int:
    if not TASKS_DIR.is_dir():
        raise SystemExit(f"missing tasks directory: {TASKS_DIR}")

    task_dirs = [path for path in TASKS_DIR.iterdir() if path.is_dir()]
    task_dirs.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    counters: Counter[str] = Counter()
    task_findings: list[tuple[float, str, list[str]]] = []

    for task_dir in task_dirs:
        debug_path = task_dir / "context_condense_debug.jsonl"
        entries = parse_jsonl(debug_path) if debug_path.is_file() else []
        summaries, summary_reasoning, hidden_reasoning, history_findings = audit_history(task_dir)
        overlaps, event_findings = audit_events(entries)
        modified = max(
            (path.stat().st_mtime for path in (debug_path, task_dir / "api_conversation_history.json") if path.exists()),
            default=task_dir.stat().st_mtime,
        )

        counters["tasks"] += 1
        counters["debug_files"] += int(bool(entries))
        counters["debug_entries"] += len(entries)
        counters["summaries"] += summaries
        counters["summary_reasoning"] += summary_reasoning
        counters["hidden_reasoning"] += hidden_reasoning
        counters["overlaps"] += overlaps
        counters["post_install_tasks"] += int(modified >= INSTALL_TIME)

        findings = history_findings + event_findings
        if findings:
            task_findings.append((modified, task_dir.name, findings))

    print("SUMMARY", dict(counters))
    print("POST_INSTALL_CUTOFF", datetime.fromtimestamp(INSTALL_TIME).isoformat())
    print("FINDING_TASKS", len(task_findings))
    for modified, task_id, findings in sorted(task_findings, reverse=True)[:20]:
        print("TASK", task_id, datetime.fromtimestamp(modified).isoformat())
        for finding in findings[-12:]:
            print(" ", finding)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
