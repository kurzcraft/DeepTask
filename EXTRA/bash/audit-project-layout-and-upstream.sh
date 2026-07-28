#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/media/kurz/aleber/vscode/deeptask"
UPSTREAM="refs/deeptask-upstream/kilocode-main"
OUT="$ROOT/EXTRA/output/project-layout-upstream-audit"
LOG="$ROOT/EXTRA/output/audit-project-layout-and-upstream.log"
STATUS="$ROOT/EXTRA/output/audit-project-layout-and-upstream.status"
mkdir -p "$OUT"
: > "$LOG"

exec > >(tee -a "$LOG") 2>&1
trap 'code=$?; printf "%s\n" "$code" > "$STATUS"; echo "exit_status=$code"; echo "log=$LOG"' EXIT
cd "$ROOT"

echo "started=$(date --iso-8601=seconds)"
echo "head=$(git rev-parse HEAD)"

if git rev-parse --verify --quiet "$UPSTREAM^{commit}" > /dev/null; then
  echo "upstream=$(git rev-parse "$UPSTREAM")"
  # Snapshot comparison is intentional: Deeptask and the shallow upstream ref have no merge base.
  git diff --no-renames --name-status "$UPSTREAM" HEAD > "$OUT/all-name-status.txt"
  git diff --no-renames --numstat "$UPSTREAM" HEAD > "$OUT/all-numstat.txt"
  git diff --no-renames --stat "$UPSTREAM" HEAD > "$OUT/all-stat.txt"
  git diff --no-renames --name-only "$UPSTREAM" HEAD -- \
    'src/**' 'webview-ui/**' 'packages/**' 'cli/**' 'apps/**' \
    > "$OUT/core-source-paths.txt"
else
  echo "upstream=skipped (missing $UPSTREAM)"
  : > "$OUT/all-name-status.txt"
  : > "$OUT/all-numstat.txt"
  : > "$OUT/all-stat.txt"
  : > "$OUT/core-source-paths.txt"
fi

git ls-files | awk -F/ 'NF == 1 { print }' | sort > "$OUT/root-tracked-files.txt"
git ls-files 'DEEPTASK_*.md' | sort > "$OUT/root-deeptask-docs.txt"
git ls-files 'scripts_*' 'inspect_*' | sort > "$OUT/root-deeptask-scripts.txt"

{
  echo "## status counts"
  awk '{count[$1]++} END {for (key in count) print key, count[key]}' "$OUT/all-name-status.txt" | sort
  echo
  echo "## top-level changed path counts"
  awk '{path=$NF; split(path, parts, "/"); count[parts[1]]++} END {for (key in count) print count[key], key}' \
    "$OUT/all-name-status.txt" | sort -nr | awk 'NR <= 40'
  echo
  echo "## Deeptask root inventory"
  echo "root_tracked=$(wc -l < "$OUT/root-tracked-files.txt")"
  echo "deeptask_docs=$(wc -l < "$OUT/root-deeptask-docs.txt")"
  echo "deeptask_scripts=$(wc -l < "$OUT/root-deeptask-scripts.txt")"
  echo "core_source_paths=$(wc -l < "$OUT/core-source-paths.txt")"
} | tee "$OUT/summary.txt"

echo "output_dir=$OUT"
echo "finished=$(date --iso-8601=seconds)"
