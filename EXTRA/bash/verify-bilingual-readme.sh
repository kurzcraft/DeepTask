#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/media/kurz/aleber/vscode/deeptask"
LOG="$ROOT/EXTRA/output/verify-bilingual-readme.log"
STATUS="$ROOT/EXTRA/output/verify-bilingual-readme.status"
mkdir -p "$(dirname "$LOG")"
exec > >(tee "$LOG") 2>&1
trap 'code=$?; printf "%s\n" "$code" > "$STATUS"; printf "exit_status=%d\nlog=%s\n" "$code" "$LOG"' EXIT

cd "$ROOT"

printf 'started=%s\n' "$(date --iso-8601=seconds)"
printf 'default_readme_language='
if grep -q '面向长任务与真实工程交付' README.md; then
  printf 'zh-CN\n'
else
  printf 'unexpected\n'
  exit 1
fi

grep -Fq '<a href="./README_EN.md">English</a>' README.md
grep -Fq '<a href="./README.md">简体中文</a>' README_EN.md
printf 'language_links=ok\n'

for path in \
  src/assets/icons/kilo-dark.svg \
  src/assets/icons/kilo-light.svg \
  src/assets/icons/logo-outline-black.png \
  DEVELOPMENT.md \
  LICENSE \
  CODE_OF_CONDUCT.md; do
  test -f "$path"
  printf 'resource_ok=%s\n' "$path"
done

for heading in 'Quick start' 'Architecture' 'Local development' 'License'; do
  grep -Fqi "## $heading" README_EN.md
  printf 'english_section_ok=%s\n' "$heading"
done

for heading in '快速开始' '架构概览' '本地开发' '开源协议'; do
  grep -Fq "## $heading" README.md
  printf 'chinese_section_ok=%s\n' "$heading"
done

if grep -q '本次正式发布提交说明' README.md README_EN.md; then
  printf 'internal_commit_instruction=found\n'
  exit 1
fi
printf 'internal_commit_instruction=absent\n'

git diff --check
printf 'git_diff_check=ok\n'

printf 'readme_lines_zh=' && wc -l < README.md
printf 'readme_lines_en=' && wc -l < README_EN.md
