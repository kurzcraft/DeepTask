from pathlib import Path

path = Path('src/dist/extension.js')
text = path.read_text()
changes = []

# 1) Make allow/deny command prefix matching robust to whitespace around entries like " * ".
old_prefix = 'for(let s of e){let o=s.toLowerCase();(o==="*"||r.startsWith(o))&&(!n||o.length>n.length)&&(n=o)}return n}'
new_prefix = 'for(let s of e){let o=s.trim().toLowerCase();if(!o)continue;(o==="*"||r.startsWith(o))&&(!n||o.length>n.length)&&(n=o)}return n}'
count = text.count(old_prefix)
if count == 1:
    text = text.replace(old_prefix, new_prefix, 1)
    changes.append('prefix_trim')
elif new_prefix in text:
    changes.append('prefix_trim_already_present')
else:
    raise SystemExit(f'prefix matcher pattern not found, count={count}')

# 2) Make command_output Continue/Abort answer the pending ask as well as controlling the terminal.
old_terminal_op = 'async handleTerminalOperation(e){e==="continue"?this.terminalProcess?.continue():e==="abort"&&this.terminalProcess?.abort()}'
new_terminal_op = 'async handleTerminalOperation(e){e==="continue"?(this.handleWebviewAskResponse("messageResponse"),this.terminalProcess?.continue()):e==="abort"&&(this.handleWebviewAskResponse("noButtonClicked"),this.terminalProcess?.abort())}'
count = text.count(old_terminal_op)
if count == 1:
    text = text.replace(old_terminal_op, new_terminal_op, 1)
    changes.append('terminal_operation_ask_response')
elif new_terminal_op in text:
    changes.append('terminal_operation_ask_response_already_present')
else:
    raise SystemExit(f'terminal operation pattern not found, count={count}')

path.write_text(text)
updated = path.read_text()
checks = {
    'prefix_trim_marker': new_prefix in updated,
    'terminal_operation_marker': new_terminal_op in updated,
    'old_prefix_absent': old_prefix not in updated,
    'old_terminal_op_absent': old_terminal_op not in updated,
}
print('changes', ','.join(changes))
for key, value in checks.items():
    print(key, value)
if not all(checks.values()):
    raise SystemExit(1)
