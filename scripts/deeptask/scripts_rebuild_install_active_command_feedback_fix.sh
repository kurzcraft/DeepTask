#!/usr/bin/env bash
set -euo pipefail

ROOT="/media/kurz/aleber/vscode/deeptask"
cd "$ROOT"

pnpm --dir webview-ui build
python3 scripts/deeptask/scripts_patch_git_commit_chinese_dist.py
python3 scripts/deeptask/scripts_patch_command_output_immediate_feedback_dist.py
bash scripts/deeptask/scripts_package_deeptask_vsix.sh
python3 scripts/deeptask/scripts_verify_command_output_message_visible_vsix.py
python3 scripts/deeptask/scripts_verify_command_output_force_continue_send_vsix.py
python3 scripts/deeptask/scripts_verify_git_commit_entry_vsix.py
python3 scripts/deeptask/scripts_verify_deeptask_wildcard_auto_approval_vsix.py
codium --install-extension "$ROOT/deeptask-5.5.0.vsix" --force
code --install-extension "$ROOT/deeptask-5.5.0.vsix" --force || true
python3 - <<'PY'
from pathlib import Path
for base in ['/home/kurz/.vscode-oss/extensions', '/home/kurz/.vscode/extensions']:
    root = Path(base) / 'deeptask.deeptask-5.5.0'
    web = root / 'webview-ui/build/assets/index.js'
    text = web.read_text(errors='ignore') if web.exists() else ''
    checks = {
        'exists': web.exists(),
        'optimistic': 'say:"user_feedback"' in text and 'Date.now()' in text,
        'payload': 'terminalOperationText:' in text and 'terminalOperationImages:' in text,
        'ask_say': 'ask)==="command_output"' in text and 'say)==="command_output"' in text,
        'active_command_status': 'commandExecutionStatus' in text and '.size>0' in text,
    }
    print(root)
    for key, value in checks.items():
        print(f'  {key}: {value}')
    if not all(checks.values()):
        raise SystemExit(1)
PY
ls -lh deeptask-5.5.0.vsix bin/deeptask-5.5.0.vsix
