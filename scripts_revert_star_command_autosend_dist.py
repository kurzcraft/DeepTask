from pathlib import Path
path = Path('src/dist/extension.js')
text = path.read_text()
replacements = [
    (
        'if(r==="addToContext"){await o.postMessageToWebview({type:"invoke",invoke:"sendMessage",text:`${l}\n\n`});return}',
        'if(r==="addToContext"){await o.postMessageToWebview({type:"invoke",invoke:"setChatBoxMessage",text:`${l}\n\n`}),await o.postMessageToWebview({type:"action",action:"focusInput"});return}',
    ),
    (
        'if(r==="terminalAddToContext"){await o.postMessageToWebview({type:"invoke",invoke:"sendMessage",text:`${l}\n\n`});return}',
        'if(r==="terminalAddToContext"){await o.postMessageToWebview({type:"invoke",invoke:"setChatBoxMessage",text:`${l}\n\n`}),await o.postMessageToWebview({type:"action",action:"focusInput"});return}',
    ),
]
changed = 0
for old, new in replacements:
    if old in text:
        text = text.replace(old, new, 1)
        changed += 1
    elif new in text:
        pass
    else:
        raise SystemExit(f'revert pattern not found: {old[:80]}')
path.write_text(text)
verified = path.read_text()
print('reverted_star_autosend_replacements', changed)
print('add_to_context_setChatBoxMessage', 'if(r==="addToContext"){await o.postMessageToWebview({type:"invoke",invoke:"setChatBoxMessage"' in verified)
print('terminal_add_to_context_setChatBoxMessage', 'if(r==="terminalAddToContext"){await o.postMessageToWebview({type:"invoke",invoke:"setChatBoxMessage"' in verified)
