from pathlib import Path
text = Path('src/dist/extension.js').read_text()
out = []
for needle in ['ONLY Generate', 'Format:', '<type>[optional scope]: <description>', 'IMPORTANT RULES']:
    i = text.find(needle)
    out.append(f'--- {needle} {i}')
    if i != -1:
        out.append(repr(text[max(0, i - 180):i + 360]))
Path('commit_prompt_dist_snippets.txt').write_text('\n'.join(out))
