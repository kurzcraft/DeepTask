from pathlib import Path

text = Path('src/dist/extension.js').read_text()
needles = [
    'async handleTerminalOperation',
    'await t.say("user_feedback",N,E)',
    'processQueuedMessages(),[!0',
]
for needle in needles:
    idx = text.find(needle)
    print('NEEDLE', needle, 'IDX', idx)
    if idx != -1:
        start = max(0, idx - 240)
        end = min(len(text), idx + 420)
        print(text[start:end])
        print('---')
