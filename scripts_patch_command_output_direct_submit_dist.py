from pathlib import Path

extension_path = Path('src/dist/extension.js')
extension = extension_path.read_text()

old_ext = 'async handleTerminalOperation(e,r,n){e==="continue"?(((r?.trim()?.length??0)>0||(n?.length??0)>0)&&this.messageQueueService.addMessage(r??"",n),this.handleWebviewAskResponse("messageResponse"),this.terminalProcess?.continue()):e==="abort"&&(this.handleWebviewAskResponse("noButtonClicked"),this.terminalProcess?.abort())}'
new_ext = 'async handleTerminalOperation(e,r,n){if(e==="continue"){let s=(r?.trim()?.length??0)>0||(n?.length??0)>0;this.handleWebviewAskResponse("messageResponse"),this.terminalProcess?.continue(),s&&setTimeout(()=>{this.submitUserMessage(r??"",n).catch(o=>console.error("[Task#handleTerminalOperation] Failed to submit terminal continuation message:",o))},0)}else e==="abort"&&(this.handleWebviewAskResponse("noButtonClicked"),this.terminalProcess?.abort())}'

if old_ext in extension:
    extension = extension.replace(old_ext, new_ext, 1)
elif new_ext not in extension:
    raise SystemExit('extension direct submit terminal operation patch pattern not found')

extension_path.write_text(extension)

updated = extension_path.read_text()
checks = {
    'direct_submit_present': 'this.submitUserMessage(r??"",n).catch' in updated,
    'old_queue_path_absent': old_ext not in updated,
}
for key, value in checks.items():
    print(key, value)
if not all(checks.values()):
    raise SystemExit(1)
