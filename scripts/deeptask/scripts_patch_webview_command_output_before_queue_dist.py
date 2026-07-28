from pathlib import Path

webview_path = Path('src/webview-ui/build/assets/index.js')
webview = webview_path.read_text()

old = 'if(fe=fe.trim(),fe||re.length>0){if(H||At||j.length>0){try{console.log("queueMessage",fe,re),J.postMessage({type:"queueMessage",text:fe,images:re}),z(""),Q([])}catch(we){console.error(`Failed to queue message: ${we instanceof Error?we.message:String(we)}`)}return}if(Ee.current=!0,A.current.length===0)J.postMessage({type:"newTask",text:fe,images:re});else if(ot.current)switch(ot.current==="followup"&&is(),ot.current){case"command_output":J.postMessage({type:"terminalOperation",terminalOperation:"continue",terminalOperationText:fe,terminalOperationImages:re});break;case"followup":case"tool":case"browser_action_launch":case"command":case"use_mcp_server":case"completion_result":case"resume_task":case"resume_completed_task":case"mistake_limit_reached":J.postMessage({type:"askResponse",askResponse:"messageResponse",text:fe,images:re});break}else J.postMessage({type:"askResponse",askResponse:"messageResponse",text:fe,images:re});ns()}'
new = 'if(fe=fe.trim(),fe||re.length>0){let we=A.current.at(-1),Xe=ot.current==="command_output"||we?.ask==="command_output"||we?.say==="command_output";if(Xe){Ee.current=!0,J.postMessage({type:"terminalOperation",terminalOperation:"continue",terminalOperationText:fe,terminalOperationImages:re}),ns();return}if(H||At||j.length>0){try{console.log("queueMessage",fe,re),J.postMessage({type:"queueMessage",text:fe,images:re}),z(""),Q([])}catch(Ze){console.error(`Failed to queue message: ${Ze instanceof Error?Ze.message:String(Ze)}`)}return}if(Ee.current=!0,A.current.length===0)J.postMessage({type:"newTask",text:fe,images:re});else if(ot.current)switch(ot.current==="followup"&&is(),ot.current){case"command_output":J.postMessage({type:"terminalOperation",terminalOperation:"continue",terminalOperationText:fe,terminalOperationImages:re});break;case"followup":case"tool":case"browser_action_launch":case"command":case"use_mcp_server":case"completion_result":case"resume_task":case"resume_completed_task":case"mistake_limit_reached":J.postMessage({type:"askResponse",askResponse:"messageResponse",text:fe,images:re});break}else J.postMessage({type:"askResponse",askResponse:"messageResponse",text:fe,images:re});ns()}'

old_ask_only = 'if(fe=fe.trim(),fe||re.length>0){let we=A.current.at(-1),Xe=ot.current==="command_output"||we?.ask==="command_output";if(Xe){Ee.current=!0,J.postMessage({type:"terminalOperation",terminalOperation:"continue",terminalOperationText:fe,terminalOperationImages:re}),ns();return}if(H||At||j.length>0){try{console.log("queueMessage",fe,re),J.postMessage({type:"queueMessage",text:fe,images:re}),z(""),Q([])}catch(Ze){console.error(`Failed to queue message: ${Ze instanceof Error?Ze.message:String(Ze)}`)}return}if(Ee.current=!0,A.current.length===0)J.postMessage({type:"newTask",text:fe,images:re});else if(ot.current)switch(ot.current==="followup"&&is(),ot.current){case"command_output":J.postMessage({type:"terminalOperation",terminalOperation:"continue",terminalOperationText:fe,terminalOperationImages:re});break;case"followup":case"tool":case"browser_action_launch":case"command":case"use_mcp_server":case"completion_result":case"resume_task":case"resume_completed_task":case"mistake_limit_reached":J.postMessage({type:"askResponse",askResponse:"messageResponse",text:fe,images:re});break}else J.postMessage({type:"askResponse",askResponse:"messageResponse",text:fe,images:re});ns()}'

if old in webview:
    webview = webview.replace(old, new, 1)
elif old_ask_only in webview:
    webview = webview.replace(old_ask_only, new, 1)
elif new not in webview:
    raise SystemExit('webview pre-queue command_output patch pattern not found')

webview_path.write_text(webview)
updated = webview_path.read_text()
checks = {
    'pre_queue_latest_message_check': 'we=A.current.at(-1),Xe=ot.current==="command_output"||we?.ask==="command_output"||we?.say==="command_output"' in updated,
    'pre_queue_terminal_payload': 'if(Xe){Ee.current=!0,J.postMessage({type:"terminalOperation",terminalOperation:"continue",terminalOperationText:fe,terminalOperationImages:re}),ns();return}' in updated,
    'queue_still_present': 'J.postMessage({type:"queueMessage",text:fe,images:re})' in updated,
}
for key, value in checks.items():
    print(key, value)
if not all(checks.values()):
    raise SystemExit(1)
