from pathlib import Path

extension_path = Path('src/dist/extension.js')
extension = extension_path.read_text()

old_ext = 'async handleTerminalOperation(e,r,n){if(e==="continue"){let s=(r?.trim()?.length??0)>0||(n?.length??0)>0;this.handleWebviewAskResponse("messageResponse"),this.terminalProcess?.continue(),s&&setTimeout(()=>{this.submitUserMessage(r??"",n).catch(o=>console.error("[Task#handleTerminalOperation] Failed to submit terminal continuation message:",o))},0)}else e==="abort"&&(this.handleWebviewAskResponse("noButtonClicked"),this.terminalProcess?.abort())}'
new_ext = 'async handleTerminalOperation(e,r,n){e==="continue"?(this.handleWebviewAskResponse("messageResponse",r,n),this.terminalProcess?.continue()):e==="abort"&&(this.handleWebviewAskResponse("noButtonClicked"),this.terminalProcess?.abort())}'

if old_ext in extension:
    extension = extension.replace(old_ext, new_ext, 1)
elif new_ext not in extension:
    raise SystemExit('extension visible feedback terminal operation patch pattern not found')

extension_path.write_text(extension)

updated = extension_path.read_text()
checks = {
    'visible_feedback_present': 'this.handleWebviewAskResponse("messageResponse",r,n),this.terminalProcess?.continue()' in updated,
    'direct_submit_absent': 'this.submitUserMessage(r??"",n).catch' not in updated,
}
for key, value in checks.items():
    print(key, value)
if not all(checks.values()):
    raise SystemExit(1)
