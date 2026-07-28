from pathlib import Path

extension_path = Path('src/dist/extension.js')
extension = extension_path.read_text()

old_terminal = 'async handleTerminalOperation(e,r,n){e==="continue"?(this.handleWebviewAskResponse("messageResponse",r,n),this.terminalProcess?.continue()):e==="abort"&&(this.handleWebviewAskResponse("noButtonClicked"),this.terminalProcess?.abort())}'
new_terminal = 'async handleTerminalOperation(e,r,n){if(e==="continue"){let s=(r?.trim()?.length??0)>0||(n?.length??0)>0;s&&(this.commandOutputFeedbackAlreadyShown=!0,void this.say("user_feedback",r,n)),this.handleWebviewAskResponse("messageResponse",r,n),this.terminalProcess?.continue()}else e==="abort"&&(this.handleWebviewAskResponse("noButtonClicked"),this.terminalProcess?.abort())}'

if old_terminal in extension:
    extension = extension.replace(old_terminal, new_terminal, 1)
elif new_terminal not in extension:
    raise SystemExit('terminal immediate feedback patch pattern not found')

# No class field is needed in JS; undefined is falsy. Add a consume method near supersedePendingAsk.
old_method_anchor = 'supersedePendingAsk(){this.lastMessageTs=Date.now()}updateApiConfiguration(e){'
new_method_anchor = 'supersedePendingAsk(){this.lastMessageTs=Date.now()}consumeCommandOutputFeedbackAlreadyShown(){let e=this.commandOutputFeedbackAlreadyShown;return this.commandOutputFeedbackAlreadyShown=!1,e}updateApiConfiguration(e){'
if old_method_anchor in extension:
    extension = extension.replace(old_method_anchor, new_method_anchor, 1)
elif new_method_anchor not in extension:
    raise SystemExit('consume method patch pattern not found')

old_tool = 'return await t.say("user_feedback",N,E),t.processQueuedMessages(),[!0,bn.toolResult(['
new_tool = 'return t.consumeCommandOutputFeedbackAlreadyShown()||await t.say("user_feedback",N,E),t.processQueuedMessages(),[!0,bn.toolResult(['
if old_tool in extension:
    extension = extension.replace(old_tool, new_tool, 1)
elif new_tool not in extension:
    raise SystemExit('execute command dedupe patch pattern not found')

extension_path.write_text(extension)
updated = extension_path.read_text()
checks = {
    'immediate_feedback_present': 'void this.say("user_feedback",r,n)' in updated,
    'consume_method_present': 'consumeCommandOutputFeedbackAlreadyShown(){let e=this.commandOutputFeedbackAlreadyShown;' in updated,
    'tool_dedupe_present': 't.consumeCommandOutputFeedbackAlreadyShown()||await t.say("user_feedback",N,E)' in updated,
}
for key, value in checks.items():
    print(key, value)
if not all(checks.values()):
    raise SystemExit(1)
