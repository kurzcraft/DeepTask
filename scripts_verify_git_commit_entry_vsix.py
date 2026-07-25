from pathlib import Path
from zipfile import ZipFile
import json

vsix = Path('deeptask-5.5.0.vsix')
with ZipFile(vsix) as z:
    pkg = json.loads(z.read('extension/package.json'))
    ext = z.read('extension/dist/extension.js').decode(errors='ignore')
    web = z.read('extension/webview-ui/build/assets/index.js').decode(errors='ignore')
commands = {c.get('command') for c in pkg.get('contributes', {}).get('commands', [])}
activation_events = set(pkg.get('activationEvents', []))
menus = pkg.get('contributes', {}).get('menus', {})
scm_input = [m.get('command') for m in menus.get('scm/input', [])]
scm_title = [m.get('command') for m in menus.get('scm/title', [])]
checks = {
    'vsix_exists': vsix.exists(),
    'vsix_size': vsix.stat().st_size,
    'manifest_command': 'deeptask.vsc.generateCommitMessage' in commands,
    'manifest_legacy_command': 'kilo-code.vsc.generateCommitMessage' in commands,
    'manifest_deeptask_activation': 'onCommand:deeptask.vsc.generateCommitMessage' in activation_events,
    'manifest_legacy_activation': 'onCommand:kilo-code.vsc.generateCommitMessage' in activation_events,
    'manifest_scm_input': 'deeptask.vsc.generateCommitMessage' in scm_input,
    'manifest_scm_title': 'deeptask.vsc.generateCommitMessage' in scm_title,
    'runtime_deeptask_command': 'registerCommand("deeptask.vsc.generateCommitMessage"' in ext,
    'runtime_legacy_command': 'registerCommand("kilo-code.vsc.generateCommitMessage"' in ext,
    'runtime_terminal_risky_patch_absent': 'waitForShellExecutionCompleteAfterStreamClose' not in ext and 'treated stream close as command completion' not in ext,
    'runtime_webview_risky_patch_absent': 'as=$==="command_output"&&se' not in web,
}
for key, value in checks.items():
    print(f'{key}: {value}')
if not all(value for key, value in checks.items() if key != 'vsix_size'):
    raise SystemExit('verification failed')
