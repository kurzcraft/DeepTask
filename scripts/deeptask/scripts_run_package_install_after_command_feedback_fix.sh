#!/usr/bin/env bash
set -euo pipefail

ROOT="/media/kurz/aleber/vscode/deeptask"
cd "$ROOT"

python3 scripts/deeptask/scripts_patch_git_commit_chinese_dist.py
python3 scripts/deeptask/scripts_patch_command_output_immediate_feedback_dist.py
bash scripts/deeptask/scripts_package_deeptask_vsix.sh
python3 scripts/deeptask/scripts_verify_command_output_message_visible_vsix.py
python3 scripts/deeptask/scripts_verify_command_output_force_continue_send_vsix.py
python3 scripts/deeptask/scripts_verify_git_commit_entry_vsix.py
python3 scripts/deeptask/scripts_verify_deeptask_wildcard_auto_approval_vsix.py
codium --install-extension "$ROOT/deeptask-5.5.0.vsix" --force
python3 - <<'PY'
from pathlib import Path
installed = Path('/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0/webview-ui/build/assets/index.js')
text = installed.read_text(errors='ignore')
checks = {
    'installed_optimistic_user_feedback': 'say:"user_feedback"' in text and 'Date.now()' in text,
    'installed_terminal_payload': 'terminalOperationText:' in text and 'terminalOperationImages:' in text,
    'installed_ask_say_command_output_check': 'ask)==="command_output"' in text and 'say)==="command_output"' in text,
}
for key, value in checks.items():
    print(key, value)
if not all(checks.values()):
    raise SystemExit(1)
PY
ls -lh deeptask-5.5.0.vsix bin/deeptask-5.5.0.vsix
