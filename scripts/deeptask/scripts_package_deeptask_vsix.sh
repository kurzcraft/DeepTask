#!/usr/bin/env bash
set -euo pipefail

ROOT="/media/kurz/aleber/vscode/deeptask"
NODE20="/media/kurz/aleber/vscode/tools/node-v20.20.0-linux-x64/bin"
LOG_DIR="$ROOT/artifacts/deeptask/logs"
LOG="$LOG_DIR/DEEPTASK_PACKAGE_PROGRESS.log"
mkdir -p "$LOG_DIR"
export PATH="$NODE20:/home/kurz/nodejs/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export npm_config_yes=true
VERSION="$(node -p "require('$ROOT/src/package.json').version")"
VSIX_NAME="deeptask-${VERSION}.vsix"
export VERSION VSIX_NAME

step() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"
}

cd "$ROOT"
: > "$LOG"

step "1/10 检查 Node 与 npm 环境"
echo "node=$(command -v node)" | tee -a "$LOG"
node -v | tee -a "$LOG"
echo "npm=$(command -v npm)" | tee -a "$LOG"
npm -v | tee -a "$LOG"

step "2/10 强制重建 webview-ui（禁止复用旧 assets）"
(
  cd webview-ui
  # Turbo cache can serve stale ChatView builds that still clear Continue buttons.
  pnpm exec turbo run build --force --filter=@roo-code/vscode-webview
) 2>&1 | tee -a "$LOG"
if [[ ! -s src/webview-ui/build/assets/index.js ]]; then
  echo "缺少 src/webview-ui/build/assets/index.js，webview 未重建成功" | tee -a "$LOG"
  exit 1
fi
# Do not depend on rg/grep PATH for webview validation; use Python only.
python3 - <<'PYCHK' 2>&1 | tee -a "$LOG"
from pathlib import Path
import re

path = Path("src/webview-ui/build/assets/index.js")
t = path.read_text(errors="ignore")
if "proceedWhileRunning" not in t:
    raise SystemExit("webview assets 缺少 proceedWhileRunning，疑似旧 UI")
if "proceedWhileRunning.title" not in t and "proceedWhileRunning" not in t:
    raise SystemExit("webview assets 缺少 proceedWhileRunning.title")

# Old ChatView cleared buttons when answered command had no active shell set.
old_markers = [
    "isAnswered&&Ye.current.size===0",
    re.compile(r"isAnswered&&\w+\.current\.size===0\)\{\w+\(!1\),\w+\(void 0\),\w+\(!1\)"),
]
for marker in old_markers:
    hit = marker in t if isinstance(marker, str) else bool(marker.search(t))
    if hit:
        raise SystemExit("webview assets still contain old clear-button logic")

print(f"webview assets ok size={path.stat().st_size} proceedWhileRunning={t.count('proceedWhileRunning')}")
print("webview clear-button regression markers absent")
PYCHK
ls -lh src/webview-ui/build/assets/index.js | tee -a "$LOG"

step "3/10 重建并检查扩展构建产物"
(
  cd src
  pnpm bundle --production
) 2>&1 | tee -a "$LOG"
if [[ ! -s src/dist/extension.js ]]; then
  echo "缺少 src/dist/extension.js，不能打包真实扩展" | tee -a "$LOG"
  exit 1
fi
if ! grep -q "completedTerminalOrder" src/dist/extension.js; then
  echo "src/dist/extension.js 缺少 completedTerminalOrder，疑似打包了旧终端保留逻辑" | tee -a "$LOG"
  exit 1
fi
if ! grep -q "hasPendingWebviewAskResponse" src/dist/extension.js; then
  echo "src/dist/extension.js 缺少 hasPendingWebviewAskResponse，疑似打包了旧命令完成逻辑" | tee -a "$LOG"
  exit 1
fi
# Force-complete + prune on every command settle must be present.
if ! grep -q "notifyTerminalProcessCompleted" src/dist/extension.js; then
  echo "src/dist/extension.js 缺少 notifyTerminalProcessCompleted" | tee -a "$LOG"
  exit 1
fi
if ! grep -q "visibility=\"silent\"" src/dist/extension.js; then
  echo "src/dist/extension.js 缺少静默任务聚焦胶囊" | tee -a "$LOG"
  exit 1
fi
if ! grep -q "do not quote, paraphrase, or restate it" src/dist/extension.js; then
  echo "src/dist/extension.js 缺少防重复聚焦指令" | tee -a "$LOG"
  exit 1
fi
if ! grep -q "OpenAI Compatible is not configured" src/dist/extension.js; then
  echo "src/dist/extension.js 缺少全新安装配置门禁" | tee -a "$LOG"
  exit 1
fi
if ! grep -q "could not be rehydrated after cancellation" src/dist/extension.js; then
  echo "src/dist/extension.js 缺少取消时持久化缺失自愈路径" | tee -a "$LOG"
  exit 1
fi
if ! grep -q "taskkill" src/dist/extension.js; then
  echo "src/dist/extension.js 缺少 Windows 有界进程树终止路径" | tee -a "$LOG"
  exit 1
fi
if ! grep -q "taskkill failed for PID" src/dist/extension.js; then
  echo "src/dist/extension.js 缺少 Windows 终止失败的 fail-soft 诊断" | tee -a "$LOG"
  exit 1
fi
ls -lh src/dist/extension.js | tee -a "$LOG"
if compgen -G 'src/webview-ui/build/assets/*.js' > /dev/null; then
  find src/webview-ui/build/assets -maxdepth 1 -name '*.js' | wc -l | awk '{print "webview js assets=" $1}' | tee -a "$LOG"
else
  echo "警告：src/webview-ui/build/assets/*.js 不存在，后续 VSIX 验证会失败" | tee -a "$LOG"
fi

step "4/10 同步 legacy 构建产物与插件介绍中的 Deeptask 品牌"
python3 scripts/deeptask/scripts_fix_deeptask_residue.py 2>&1 | tee -a "$LOG"
python3 scripts/deeptask/scripts_patch_legacy_webview_branding.py 2>&1 | tee -a "$LOG"

step "5/10 检查临时 @vscode/vsce 可用性"
npx --yes @vscode/vsce --version 2>&1 | tee -a "$LOG"

step "6/10 临时移除 src/package.json 的 vscode:prepublish，避免缺失依赖触发 bundle"
python3 - <<'PY' 2>&1 | tee -a "$LOG"
import json
from pathlib import Path
p = Path('src/package.json')
data = json.loads(p.read_text())
scripts = data.setdefault('scripts', {})
old = scripts.pop('vscode:prepublish', None)
Path('/tmp/deeptask_vscode_prepublish_value.txt').write_text(old or '')
p.write_text(json.dumps(data, indent='\t', ensure_ascii=False) + '\n')
print('temporarily removed vscode:prepublish:', bool(old))
PY

restore() {
  step "恢复 src/package.json 的 vscode:prepublish"
  python3 - <<'PY' 2>&1 | tee -a "$LOG"
import json
from pathlib import Path
p = Path('src/package.json')
data = json.loads(p.read_text())
old_path = Path('/tmp/deeptask_vscode_prepublish_value.txt')
old = old_path.read_text() if old_path.exists() else ''
if old:
    data.setdefault('scripts', {})['vscode:prepublish'] = old
p.write_text(json.dumps(data, indent='\t', ensure_ascii=False) + '\n')
print('restored vscode:prepublish:', bool(old))
PY
}
trap restore EXIT

step "7/10 执行 VSIX 打包到 bin/$VSIX_NAME"
mkdir -p bin
rm -f "bin/$VSIX_NAME" "$VSIX_NAME"
cp -f CHANGELOG.md src/CHANGELOG.md
(
  cd src
  npx --yes @vscode/vsce package --no-dependencies --out "../bin/$VSIX_NAME"
) 2>&1 | tee -a "$LOG"

step "8/10 复制 VSIX 到仓库根目录"
cp -f "bin/$VSIX_NAME" "$VSIX_NAME"
ls -lh "bin/$VSIX_NAME" "$VSIX_NAME" | tee -a "$LOG"

step "9/10 验证 VSIX 内容与品牌资源"
python3 - <<'PY' 2>&1 | tee -a "$LOG"
from pathlib import Path
from zipfile import ZipFile
import json
import os
import re
version = os.environ['VERSION']
vsix = Path(os.environ['VSIX_NAME'])
assert vsix.exists() and vsix.stat().st_size > 1_000_000, vsix
residue_patterns = [
    'About Kilo Code',
    'alt="Kilo Code"',
    'Kilo_Code_Branding',
    'Kilo Code Branding',
    'Development: Allocate memory',
    'settings:footer.support',
    'https://kilo.ai/support',
    'https://app.kilo.ai/share/',
    'https://kilo.ai/pricing',
    'https://kilo.ai/discord',
    'https://roocode.com',
    'kurzgesagtcraft/deeptask',
    'https://media.githubusercontent.com/media/Kilo-Org/kilocode',
    'avatars.githubusercontent.com',
    'github.com/Kilo-Org/kilocode',
    'github.com/RooCodeInc',
    'discord.gg/kilocode',
    'reddit.com/r/kilocode',
    'reddit.com/r/RooCode',
    'x.com/roocode',
]
scan_prefixes = (
    'extension/readme.md',
    'extension/package.nls',
    'extension/webview-ui/build/assets/',
    'extension/dist/i18n/locales/',
    'extension/dist/walkthrough/',
)
with ZipFile(vsix) as z:
    names = set(z.namelist())
    pkg = json.loads(z.read('extension/package.json'))
    print('package:', pkg['name'], pkg['publisher'], pkg['version'], pkg['main'])
    assert pkg['name'] == 'deeptask', pkg['name']
    assert pkg['publisher'] == 'deeptask', pkg['publisher']
    assert pkg['version'] == version, pkg['version']
    required = [
        'extension/dist/extension.js',
        'extension/assets/deeptask-logo-v2.png',
        'extension/assets/icons/logo-outline-black.png',
        'extension/assets/icons/kilo-light.svg',
        'extension/assets/icons/kilo-dark.svg',
        'extension/webview-ui/build/assets/agent-manager.js',
    ]
    missing = [name for name in required if name not in names]
    assert not missing, missing
    locale_names = sorted(
        name for name in names
        if name.startswith('extension/dist/i18n/locales/') and name.endswith('/common.json')
    )
    assert len(locale_names) == 22, f'expected 22 packaged locales, found {len(locale_names)}'
    expected_docs_url = (
        'https://github.com/kurzcraft/DeepTask/blob/main/'
        'docs/deeptask/guides/USER_GUIDE.md'
    )
    for locale_name in locale_names:
        locale = json.loads(z.read(locale_name))
        assert locale['docsLink']['url'] == expected_docs_url, (
            locale_name,
            locale['docsLink']['url'],
        )
    light_svg = z.read('extension/assets/icons/kilo-light.svg').decode()
    assert 'L62 220' in light_svg and 'L194 220' in light_svg
    assert 'stroke-width="10"' in light_svg
    extension_js = z.read('extension/dist/extension.js').decode(errors='ignore')
    assert 'completedTerminalOrder' in extension_js, 'extension bundle missing completed terminal order fix'
    assert 'hasPendingWebviewAskResponse' in extension_js, 'extension bundle missing fast command ask response guard'
    assert 'notifyTerminalProcessCompleted' in extension_js, 'extension bundle missing terminal completion notify'
    assert 'visibility="silent"' in extension_js, 'extension bundle missing silent task focus capsule'
    assert 'do not quote, paraphrase, or restate it' in extension_js, 'extension bundle missing focus repetition guard'
    assert 'OpenAI Compatible is not configured' in extension_js, 'extension bundle missing fresh-install guard'
    assert 'could not be rehydrated after cancellation' in extension_js, 'extension bundle missing cancel recovery'
    assert 'taskkill' in extension_js, 'extension bundle missing bounded Windows tree termination'
    assert 'taskkill failed for PID' in extension_js, 'extension bundle missing Windows fail-soft diagnostic'
    # Force-complete prune path must not require prior hasCompletedCommand.
    assert 'hasCompletedCommand&&!e.busy' not in extension_js or 'provider!=="vscode"' in extension_js
    readme = z.read('extension/readme.md').decode(errors='ignore')
    assert '# Deeptask' in readme or re.search(r'<h1[^>]*>Deeptask</h1>', readme), 'readme missing Deeptask title'
    hero_match = re.search(r'<img\s+src="([^"]*assets/deeptask-logo-v2\.png)"', readme)
    assert hero_match, 'Marketplace README missing packaged hero image reference'
    hero_url = hero_match.group(1)
    assert hero_url.startswith('./') or 'github.com/kurzcraft/DeepTask' in hero_url, hero_url
    assert 'https://github.com/kurzcraft/DeepTask' in readme, 'Marketplace README missing current GitHub repository'
    assert 'style=for-the-badge&logo=github' in readme, 'Marketplace README missing prominent GitHub action'
    assert '把跨小时、跨会话、持续变化的软件任务真正做完' in readme, 'Marketplace README missing long-task value proposition'
    assert 'docs/deeptask/guides/USER_GUIDE.md' in readme, 'Marketplace README missing user guide link'
    assert 'verified 5.5.0 legacy source line' not in readme, 'Marketplace README reverted to legacy copy'
    assert '../logo.png' not in readme, 'Marketplace README reverted to legacy hero path'
    assert 'kurzgesagtcraft/deeptask' not in readme.lower(), 'Marketplace README contains obsolete repository URL'
    assert 'contributors who help make Kilo better' not in readme
    assert 'avatars.githubusercontent.com' not in readme
    assert 'media.githubusercontent.com/media/Kilo-Org/kilocode' not in readme
    web_js = [name for name in names if name.startswith('extension/webview-ui/build/assets/') and name.endswith('.js')]
    assert web_js, 'missing webview build js assets'
    index_js_names = [n for n in web_js if n.endswith('/index.js') or n.endswith('index.js')]
    assert index_js_names, 'missing webview index.js'
    index_js = z.read(index_js_names[0]).decode(errors='ignore')
    assert 'proceedWhileRunning' in index_js, 'webview missing Continue button i18n key'
    # Reject the known old clear-button patterns from shell lifecycle.
    old_clear_markers = [
        'isAnswered&&Ye.current.size===0',
        'Qt==="started"||Qt==="output"?(Ye.current.add(xt),Dt.current==="command"&&(V(void 0),re(!1)',
    ]
    for marker in old_clear_markers:
        assert marker not in index_js, f'webview still contains old clear-button marker: {marker}'
    hits = []
    for name in names:
        if not name.endswith(('.js', '.json', '.md', '.html', '.svg', '.txt')):
            continue
        if not (name in scan_prefixes or name.startswith(scan_prefixes)):
            continue
        text = z.read(name).decode(errors='ignore')
        for pattern in residue_patterns:
            if pattern in text:
                hits.append(f'{name}: {pattern}')
    assert not hits, hits[:80]
print('VSIX verified:', vsix, vsix.stat().st_size)
PY

step "10/10 打包完成"
