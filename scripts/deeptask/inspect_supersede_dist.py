from pathlib import Path
text = Path('src/dist/extension.js').read_text()
for needle in ['supersedePendingAsk(){', 'updateApiConfiguration(e)', 'handleTerminalOperation(e,r,n)']:
    idx = text.find(needle)
    print('NEEDLE', needle, 'IDX', idx)
    if idx != -1:
        print(text[max(0, idx-180):idx+360])
        print('---')
