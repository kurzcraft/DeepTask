#!/usr/bin/env bash
set -euo pipefail

ROOT="/media/kurz/aleber/vscode/deeptask"
VSIX="$ROOT/deeptask-5.5.0.vsix"
INSTALLED_DIR="/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0/dist"

cd "$ROOT"
bash scripts/deeptask/scripts_package_deeptask_vsix.sh
codium --install-extension "$VSIX" --force
codium --list-extensions --show-versions | grep '^deeptask\.deeptask@5\.5\.0$'

python3 scripts/deeptask/scripts_verify_installed_cancel_output_fix.py
