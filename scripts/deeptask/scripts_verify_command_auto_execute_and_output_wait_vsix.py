from pathlib import Path
from zipfile import ZipFile

vsix = Path('deeptask-5.5.0.vsix')
print('vsix_exists', vsix.exists())
print('vsix_size', vsix.stat().st_size if vsix.exists() else 0)
if not vsix.exists():
    raise SystemExit(1)

with ZipFile(vsix) as z:
    extension = z.read('extension/dist/extension.js').decode()
    package_json = z.read('extension/package.json').decode()

checks = {
    'manifest_deeptask_commit_command': 'deeptask.vsc.generateCommitMessage' in package_json,
    'runtime_commit_language_zh_cn': 'language:"zh-CN"' in extension,
    'runtime_allowed_prefix_trim': 'let o=s.trim().toLowerCase();if(!o)continue;' in extension,
    'runtime_wildcard_gate': 'some(a=>a.trim()==="*")' in extension,
    'runtime_terminal_continue_answers_ask': 'this.handleWebviewAskResponse("messageResponse"),this.terminalProcess?.continue()' in extension,
    'runtime_terminal_abort_answers_ask': 'this.handleWebviewAskResponse("noButtonClicked"),this.terminalProcess?.abort()' in extension,
    'runtime_no_old_terminal_operation': 'async handleTerminalOperation(e){e==="continue"?this.terminalProcess?.continue():e==="abort"&&this.terminalProcess?.abort()}' not in extension,
    'bin_vsix_exists': Path('bin/deeptask-5.5.0.vsix').exists(),
}
for key, value in checks.items():
    print(key, value)
failed = [key for key, value in checks.items() if not value]
if failed:
    print('failed_checks', ', '.join(failed))
    raise SystemExit(1)
print('all_checks_passed', True)
