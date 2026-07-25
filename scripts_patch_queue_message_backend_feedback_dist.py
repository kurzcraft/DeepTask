from pathlib import Path

path = Path('src/dist/extension.js')
text = path.read_text()
old = 'case"queueMessage":{let q=await a({text:e.text,images:e.images});t.getCurrentTask()?.messageQueueService.addMessage(q.text,q.images);break}'
new = 'case"queueMessage":{let q=await a({text:e.text,images:e.images}),re=t.getCurrentTask();re&&(re.messageQueueService.clear(),await re.say("user_feedback",q.text,q.images),re.handleWebviewAskResponse("messageResponse",q.text,q.images));break}'
if old not in text:
    raise SystemExit('queueMessage dist pattern not found')
text = text.replace(old, new, 1)
path.write_text(text)
print('patched_queue_message_backend_feedback_dist', True)
print('addMessage_remaining', '.messageQueueService.addMessage' in text)
print('clear_present', '.messageQueueService.clear()' in text)
