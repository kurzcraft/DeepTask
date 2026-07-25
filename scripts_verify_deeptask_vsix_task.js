const fs = require("fs")
const { execFileSync } = require("child_process")

const script = `from pathlib import Path
from zipfile import ZipFile
vsix = Path('deeptask-5.5.0.vsix')
print('exists', vsix.exists(), 'size', vsix.stat().st_size if vsix.exists() else 0)
assert vsix.exists() and vsix.stat().st_size > 1_000_000
with ZipFile(vsix) as z:
    svg = z.read('extension/assets/icons/kilo-light.svg').decode()
    extension = z.read('extension/dist/extension.js').decode(errors='ignore')
    webview = z.read('extension/webview-ui/build/assets/index.js').decode(errors='ignore')
    checks = {
        'big_left': 'M128 10L62 220L128 182L128 10Z' in svg,
        'big_right': 'M128 10L194 220L128 182V10Z' in svg,
        'thin': 'stroke-width="10"' in svg,
        'commitLanguageZh': 'language:"zh-CN",localRulesToggleState:void 0,globalRulesToggleState:void 0' in extension,
        'commitPromptZh': 'Use Simplified Chinese for the description and body by default' in extension,
        'terminalFallback': 'treated stream close as command completion' in extension,
        'terminalWaitMethod': 'waitForShellExecutionCompleteAfterStreamClose' in extension,
        'riskyWebviewPatchAbsent': 'as=$==="command_output"&&se' not in webview,
    }
    for key, value in checks.items():
        print(key, value)
    assert all(checks.values()), checks
with ZipFile(Path('bin/deeptask-5.5.0.vsix')) as z:
    assert z.read('extension/assets/icons/kilo-light.svg').decode().find('stroke-width="10"') >= 0
print('vsix task verification passed')
`

fs.writeFileSync("/tmp/verify_deeptask_vsix_task.py", script)
execFileSync("python3", ["/tmp/verify_deeptask_vsix_task.py"], { stdio: "inherit" })
