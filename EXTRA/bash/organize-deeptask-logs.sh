#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/media/kurz/aleber/vscode/deeptask"
TARGET="$ROOT/artifacts/deeptask/logs"
MOVED=0

mkdir -p "$TARGET"

shopt -s nullglob
for source in "$ROOT"/*.log; do
  filename="$(basename "$source")"
  mv "$source" "$TARGET/$filename"
  printf 'moved %s -> artifacts/deeptask/logs/%s\n' "$filename" "$filename"
  MOVED=$((MOVED + 1))
done

printf 'moved_count=%d\n' "$MOVED"
