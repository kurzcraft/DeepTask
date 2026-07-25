from pathlib import Path

path = Path("src/dist/extension.js")
text = path.read_text()
replacements = {
    'static viewType="kilo-code.AgentManagerPanel"': 'static viewType="deeptask.AgentManagerPanel"',
    'case"agentManager.messageQueued":this.handleQueuedMessage(e.sessionId,e.messageId,e.content,e.sessionLabel,e.images);break;case"agentManager.resumeSession":': 'case"agentManager.messageQueued":this.sendMessage(e.sessionId,e.content,e.sessionLabel,e.images);break;case"agentManager.resumeSession":',
}
changed = []
for old, new in replacements.items():
    if old in text:
        text = text.replace(old, new, 1)
        changed.append(old)
    elif new in text:
        changed.append(f"already:{new}")
    else:
        raise SystemExit(f"target snippet not found: {old}")
path.write_text(text)
print("patched dist namespace/message queue:", len(changed))
for item in changed:
    print(item[:120])
