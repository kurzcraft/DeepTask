from pathlib import Path
from zipfile import ZipFile

vsix = Path('deeptask-5.5.0.vsix')
print('vsix_exists', vsix.exists())
print('vsix_size', vsix.stat().st_size if vsix.exists() else 0)
if not vsix.exists():
    raise SystemExit(1)

with ZipFile(vsix) as z:
    names = set(z.namelist())
    extension = z.read('extension/dist/extension.js').decode()
    package_json = z.read('extension/package.json').decode()
    svg = z.read('extension/assets/icons/kilo-light.svg').decode()

checks = {
    'manifest_deeptask_commit_command': 'deeptask.vsc.generateCommitMessage' in package_json,
    'manifest_legacy_commit_command': 'kilo-code.vsc.generateCommitMessage' in package_json,
    'manifest_deeptask_commit_activation': 'onCommand:deeptask.vsc.generateCommitMessage' in package_json,
    'manifest_legacy_commit_activation': 'onCommand:kilo-code.vsc.generateCommitMessage' in package_json,
    'runtime_deeptask_commit_command': 'deeptask.vsc.generateCommitMessage' in extension,
    'runtime_legacy_commit_command': 'kilo-code.vsc.generateCommitMessage' in extension,
    'runtime_commit_language_zh_cn': 'language:"zh-CN"' in extension,
    'runtime_commit_prompt_simplified_chinese': 'Use Simplified Chinese for the description and body by default' in extension,
    'runtime_wildcard_gate': 'some(a=>a.trim()==="*")' in extension,
    'runtime_wildcard_decision_uses_allowed_variable': 'cOs(r,s,t.deniedCommands||[])' in extension,
    'runtime_terminal_risky_patch_absent': 'waitForShellExecutionCompleteAfterStreamClose' not in extension and 'treated stream close as command completion' not in extension,
    'runtime_webview_risky_patch_absent': 'as=$==="command_output"&&se' not in extension,
    'icon_big_left': 'M128 10L62 220L128 182L128 10Z' in svg,
    'icon_big_right': 'M128 10L194 220L128 182V10Z' in svg,
    'icon_thin': 'stroke-width="10"' in svg,
    'bin_vsix_exists': Path('bin/deeptask-5.5.0.vsix').exists(),
}
for key, value in checks.items():
    print(key, value)

failed = [key for key, value in checks.items() if not value]
if failed:
    print('failed_checks', ', '.join(failed))
    raise SystemExit(1)
print('all_checks_passed', True)
