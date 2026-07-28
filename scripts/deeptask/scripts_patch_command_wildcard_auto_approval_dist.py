from pathlib import Path

path = Path('src/dist/extension.js')
text = path.read_text()

old = 'if(t.alwaysAllowExecute===!0){let s=cOs(r,t.allowedCommands||[],t.deniedCommands||[]);return s==="auto_approve"?{decision:"approve"}:s==="auto_deny"?{decision:"deny"}:{decision:"ask"}}'
new = 'let s=t.allowedCommands||[],o=s.some(a=>a.trim()==="*");if(t.alwaysAllowExecute===!0||o){let a=cOs(r,s,t.deniedCommands||[]);return a==="auto_approve"?{decision:"approve"}:a==="auto_deny"?{decision:"deny"}:{decision:"ask"}}'

count = text.count(old)
if count != 1:
    raise SystemExit(f'expected exactly 1 auto approval entry pattern, found {count}')

text = text.replace(old, new, 1)
path.write_text(text)

updated = path.read_text()
marker = 'some(a=>a.trim()==="*")'
print('patched_command_wildcard_auto_approval', new in updated)
print('old_pattern_absent', old not in updated)
print('wildcard_gate_marker_count', updated.count(marker))
