from pathlib import Path
paths = [Path('src/webview-ui/build/assets/index.js'), Path('/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0/webview-ui/build/assets/index.js')]
for p in paths:
    s=p.read_text(errors='ignore')
    print('FILE', p, 'size', p.stat().st_size)
    for needle in ['queueMessage', 'terminalOperationText:fe', 'ot.current){case"command_output"']:
        idx=s.find(needle)
        print('NEEDLE', needle, 'IDX', idx)
        if idx!=-1:
            print(s[max(0,idx-360):idx+520])
            print('---')
