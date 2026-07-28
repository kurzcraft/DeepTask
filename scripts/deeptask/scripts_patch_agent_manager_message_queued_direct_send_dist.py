from pathlib import Path

path = Path("src/dist/extension.js")
text = path.read_text()
old = 'case"agentManager.messageQueued":this.handleQueuedMessage(e.sessionId,e.messageId,e.content,e.sessionLabel,e.images);break;case"agentManager.resumeSession":'
new = 'case"agentManager.messageQueued":this.sendMessage(e.sessionId,e.content,e.sessionLabel,e.images);break;case"agentManager.resumeSession":'
if old not in text:
    raise SystemExit("target snippet not found")
text = text.replace(old, new, 1)
path.write_text(text)
print("patched agentManager.messageQueued to direct send in src/dist/extension.js")
