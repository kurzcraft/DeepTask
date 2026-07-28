from pathlib import Path

path = Path('src/dist/extension.js')
text = path.read_text()
old = 'let e=[Zqe.commands.registerCommand("kilo-code.vsc.generateCommitMessage",r=>this.handleVSCodeCommand(r)),Zqe.commands.registerCommand("kilo-code.jetbrains.generateCommitMessage",(...r)=>this.handleJetBrainsCommand(...r))];'
new = 'let e=[Zqe.commands.registerCommand("deeptask.vsc.generateCommitMessage",r=>this.handleVSCodeCommand(r)),Zqe.commands.registerCommand("kilo-code.vsc.generateCommitMessage",r=>this.handleVSCodeCommand(r)),Zqe.commands.registerCommand("kilo-code.jetbrains.generateCommitMessage",(...r)=>this.handleJetBrainsCommand(...r))];'
if old not in text and new not in text:
    raise SystemExit('target commit command registration pattern not found')
if old in text:
    text = text.replace(old, new, 1)
    path.write_text(text)
print('deeptask_commit_command_registered', new in path.read_text())
