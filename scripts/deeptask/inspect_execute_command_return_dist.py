from pathlib import Path
text = Path('src/dist/extension.js').read_text()
needles = ['The user provided the following feedback:', 'completed||', 'completed||exitDetails', 'if(message)']
for needle in needles:
    idx = text.find(needle)
    print('\n===', needle, idx, '===')
    if idx != -1:
        print(text[max(0, idx - 700):min(len(text), idx + 900)])
