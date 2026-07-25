#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/media/kurz/aleber/vscode/deeptask"
LOG="$ROOT/EXTRA/output/organize-deeptask-markdown.log"
STATUS="$ROOT/EXTRA/output/organize-deeptask-markdown.status"
CURRENT_PROGRESS="DEEPTASK_PROJECT_ORGANIZATION_AND_UPSTREAM_COMPARISON_PROGRESS.md"
RELEASE_NOTES="DEEPTASK_RELEASE_5.5.0_NOTES.md"

mkdir -p "$ROOT/EXTRA/output"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1
trap 'code=$?; printf "%s\n" "$code" > "$STATUS"; echo "exit_status=$code"; echo "log=$LOG"' EXIT

cd "$ROOT"
mkdir -p docs/deeptask/progress docs/deeptask/analysis docs/deeptask/guides

echo "started=$(date --iso-8601=seconds)"
echo "scope=markdown-only"
echo "preserve=$CURRENT_PROGRESS"
echo "preserve=$RELEASE_NOTES"

moved_progress=0
while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  [[ "$path" == "$CURRENT_PROGRESS" ]] && continue
  [[ "$path" == "$RELEASE_NOTES" ]] && continue
  git mv "$path" "docs/deeptask/progress/$path"
  echo "moved $path -> docs/deeptask/progress/$path"
  moved_progress=$((moved_progress + 1))
done < <(git ls-files 'DEEPTASK_*_PROGRESS.md' | sort)

if git ls-files --error-unmatch DEEPTASK_RESEND_CONTEXT_LOSS_ROOT_CAUSE_ANALYSIS.md >/dev/null 2>&1; then
  git mv DEEPTASK_RESEND_CONTEXT_LOSS_ROOT_CAUSE_ANALYSIS.md \
    docs/deeptask/analysis/DEEPTASK_RESEND_CONTEXT_LOSS_ROOT_CAUSE_ANALYSIS.md
  echo "moved DEEPTASK_RESEND_CONTEXT_LOSS_ROOT_CAUSE_ANALYSIS.md -> docs/deeptask/analysis/"
fi

if git ls-files --error-unmatch DEEPTASK_PACKAGING.md >/dev/null 2>&1; then
  git mv DEEPTASK_PACKAGING.md docs/deeptask/guides/DEEPTASK_PACKAGING.md
  echo "moved DEEPTASK_PACKAGING.md -> docs/deeptask/guides/"
fi

echo "moved_progress=$moved_progress"
echo "root_deeptask_markdown_after:"
find . -maxdepth 1 -type f -name 'DEEPTASK_*.md' -printf '%f\n' | sort

echo "archived_markdown_count=$(find docs/deeptask -type f -name '*.md' | wc -l)"
echo "finished=$(date --iso-8601=seconds)"
