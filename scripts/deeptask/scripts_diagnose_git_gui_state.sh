#!/usr/bin/env bash
set -u

printf '## git status\n'
git status --short --branch

printf '\n## branch\n'
git branch --show-current

printf '\n## upstream\n'
git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true

printf '\n## ahead behind\n'
git rev-list --left-right --count HEAD...@{u} 2>/dev/null || true

printf '\n## remote\n'
git remote -v

printf '\n## relevant git config\n'
for key in core.hooksPath alias.pushfast alias.pushstrict alias.pushdry merge.conflictstyle credential.helper user.name user.email; do
  printf '%s=' "$key"
  git config --get "$key" || true
done

printf '\n## hook files\n'
ls -la .git/no-hooks 2>/dev/null || true
ls -la .husky 2>/dev/null | sed -n '1,20p' || true

printf '\n## versions\n'
git --version
node --version 2>/dev/null || true
pnpm --version 2>/dev/null || true
bun --version 2>/dev/null || true

printf '\n## git processes in this repo\n'
ps -eo pid,ppid,stat,etime,cmd | grep -F '/media/kurz/aleber/vscode/deeptask' | grep -E 'git|husky|turbo|gradle|pnpm|bun' | grep -v grep || true

printf '\n## dry-run push\n'
git push --dry-run 2>&1 || true
