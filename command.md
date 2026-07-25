发现两个问题，小问题是在其他目录打开插件需要在设置界面按一下保存终端保留限制才会生效，大问题是以下命令根本不会自动执行变成手动的按钮状态
bash -lc 'set -euo pipefail
backup="任务记录/vscode-deeptask-globalStorage-before-api-history-fix-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$backup" -C /home/kurz/.config/Code/User/globalStorage deeptask.deeptask
missing_before=$(find /home/kurz/.config/Code/User/globalStorage/deeptask.deeptask/tasks -mindepth 1 -maxdepth 1 -type d ! -exec test -f "{}/api_conversation_history.json" \; -print | wc -l)
find /home/kurz/.config/Code/User/globalStorage/deeptask.deeptask/tasks -mindepth 1 -maxdepth 1 -type d | while read -r taskDir; do
  if [ ! -f "$taskDir/api_conversation_history.json" ]; then
    printf "[]\n" > "$taskDir/api_conversation_history.json"
  fi
  if [ ! -f "$taskDir/task_metadata.json" ]; then
    taskId=$(basename "$taskDir")
    firstText=$(node -e "const fs=require('fs'); const p=process.argv[1]; let title='Restored task'; try { const m=JSON.parse(fs.readFileSync(p,'utf8')); const hit=(Array.isArray(m)?m:[]).find(x=>x && typeof x.text==='string' && x.text.trim()); if(hit) title=hit.text.trim().slice(0,120); } catch {} console.log(JSON.stringify({id: process.argv[2], task: title, ts: Date.now(), tokensIn:0, tokensOut:0, totalCost:0}, null, 2));" "$taskDir/ui_messages.json" "$taskId")
    printf "%s\n" "$firstText" > "$taskDir/task_metadata.json"
  fi
done
missing_after=$(find /home/kurz/.config/Code/User/globalStorage/deeptask.deeptask/tasks -mindepth 1 -maxdepth 1 -type d ! -exec test -f "{}/api_conversation_history.json" \; -print | wc -l)
summary="任务记录/vscode-deeptask-api-history-fix-$(date +%Y%m%d-%H%M%S).txt"
{
  echo "backup=$backup"
  echo "missing_api_history_before=$missing_before"
  echo "missing_api_history_after=$missing_after"
  find /home/kurz/.config/Code/User/globalStorage/deeptask.deeptask/tasks -mindepth 1 -maxdepth 2 -type f -printf "%TY-%Tm-%Td %TH:%TM %s %p\n" | sort
} > "$summary"
printf "%s\n%s\n" "$backup" "$summary"'