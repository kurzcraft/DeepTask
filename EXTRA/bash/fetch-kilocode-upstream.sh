#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/media/kurz/aleber/vscode/deeptask"
LOG="$ROOT/EXTRA/output/fetch-kilocode-upstream.log"
STATUS="$ROOT/EXTRA/output/fetch-kilocode-upstream.status"
mkdir -p "$ROOT/EXTRA/output"
: > "$LOG"

exec > >(tee -a "$LOG") 2>&1
trap 'code=$?; printf "%s\n" "$code" > "$STATUS"; echo "exit_status=$code"; echo "log=$LOG"' EXIT

cd "$ROOT"
echo "started=$(date --iso-8601=seconds)"
echo "source=https://github.com/Kilo-Org/kilocode.git"

git fetch --force --depth=1 \
  https://github.com/Kilo-Org/kilocode.git \
  main:refs/deeptask-upstream/kilocode-main

# Fetch the exact upstream 5.5.0 tag when it exists; absence is reported but not fatal.
if git ls-remote --exit-code --tags https://github.com/Kilo-Org/kilocode.git refs/tags/v5.5.0 >/dev/null 2>&1; then
  git fetch --force --depth=1 \
    https://github.com/Kilo-Org/kilocode.git \
    refs/tags/v5.5.0:refs/tags/kilocode-upstream-v5.5.0
else
  echo "upstream_tag_v5.5.0=absent"
fi

git show -s --format='upstream_main=%H%nupstream_main_date=%cI%nupstream_main_subject=%s' \
  refs/deeptask-upstream/kilocode-main
if git rev-parse --verify refs/tags/kilocode-upstream-v5.5.0 >/dev/null 2>&1; then
  git show -s --format='upstream_v5.5.0=%H%nupstream_v5.5.0_date=%cI%nupstream_v5.5.0_subject=%s' \
    refs/tags/kilocode-upstream-v5.5.0
fi

echo "finished=$(date --iso-8601=seconds)"
