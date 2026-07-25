# DeepTask 任务进度文件默认创建与管道命令继续问题进度

## 检查清单

- [x] 查询相关记忆
- [x] 创建本次问题进度清单
- [x] 定位任务进度文件默认勾选但不创建的设置与创建路径
- [x] 定位管道 heredoc 命令执行完不继续的终端完成路径
- [x] 实现修复并补回归测试
- [x] 运行相关测试
- [-] 更新提交/发布状态
- [ ] 存储经验

## 问题

1. 默认勾选了创建任务进度文件，但新任务不会创建进度文件。
2. 以下管道 heredoc 命令执行完毕后没有继续：

```bash
sqlite3 /home/kurz/.config/Code/User/globalStorage/state.vscdb "select value from ItemTable where key='deeptask.deeptask';" | node - <<'NODE'
let input='';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const state = JSON.parse(input || '{}');
  console.log('keys=' + Object.keys(state).sort().join(','));
  const hist = Array.isArray(state.taskHistory) ? state.taskHistory : [];
  console.log('taskHistory.length=' + hist.length);
  for (const item of hist) {
    console.log(JSON.stringify({id:item.id, ts:item.ts, task:String(item.task||'').slice(0,80), workspace:item.workspace}));
  }
  console.log('currentApiConfigName=' + state.currentApiConfigName);
  console.log('mode=' + state.mode);
});
NODE
```

## 当前观察

- 相关记忆搜索未命中同主题记录。
- 任务进度文件设置存在默认值矛盾：Prompts 设置页按 `taskProgressFileEnabled ?? true` 显示默认勾选，但 `ClineProvider` 状态下发、保存设置和 `defaultGlobalSettings` 多处使用 `false`，导致 UI 勾选与实际提示词状态不一致。
- 命令输出继续测试已有 heredoc 写文件和 pending command_output ask 自动清理覆盖，但没有覆盖 `sqlite3 ... | node - <<'NODE'` 这类“管道 + heredoc 作为 stdin”的复杂命令。
- 需要继续确认 VS Code shell integration 对管道 heredoc 命令的流关闭/结束事件路径，避免命令实际结束后 task 仍等不到 continue。
- 已修复：`taskProgressFileEnabled` 默认值在全局默认、后端状态下发、设置保存 payload 和 Checkpoint 设置页显示中统一为 `true`。
- 已修复：`TerminalProcess.run()` 在 shell 完成事件早于 `stream_available` 时立即发出 `completed` 和 `continue`，避免复杂管道 heredoc 命令等到 stream timeout 或卡住。
- 回归测试通过：`cd src && pnpm test integrations/terminal/__tests__/TerminalProcess.spec.ts core/prompts/__tests__/system-prompt.spec.ts core/prompts/sections/__tests__/custom-instructions.spec.ts`，3 files passed，75 tests passed。
- 当前发布请求：打包 VSIX、安装到 VSCodium、提交推送 GitHub 并更新 `v5.5.0` release。
- 打包通过：`bash scripts_package_deeptask_vsix.sh` 生成并验证 `deeptask-5.5.0.vsix`，大小 42,396,578 bytes。
- VSCodium 安装通过：`codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force`；扩展列表确认 `deeptask.deeptask@5.5.0`。
- GitHub 提交并推送：`49f109d`，`main -> main`。
- GitHub Release 已更新：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
- Release 资产：`deeptask-5.5.0.vsix`，大小 42,396,578 bytes，下载地址 `https://github.com/kurzgesagtcraft/deeptask/releases/download/v5.5.0/deeptask-5.5.0.vsix`。
