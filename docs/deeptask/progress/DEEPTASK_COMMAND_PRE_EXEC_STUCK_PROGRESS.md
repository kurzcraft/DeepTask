# DeepTask 命令执行前卡住修复进度

## 检查清单

- [x] 查询 universe-memory 相关记忆
- [x] 读取历史命令卡住/发布进度文件
- [x] 定位“命令卡在执行前”的共性根因
- [x] 实现修复并补测试
- [x] 运行聚焦回归测试
- [x] 打包 VSIX 并重装到 VSCodium
- [x] 验证用户给出的命令链路
- [ ] 存储任务经验

## 用户给出的复现命令

```bash
git status --short && git rev-parse --short HEAD && git log --oneline -5 && git ls-remote origin refs/heads/main && node -e "fetch('https://api.github.com/repos/kurzgesagtcraft/deeptask/releases/tags/v5.5.0').then(r=>r.json()).then(j=>{const a=(j.assets||[]).find(x=>x.name==='deeptask-5.5.0.vsix'); console.log(JSON.stringify({tag:j.tag_name, target:j.target_commitish, html_url:j.html_url, asset:a&&{name:a.name,size:a.size,url:a.browser_download_url,updated_at:a.updated_at}}, null, 2))})"
```

## 当前判断

- 之前已修复多类“执行后不继续”、heredoc 快速完成、终端剪枝和 resend 队列问题。
- 本次现象是“卡在执行前，不会自动执行”，优先检查命令解析、自动审批、ask/approval 状态和前端按钮路径。
- 该命令是 `&&` 链，末尾 `node -e` 双引号内包含 `=>`、对象字面量、`&&` 短路和 URL；高风险点是解析器把双引号内 JavaScript 错误拆成顶层命令，导致 wildcard 自动审批之外仍落入手动确认或状态卡住。
- 实测解析层能正确拆成 5 个顶层子命令，所有子命令在 `allowedCommands=["*"]` 下均为 `auto_approve`。
- 真正根因是 `containsDangerousSubstitution()` 的 zsh `=(...)` 规则在全命令文本上扫描，误把 `node -e` 双引号参数中的 JavaScript `.then(j=>{const a=(j.assets||[])...` 识别为 zsh 进程替换，因此最终 `getCommandDecision()` 返回 `ask_user`，造成命令执行前不能自动通过。

## 已实现

- `src/core/auto-approval/commands.ts`：安全扫描分成两类输入。
    - 参数展开类规则只遮蔽单引号，因为双引号内 `${...}` 仍会被 shell 解释。
    - shell 结构语法类规则遮蔽单/双引号内容，避免把 `node -e`、`python -c`、`perl -e` 等语言代码文本当 shell 顶层语法。
- `src/core/auto-approval/__tests__/commands.spec.ts`：新增用户命令回归、双引号危险参数展开仍拦截、未加引号 zsh 进程替换仍拦截。

## 验证状态

- 通过：`cd src && pnpm test core/auto-approval/__tests__/commands.spec.ts`，1 个文件、12 个测试通过。
- 通过：直接调用修复后的 `getCommandDecision()` 验证用户完整命令，结果 `{ dangerous: false, decision: "auto_approve" }`。
- 通过：用户命令中的 git 部分可执行，当前本地 HEAD 为 `ce7f75c8`，远端 `origin/main` 为 `ce7f75c8d90179ec6d6592b31f760566655ccf1e`。
- 通过：`bash scripts_package_deeptask_vsix.sh` 生成并验证 `deeptask-5.5.0.vsix`，大小 42,402,575 bytes。
- 通过：`codium --install-extension /media/kurz/aleber/vscode/deeptask/deeptask-5.5.0.vsix --force` 安装成功，扩展列表显示 `deeptask.deeptask@5.5.0`。

## 后续发布

- 待提交并推送本次修复。
- 待运行 `node scripts_publish_github_release.mjs` 更新 `v5.5.0` Release 资产。
