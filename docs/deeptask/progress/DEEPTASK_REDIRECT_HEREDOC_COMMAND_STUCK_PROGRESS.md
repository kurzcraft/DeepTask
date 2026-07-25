# DeepTask 重定向 heredoc 命令完成后卡住修复进度

## 检查清单

- [x] 查询相关记忆
- [x] 创建本次问题进度清单
- [x] 定位重定向 heredoc 命令完成后未继续的触发路径
- [x] 补充回归测试
- [x] 实现修复
- [x] 运行相关测试
- [x] 打包安装并发布 VSIX
- [x] 存储经验

## 问题命令

用户反馈以下命令执行完会卡住：

```bash
out=任务记录/vscode-deeptask-half-task-and-switches-20260706-043100.txt; { echo '# Half task and switches'; date -Is; echo; echo '## half task ui_messages'; sed -n '1,120p' /home/kurz/.config/Code/User/globalStorage/deeptask.deeptask/tasks/019f33e4-8888-725d-9660-6e50c1eebe47/ui_messages.json 2>/dev/null || true; echo; echo '## selected switches'; python3 - <<'PY'
import json, sqlite3
conn=sqlite3.connect('/home/kurz/.config/Code/User/globalStorage/state.vscdb')
row=conn.execute('select value from ItemTable where key=?',('deeptask.deeptask',)).fetchone(); conn.close()
st=json.loads(row[0])
keys=['taskProgressFileEnabled','todoListEnabled','includeTaskHistoryInEnhance','autoCondenseContext','enableCheckpoints','checkpointTimeout','mcpEnabled','browserToolEnabled','mode','modeApiConfigs','currentApiConfigName','enhancementApiConfigId','condensingApiConfigId','terminalCommandApiConfigId','openAiR1FormatEnabled','openAiStreamingEnabled','toolProtocol','maxWorkspaceFiles','maxOpenTabsContext']
for k in keys:
 print(k+'='+json.dumps(st.get(k,'<missing>'),ensure_ascii=False))
PY
} > "$out"; printf '%s\n' "$out"
```

## 新增同类问题命令

用户随后反馈另一条命令也会卡住：

```bash
out=任务记录/vscode-deeptask-after-history-enhance-fix-check-$(date +%Y%m%d-%H%M%S).txt; { echo '# VSCode Deeptask after history enhance fix check'; date -Is; echo; echo '## Fix report'; sed -n '1,120p' 任务记录/vscode-deeptask-half-task-history-enhance-fix-20260706-044322.txt; echo; echo '## State summary'; bash 脚本集合/解析VSCode-Deeptask状态-20260706.sh; echo; echo '## includeTaskHistoryInEnhance'; python3 - <<'PY'
import json, sqlite3
conn=sqlite3.connect('/home/kurz/.config/Code/User/globalStorage/state.vscdb')
row=conn.execute('select value from ItemTable where key=?',('deeptask.deeptask',)).fetchone(); conn.close()
st=json.loads(row[0])
print(st.get('includeTaskHistoryInEnhance'))
print('taskHistory.length', len(st.get('taskHistory', [])))
PY
echo; echo '## Task dirs with file counts'; find /home/kurz/.config/Code/User/globalStorage/deeptask.deeptask/tasks -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | while read -r id; do printf '%s ' "$id"; find "/home/kurz/.config/Code/User/globalStorage/deeptask.deeptask/tasks/$id" -maxdepth 1 -type f -printf '%f ' 2>/dev/null; printf '\n'; done | sort; } > "$out"; printf '%s\n' "$out"
```

## 初始假设

- 命令本身是有限命令，bash 正常执行应结束。
- 形态包含 brace group 输出重定向、heredoc、Python 读取 SQLite、内部 shell 脚本/循环、最后 `printf` 单行输出。
- 可能仍是 `TerminalProcess` 事件顺序或输出尾部处理导致完成信号没有继续传递。
- 两条样例共同特征是复杂重定向命令只在最后向终端输出少量文本，因此如果 VS Code start 事件未把 stream 转发到当前 process，就会表现为执行完但 DeepTask 仍等待。

## 新增按钮消失卡死命令

用户随后反馈点击运行后按钮没了但任务卡死：

```bash
{ echo '# model cache fix verify'; date -Is; echo '## report'; sed -n '1,120p' 任务记录/vscode-deeptask-model-cache-fix-20260706-050903.txt; echo '## cache'; find /home/kurz/.config/Code/User/globalStorage/deeptask.deeptask/cache -maxdepth 1 -type f -printf '%f %s\n' 2>/dev/null | sort; echo '## state'; python3 - <<'PY'
import json, sqlite3, os
conn=sqlite3.connect('/home/kurz/.config/Code/User/globalStorage/state.vscdb')
row=conn.execute('select value from ItemTable where key=?',('deeptask.deeptask',)).fetchone(); conn.close()
st=json.loads(row[0]); print('includeTaskHistoryInEnhance=',st.get('includeTaskHistoryInEnhance')); print('taskHistory.length=',len(st.get('taskHistory',[])))
base='/home/kurz/.config/Code/User/globalStorage/deeptask.deeptask/tasks'
for item in st.get('taskHistory',[]):
 tid=item.get('id'); files=set(os.listdir(os.path.join(base,tid))) if tid and os.path.isdir(os.path.join(base,tid)) else set(); print(tid, sorted(['ui_messages.json','api_conversation_history.json','task_metadata.json']-files))
PY
} > 任务记录/vscode-deeptask-model-cache-fix-verify-20260706-050920.txt; printf '%s\n' '任务记录/vscode-deeptask-model-cache-fix-verify-20260706-050920.txt'
```

## 当前修正

- 新增模型推理取消窗口修正：推理中点击取消后立即发送的 `messageResponse` 不再作为 stale ask 清理，而是缓存到 provider，等待 `cancelTask()` 重建历史任务后调用 `continueTaskFromUserMessage()` 回放。
- 新增终端运行中取消兜底：`handleTerminalOperation("abort")` 保留取消时输入反馈，并同时调用 `abort()` 与 `continue()`，避免终端 abort 事件不返回时工具 promise 卡住。
- 第一层：`TerminalProcess.run()` 在 `executeCommand()` 返回 execution 后，若外部 shell start 事件没有及时转发 stream，则使用 `execution.read()` 作为后备 stream。
- 第二层：`executeCommandInTerminal()` 不再只等待底层 process promise；只要 `onShellExecutionComplete` 已收到，就启动短延迟兜底并继续生成最终工具结果，覆盖多种有限命令形态中“shell 已退出但 process promise 未 resolve”的卡住。
- 本地验证用户第二条命令时，命令失败原因是输入文件 `任务记录/vscode-deeptask-half-task-history-enhance-fix-20260706-044322.txt` 不存在，`sed` 返回 2；这说明该命令本身会失败，但修复目标是失败也必须及时返回而不是无限等待。

## 验证记录

- `cd src && pnpm test core/webview/__tests__/webviewMessageHandler.spec.ts core/tools/__tests__/executeCommandTool.spec.ts` 通过，2 个测试文件，40 个用例。
- `cd src && pnpm test integrations/terminal/__tests__/TerminalProcess.spec.ts` 通过，1 个测试文件，17 个用例。
- `cd src && pnpm test integrations/terminal/__tests__/TerminalProcess.spec.ts core/tools/__tests__/executeCommandTool.spec.ts` 通过，2 个测试文件，32 个用例。
- `bash scripts_package_deeptask_vsix.sh` 通过，生成并验证 `deeptask-5.5.0.vsix`，大小 42,397,474 bytes。
- `codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force` 安装成功；扩展列表确认 `deeptask.deeptask@5.5.0`。
- `node scripts_publish_github_release.mjs` 发布成功，Release `v5.5.0` 资产 `deeptask-5.5.0.vsix` 大小 42,397,474 bytes。
