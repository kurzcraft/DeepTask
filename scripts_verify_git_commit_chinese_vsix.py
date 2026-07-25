from pathlib import Path
from zipfile import ZipFile
import json

vsix = Path('deeptask-5.5.0.vsix')
with ZipFile(vsix) as z:
    pkg = json.loads(z.read('extension/package.json'))
    ext = z.read('extension/dist/extension.js').decode(errors='ignore')
    web = z.read('extension/webview-ui/build/assets/index.js').decode(errors='ignore')
commands = {c.get('command') for c in pkg.get('contributes', {}).get('commands', [])}
menus = pkg.get('contributes', {}).get('menus', {})
checks = {
    'vsix_exists': vsix.exists(),
    'vsix_size': vsix.stat().st_size,
    'manifest_command': 'deeptask.vsc.generateCommitMessage' in commands,
    'manifest_scm_input': any(m.get('command') == 'deeptask.vsc.generateCommitMessage' for m in menus.get('scm/input', [])),
    'manifest_scm_title': any(m.get('command') == 'deeptask.vsc.generateCommitMessage' for m in menus.get('scm/title', [])),
    'runtime_deeptask_command': 'registerCommand("deeptask.vsc.generateCommitMessage"' in ext,
    'runtime_legacy_command': 'registerCommand("kilo-code.vsc.generateCommitMessage"' in ext,
    'runtime_commit_language_zh_cn': 'Vz("","","","commit",{language:"zh-CN",localRulesToggleState:void 0,globalRulesToggleState:void 0})' in ext,
    'runtime_commit_prompt_simplified_chinese': 'Use Simplified Chinese for the description and body by default' in ext,
    'runtime_terminal_risky_patch_absent': 'waitForShellExecutionCompleteAfterStreamClose' not in ext and 'treated stream close as command completion' not in ext,
    'runtime_webview_risky_patch_absent': 'as=$==="command_output"&&se' not in web,
}
for key, value in checks.items():
    print(f'{key}: {value}')
if not all(value for key, value in checks.items() if key != 'vsix_size'):
    raise SystemExit('verification failed')
