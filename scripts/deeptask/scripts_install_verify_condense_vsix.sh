#!/usr/bin/env bash
set -euo pipefail

ROOT="/media/kurz/aleber/vscode/deeptask"
VSIX="$ROOT/deeptask-5.5.0.vsix"
SOURCE_BUNDLE="$ROOT/src/dist/extension.js"
INSTALLED="/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0/dist/extension.js"

codium --install-extension "$VSIX" --force
codium --list-extensions --show-versions | rg '^deeptask\.deeptask@5\.5\.0$'
sha256sum "$VSIX"

python3 - "$SOURCE_BUNDLE" "$INSTALLED" <<'PYVERIFY'
from hashlib import sha256
from pathlib import Path
import sys

source = Path(sys.argv[1])
path = Path(sys.argv[2])
source_hash = sha256(source.read_bytes()).hexdigest()
installed_hash = sha256(path.read_bytes()).hexdigest()
if source_hash != installed_hash:
    raise SystemExit(f"source/installed bundle mismatch: {source_hash} != {installed_hash}")
text = path.read_text(errors="ignore")
required = [
    "condenseStorageIndex",
    "contextManagementInFlight",
    "apiConversationHistoryRevision",
    "reused_in_flight",
    "stale_discarded",
    "reasoning_details",
    "condenseParent",
]
for marker in required:
    if marker not in text:
        raise SystemExit(f"missing installed condense marker: {marker}")
print(f"installed condense markers verified size={path.stat().st_size} sha256={installed_hash}")
PYVERIFY
