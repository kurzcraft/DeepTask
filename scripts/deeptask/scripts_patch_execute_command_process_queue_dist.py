from pathlib import Path

path = Path('src/dist/extension.js')
text = path.read_text()

old_feedback = 'if(await Td(50),I){let{text:N,images:E}=I;return await t.say("user_feedback",N,E),[!0,bn.toolResult(['
new_feedback = 'if(await Td(50),I){let{text:N,images:E}=I;return await t.say("user_feedback",N,E),t.processQueuedMessages(),[!0,bn.toolResult(['
if old_feedback in text:
    text = text.replace(old_feedback, new_feedback, 1)
elif new_feedback in text:
    pass
else:
    raise SystemExit('feedback branch pattern not found')

old_completed = '),E)]}else if(c||m){let N="";return m!==void 0?'
new_completed = '),E)]}else if(c||m){t.processQueuedMessages();let N="";return m!==void 0?'
if old_completed in text:
    text = text.replace(old_completed, new_completed, 1)
elif new_completed in text:
    pass
else:
    raise SystemExit('completed branch pattern not found')

path.write_text(text)
updated = path.read_text()
checks = {
    'feedback_process_queue': new_feedback in updated,
    'completed_process_queue': new_completed in updated,
}
for key, value in checks.items():
    print(key, value)
if not all(checks.values()):
    raise SystemExit(1)
