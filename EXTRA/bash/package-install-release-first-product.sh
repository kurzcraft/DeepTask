#!/usr/bin/env bash
set -uo pipefail

ROOT="/media/kurz/aleber/vscode/deeptask"
LOG="$ROOT/EXTRA/output/package-install-release-first-product.log"
STATUS="$ROOT/EXTRA/output/package-install-release-first-product.status"
mkdir -p "$ROOT/EXTRA/output"
exec > >(tee "$LOG") 2>&1

cd "$ROOT" || exit 1
result=0

printf '== Deeptask first product package/install/release ==\n'
printf 'started=%s\n' "$(date -Is)"

printf '\n== package ==\n'
bash "$ROOT/scripts_package_deeptask_vsix.sh" || result=$?

if [[ $result -eq 0 ]]; then
  printf '\n== install VSCodium ==\n'
  codium --install-extension "$ROOT/deeptask-5.5.0.vsix" --force || result=$?
fi

if [[ $result -eq 0 ]]; then
  printf '\n== verify installed extension ==\n'
  codium --list-extensions --show-versions | grep '^deeptask\.deeptask@5\.5\.0$' || result=$?
fi

if [[ $result -eq 0 ]]; then
  printf '\n== publish GitHub Release ==\n'
  node "$ROOT/scripts_publish_github_release.mjs" || result=$?
fi

if [[ $result -eq 0 ]]; then
  printf '\n== verify release asset ==\n'
  node "$ROOT/scripts_verify_authenticated_release_asset.mjs" || result=$?
fi

printf '\nfinished=%s\n' "$(date -Is)"
printf 'exit_status=%s\n' "$result"
printf '%s\n' "$result" > "$STATUS"
printf 'log=%s\n' "$LOG"
exit "$result"
