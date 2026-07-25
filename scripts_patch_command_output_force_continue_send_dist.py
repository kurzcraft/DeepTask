from pathlib import Path

extension_path = Path('src/dist/extension.js')
webview_path = Path('src/webview-ui/build/assets/index.js')

extension = extension_path.read_text()
webview = webview_path.read_text()

# Patch extension-side terminal operation: optional text/images are queued as next user message,
# while current command_output ask is immediately answered and terminal continues.
old_ext = 'async handleTerminalOperation(e){e==="continue"?(this.handleWebviewAskResponse("messageResponse"),this.terminalProcess?.continue()):e==="abort"&&(this.handleWebviewAskResponse("noButtonClicked"),this.terminalProcess?.abort())}'
new_ext = 'async handleTerminalOperation(e,r,n){e==="continue"?(((r?.trim()?.length??0)>0||(n?.length??0)>0)&&this.messageQueueService.addMessage(r??"",n),this.handleWebviewAskResponse("messageResponse"),this.terminalProcess?.continue()):e==="abort"&&(this.handleWebviewAskResponse("noButtonClicked"),this.terminalProcess?.abort())}'
if old_ext in extension:
    extension = extension.replace(old_ext, new_ext, 1)
elif new_ext not in extension:
    raise SystemExit('extension terminal operation patch pattern not found')

# Patch webview-side send path: command_output text sends terminalOperation continue with payload,
# instead of askResponse messageResponse.
old_web = 'case"followup":case"tool":case"browser_action_launch":case"command":case"command_output":case"use_mcp_server":case"completion_result":case"resume_task":case"resume_completed_task":case"mistake_limit_reached":J.postMessage({type:"askResponse",askResponse:"messageResponse",text:fe,images:re});break'
new_web = 'case"command_output":J.postMessage({type:"terminalOperation",terminalOperation:"continue",terminalOperationText:fe,terminalOperationImages:re});break;case"followup":case"tool":case"browser_action_launch":case"command":case"use_mcp_server":case"completion_result":case"resume_task":case"resume_completed_task":case"mistake_limit_reached":J.postMessage({type:"askResponse",askResponse:"messageResponse",text:fe,images:re});break'
if old_web in webview:
    webview = webview.replace(old_web, new_web, 1)
elif new_web not in webview:
    raise SystemExit('webview command_output send patch pattern not found')

extension_path.write_text(extension)
webview_path.write_text(webview)

updated_extension = extension_path.read_text()
updated_webview = webview_path.read_text()
checks = {
    'extension_queue_payload': 'this.messageQueueService.addMessage(r??"",n)' in updated_extension,
    'extension_old_absent': old_ext not in updated_extension,
    'webview_terminal_payload': 'terminalOperationText:fe,terminalOperationImages:re' in updated_webview,
    'webview_old_absent': old_web not in updated_webview,
}
for key, value in checks.items():
    print(key, value)
if not all(checks.values()):
    raise SystemExit(1)
