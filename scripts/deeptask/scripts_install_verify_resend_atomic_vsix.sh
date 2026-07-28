#!/usr/bin/env bash
set -euo pipefail
cd /media/kurz/aleber/vscode/deeptask
codium --install-extension deeptask-5.5.0.vsix --force
codium --list-extensions --show-versions | rg '^deeptask\.deeptask@5\.5\.0$'
sha256sum deeptask-5.5.0.vsix
python3 - <<'PYVERIFY'
from pathlib import Path
path = Path('/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0/dist/extension.js')
text = path.read_text(errors='ignore')
required = [
    'Error processing cancelled-task continuation',
    'pendingCancelledTaskContinuation',
    'continueTaskFromUserMessage',
    'edited_resend',
    'Edited user message resubmitted after rewinding the conversation',
]
for marker in required:
    if marker not in text:
        raise SystemExit(f'missing installed marker: {marker}')
print('installed extension markers verified', path.stat().st_size)
PYVERIFY
