from pathlib import Path
from zipfile import ZipFile

vsix = Path('deeptask-5.5.0.vsix')
print('vsix_exists', vsix.exists())
print('vsix_size', vsix.stat().st_size if vsix.exists() else 0)
if not vsix.exists():
    raise SystemExit(1)

with ZipFile(vsix) as z:
    extension = z.read('extension/dist/extension.js').decode()
    webview = z.read('extension/webview-ui/build/assets/index.js').decode()
    agent_manager = z.read('extension/webview-ui/build/assets/agent-manager.js').decode()

checks = {
    'extension_immediate_user_feedback': 'void this.say("user_feedback",r,n)' in extension,
    'extension_passes_payload_to_current_ask': 'this.handleWebviewAskResponse("messageResponse",r,n),this.terminalProcess?.continue()' in extension,
    'extension_no_terminal_payload_queue': 'this.messageQueueService.addMessage(r??"",n)' not in extension,
    'extension_no_terminal_direct_resend': 'this.submitUserMessage(r??"",n).catch' not in extension,
    'extension_user_feedback_dedupe': 't.consumeCommandOutputFeedbackAlreadyShown()||await t.say("user_feedback",N,E)' in extension,
    'extension_queue_message_backend_feedback_fallback': 'case"queueMessage"' in extension and '.messageQueueService.clear()' in extension and '.say("user_feedback"' in extension and '.handleWebviewAskResponse("messageResponse"' in extension,
    'extension_queue_message_no_add_message': '.messageQueueService.addMessage' not in extension,
    'webview_command_output_sends_terminal_payload': 'terminalOperationText:' in webview and 'terminalOperationImages:' in webview,
    'webview_command_output_checked_before_queue': (
        'current==="command_output"' in webview
        and 'ask)==="command_output"' in webview
        and 'say)==="command_output"' in webview
    ),
    'webview_optimistic_user_feedback': 'say:"user_feedback"' in webview and 'Date.now()' in webview,
    'webview_active_command_status_tracking': 'commandExecutionStatus' in webview and '.size>0' in webview,
    'webview_busy_branch_inserts_feedback': 'Failed to send busy feedback' in webview and 'askResponse:"messageResponse"' in webview and webview.count('say:"user_feedback"') >= 2,
    'webview_no_busy_branch_queue_log': 'console.log("queueMessage"' not in webview,
    'webview_primary_button_command_output_optimistic_feedback': webview.count('say:"user_feedback"') >= 3,
    'webview_pending_feedback_visible_panel': 'image(s)' in webview and 'whitespace-pre-wrap text-sm' in webview,
    'webview_recent_feedback_sticky_panel': ('8000' in webview or '8e3' in webview) and 'setTimeout' in webview and 'clearTimeout' in webview,
    'webview_auto_drains_visible_queue': 'removeQueuedMessage' in webview and 'askResponse:"messageResponse"' in webview and 'user_feedback' in webview,
    'webview_old_command_output_message_response_absent': 'case"command_output":case"use_mcp_server":case"completion_result":case"resume_task":case"resume_completed_task":case"mistake_limit_reached"' not in webview,
    'agent_manager_direct_send_message': 'agentManager.sendMessage' in agent_manager,
    'agent_manager_no_message_queued_send': 'agentManager.messageQueued' not in agent_manager,
    'agent_manager_optimistic_user_feedback': 'agentManagerOptimisticUserFeedback' in agent_manager and 'user_feedback' in agent_manager,
    'bin_vsix_exists': Path('bin/deeptask-5.5.0.vsix').exists(),
}
for key, value in checks.items():
    print(key, value)
failed = [key for key, value in checks.items() if not value]
if failed:
    print('failed_checks', ', '.join(failed))
    raise SystemExit(1)
print('all_checks_passed', True)
