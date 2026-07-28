from pathlib import Path
from zipfile import ZipFile
import json

paths = {
    'repo_src_package': Path('src/package.json'),
    'repo_dist_extension': Path('src/dist/extension.js'),
    'installed_package': Path('/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0/package.json'),
    'installed_extension': Path('/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0/dist/extension.js'),
}

command_ids = [
    'deeptask.vsc.generateCommitMessage',
    'kilo-code.vsc.generateCommitMessage',
]

def check_package(label, path):
    print('PACKAGE', label, path, path.exists())
    if not path.exists():
        return
    data = json.loads(path.read_text())
    commands = data.get('contributes', {}).get('commands', [])
    menus = data.get('contributes', {}).get('menus', {})
    all_text = json.dumps(data, ensure_ascii=False)
    for cid in command_ids:
        print(label, cid, cid in all_text)
    print(label, 'scm/input menu', menus.get('scm/input'))
    print(label, 'scm/title menu', menus.get('scm/title'))
    print(label, 'activationEvents contains deeptask command', f'onCommand:{command_ids[0]}' in data.get('activationEvents', []))

def check_extension(label, path):
    print('EXTENSION', label, path, path.exists())
    if not path.exists():
        return
    text = path.read_text(errors='ignore')
    for cid in command_ids:
        print(label, 'runtime command', cid, cid in text)
    print(label, 'zh-CN language', 'language:"zh-CN"' in text or 'language:"zh-CN"' in text)
    print(label, 'simplified chinese prompt', 'Use Simplified Chinese for the description and body by default' in text)

for label, path in paths.items():
    if 'package' in label:
        check_package(label, path)
    else:
        check_extension(label, path)

vsix = Path('deeptask-5.5.0.vsix')
print('VSIX', vsix, vsix.exists(), vsix.stat().st_size if vsix.exists() else 0)
if vsix.exists():
    with ZipFile(vsix) as z:
        pkg = json.loads(z.read('extension/package.json'))
        ext = z.read('extension/dist/extension.js').decode(errors='ignore')
        all_pkg = json.dumps(pkg, ensure_ascii=False)
        for cid in command_ids:
            print('vsix package command', cid, cid in all_pkg)
            print('vsix runtime command', cid, cid in ext)
        print('vsix activation deeptask', f'onCommand:{command_ids[0]}' in pkg.get('activationEvents', []))
        print('vsix scm/input', pkg.get('contributes', {}).get('menus', {}).get('scm/input'))
        print('vsix scm/title', pkg.get('contributes', {}).get('menus', {}).get('scm/title'))
