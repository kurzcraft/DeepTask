from pathlib import Path
text = Path('src/dist/extension.js').read_text()
out = []
for needle in ['invoke:"setChatBoxMessage"', 'setChatBoxMessage', 'terminalAddToContext', 'addToContext']:
    start = 0
    count = 0
    while True:
        i = text.find(needle, start)
        if i == -1:
            break
        count += 1
        out.append(f'--- {needle} #{count} {i}')
        out.append(text[max(0, i - 220):i + 300])
        start = i + len(needle)
Path('star_command_dist_snippets.txt').write_text('\n'.join(out))
