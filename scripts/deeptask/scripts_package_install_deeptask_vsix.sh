#!/usr/bin/env bash
set -euo pipefail

ROOT="/media/kurz/aleber/vscode/deeptask"
LOG_DIR="$ROOT/EXTRA/output"
LOG_FILE="$LOG_DIR/package_install_deeptask_vsix.log"
NODE20="/media/kurz/aleber/vscode/tools/node-v20.20.0-linux-x64/bin"

mkdir -p "$LOG_DIR"
{
  echo "[package-install] started: $(date --iso-8601=seconds)"
  cd "$ROOT"
  export PATH="$NODE20:/home/kurz/nodejs/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

  VERSION="$(node -p "require('./src/package.json').version")"
  VSIX="$ROOT/deeptask-${VERSION}.vsix"
  INSTALLED="/home/kurz/.vscode-oss/extensions/deeptask.deeptask-${VERSION}/dist/extension.js"

  echo "[package-install] target_version=$VERSION"
  bash scripts/deeptask/scripts_package_deeptask_vsix.sh
  test -s "$VSIX"
  codium --install-extension "$VSIX" --force
  codium --list-extensions --show-versions | grep -E "^deeptask\\.deeptask@${VERSION//./\\.}$"

  python3 - "$ROOT/src/dist/extension.js" "$INSTALLED" <<'PY'
from hashlib import sha256
from pathlib import Path
import sys

source = Path(sys.argv[1])
installed = Path(sys.argv[2])
if not installed.is_file():
    raise SystemExit(f"installed extension bundle missing: {installed}")
source_hash = sha256(source.read_bytes()).hexdigest()
installed_hash = sha256(installed.read_bytes()).hexdigest()
if source_hash != installed_hash:
    raise SystemExit(f"source/installed bundle mismatch: {source_hash} != {installed_hash}")
print(f"[package-install] installed bundle matches source sha256={installed_hash}")
PY
  sha256sum "$VSIX"
  echo "[package-install] exit_status=0"
} 2>&1 | tee "$LOG_FILE"
