# Deeptask：Windows `cmd.exe` 也必须正确集成

本文给另一台电脑上的插件改造用。目标：**新安装后立刻能跑 `execute_command`，用户不必改 VS Code / VSCodium 设置，也不必把默认终端从 cmd 换成 PowerShell。**

## 1. 现场故障（必须当作默认场景）

Windows 上 VSCodium / VS Code 的默认集成终端经常是：

```text
C:\WINDOWS\System32\cmd.exe
```

Deeptask 9.1.2 执行命令时会新建终端，并在约 **5 秒**内等待 Shell Integration 初始化序列：

```text
OSC 633 ; A ST
即：\x1b]633;A
```

若超时，工具直接失败，连 `echo` 都不跑：

```text
Shell integration initialization sequence '\x1b]633;A' was not received within 5s.
Shell integration has been disabled for this terminal instance.
```

实测：

- `powershell -File ...` 失败
- `echo hello` 失败
- `run_analyze_c_drive.cmd` 失败
- `C:\WINDOWS\system32\cmd.exe /c echo ok` 失败

这不是用户脚本坏了，而是 **插件把 cmd 当成已集成的 shell，但 cmd 根本不会发 `633;A`。**

VSCodium 1.126 自带的集成脚本只有：

- `shellIntegration.ps1`（Windows PowerShell / pwsh）
- `shellIntegration-bash.sh`
- `shellIntegration-*.zsh`
- `shellIntegration.fish`

**没有 `cmd.exe` 的官方集成脚本。** 因此：

- 默认 shell = cmd → 永远等不到 `633;A`
- 用户改 `settings.json` 切到 PowerShell、关掉 `terminal.integrated.shellIntegration.enabled`、关掉持久会话，**都不能保证插件立刻可用**
- 因为超时逻辑在 **Deeptask 自己的终端启动路径**里，不在用户设置里

结论：**cmd 必须被插件一等公民支持。新安装零配置。**

## 2. 协议要求：cmd 也要发出正确的 OSC 633

VS Code 用 OSC 633 标记提示符与命令边界。PowerShell 集成脚本在 `Prompt()` 里发送：

```text
ESC ] 633 ; A BEL     提示符开始（插件当前硬等这个）
ESC ] 633 ; P ; Cwd=<path> BEL
ESC ] 633 ; B BEL     提示符结束 / 可输入
ESC ] 633 ; E ; <cmdline> [; <nonce>] BEL
ESC ] 633 ; C BEL     命令开始执行
ESC ] 633 ; D [; <exitCode>] BEL   命令结束
```

cmd 没有 PowerShell 那种可替换 `Prompt` 函数。要“正确集成”，插件必须自己保证下面任意一条成立：

1. **给 cmd 注入等价序列**（推荐：包装启动，而不是改用户机器）
2. **识别 cmd 无官方集成，走不依赖 `633;A` 的执行路径**
3. **两者都做**：能发序列就发，发不出来也不阻塞命令

最低可用集合（cmd 必须满足，否则禁止 5 秒硬失败）：

| 序列 | 含义 | cmd 要求 |
|---|---|---|
| `633;A` | 提示符开始 / 集成已就绪 | 若走 VS Code 官方集成路径，必须在超时前发出 |
| `633;B` | 提示符结束 | 建议有，便于命令注入 |
| `633;C` | 命令开始 | 建议有 |
| `633;D[;code]` | 命令结束 | **必须有等价完成信号**，否则输出截断、退出码丢失 |
| `633;P;Cwd=` | 当前目录 | 建议有 |

cmd 实现注意：

- 用 `ESC ] 633 ; A BEL`（`0x1b` + `]633;A` + `0x07`），不要只写到日志
- 不要依赖用户 `AutoRun`、`prompt`、`clink`、`cmder`
- 不要要求用户安装 PowerShell 7
- 不要要求用户改 `terminal.integrated.defaultProfile.windows`
- 自动化终端的自定义 `args` 不能覆盖 VS Code 注入的 `-Command` / profile 脚本；cmd 同理，自定义 `/k` 不能冲掉包装器

## 3. 插件必须改的默认行为（新安装即正常）

### 3.1 禁止把 `633;A` 当唯一门闩

当前逻辑等价于：

```text
create terminal
wait 5s for 633;A
if missing -> fail execute_command, never send the user command
```

应改为：

```text
create terminal
detect shell family (cmd / powershell / pwsh / bash / ...)
if shell has rich integration:
    wait up to T for 633;A, then send command
else:
    do not wait for 633;A
    use fallback executor immediately
```

硬规则：

- `cmd.exe`、`command.com`、未知 shell：**默认不因缺少 `633;A` 失败**
- 超时只降级，不否决
- `echo`、`dir`、`.cmd`、`.bat` 必须能跑

### 3.2 按 shell 分流，而不是按操作系统分流

Windows ≠ PowerShell。Windows 默认经常是 cmd。

启动后立刻看：

- `terminal.shellPath`
- 进程名：`cmd.exe` / `powershell.exe` / `pwsh.exe`
- `ComSpec`
- VS Code profile 名

然后：

| 检测到的 shell | 默认策略 |
|---|---|
| `powershell.exe` / `pwsh.exe` | 注入/等待官方 `shellIntegration.ps1`，可等 `633;A` |
| `cmd.exe` | **不走 5s 633;A 门闩**；用 cmd 包装器或 fallback |
| Git Bash / WSL | 用 bash 集成 |
| 未知 | fallback，记录诊断，命令仍执行 |

### 3.3 cmd 推荐实现：插件自带包装器，不改用户设置

在扩展内提供 `shellIntegration.cmd`（或 `.bat`），由插件在创建终端时作为启动包装，而不是让用户去改 settings。

示意（概念，不是让用户手工配置）：

```bat
@echo off
REM Deeptask cmd shell integration wrapper
REM 1) 立刻声明就绪，避免 5s 门闩
echo ]633;A
echo ]633;P;Cwd=%CD%
echo ]633;B

REM 2) 进入可执行状态。后续每条命令前后由插件再发 C/D
cmd /d /k
```

更稳的做法是 **不要依赖交互 prompt**，而是：

1. 插件创建隐藏/自动化 PTY
2. 对 cmd 发送：

```bat
echo <OSC 633;C>
<user command>
echo <OSC 633;D;%ERRORLEVEL%>
```

3. 用唯一标记解析输出（见 3.5）

包装器必须由扩展 `createTerminal({ shellPath, shellArgs })` 注入，例如：

```text
shellPath = ComSpec 或 C:\Windows\System32\cmd.exe
shellArgs = ["/d", "/s", "/c", "<extensionPath>\\shellIntegration.cmd"]
```

**不要**写进用户 `settings.json`。新机器装上扩展就带上脚本。

### 3.4 真正的零配置 fallback（必须有）

即使包装器失败（策略、杀软、ConPTY、旧 VSCodium），也要执行命令。

Windows fallback 优先级：

1. **cmd 包装器 + PTY**（有集成更好）
2. **无集成 PTY**：不写命令到用户可见 prompt 也可以，只要能读输出
3. **短命子进程**（不经过 VS Code Shell Integration）：
   - `cmd.exe /d /s /c "..."` 跑 `.bat/.cmd/echo`
   - `powershell.exe -NoProfile -ExecutionPolicy Bypass -File/-Command` 跑 `.ps1`
4. 把 stdout/stderr/exit code 写到工作区 `EXTRA/output/` 这类 durable 日志，再读回

关键：`execute_command` 的成功定义是 **命令被执行并回收输出**，不是 **633;A 出现过**。

### 3.5 完成检测不能只靠 `633;D`

cmd 常没有 PSReadLine。插件应同时认：

1. OSC `633;D[;code]`（若有）
2. 插件自己的结束标记，例如：

```bat
<user command>
echo DEEPTASK_EXIT=%ERRORLEVEL%
echo DEEPTASK_DONE_<nonce>
```

3. 子进程 `exit` 事件（fallback 路径）

解析时丢掉插件自己的标记，只把用户命令输出交给模型。

### 3.6 超时策略

| 事件 | 建议 |
|---|---|
| 等 `633;A` | cmd 默认 **0ms**（不等）；PowerShell 可 5–15s，超时降级 |
| 命令执行 | 用 `deeptask.commandExecutionTimeout`，与集成初始化分开 |
| 初始化失败 | 记一条诊断，**继续执行** |
| 用户命令失败 | 才把失败返回给模型 |

不要把 “集成没就绪” 显示成 “命令失败”。

### 3.7 不要靠改用户设置解决问题

以下都只能当高级选项，**不能当安装后的必要步骤**：

- `terminal.integrated.defaultProfile.windows = Windows PowerShell`
- `terminal.integrated.automationProfile.windows`
- `terminal.integrated.shellIntegration.enabled = false`
- `terminal.integrated.shellIntegration.timeout`
- `terminal.integrated.enablePersistentSessions = false`
- 让用户装 Clink / 改 `HKCU\...\Command Processor\AutoRun`

本机已验证：改这些设置后，插件仍可能继续等 `633;A` 并失败。说明修复点在扩展，不在用户配置。

允许的静默行为（仍不算“要用户设置”）：

- 扩展自己选 `shellPath`
- 扩展自己带 wrapper
- 扩展自己 fallback 到 `spawn`
- 扩展在自己的输出通道写诊断

### 3.8 持久终端与脏实例

VSCodium 日志里出现过：

- persistent process reconnection
- “Shell integration has been disabled for this terminal instance”

默认不要复用：

- 已声明 integration disabled 的终端
- 重连后 id 变成 `undefined` 的旧 PTY
- 上次等 `633;A` 失败的实例

每次 `execute_command`：优先新开；失败实例丢弃。这是插件内部策略，不是用户设置。

### 3.9 扩展宿主卡住时的降级

本机扩展宿主多次 `unresponsive`。终端初始化 5s 窗口会被吃掉。

因此：

- `633;A` 等待必须可取消、可降级
- 初始化与命令执行不要堵在 UI 线程
- 宿主刚恢复时不要立刻判定集成失败

## 4. 建议的代码落点（给另一台电脑）

在 Deeptask 终端执行模块（Cline/Roo 同源逻辑通常在 Terminal / ShellIntegration 一类文件）做这些改动：

1. **Shell 检测**  
   `isCmdExe(path)` / `isPowerShell(path)` / `isGitBash(path)`

2. **初始化等待**  
   `waitForShellIntegration()`：
   - cmd → 立即 `resolved(false)` 或走 wrapper 的立即 `633;A`
   - powershell → 保留等待
   - timeout → `degrade()` 不是 `throw`

3. **cmd wrapper 资源**  
   随 vsix 发布：
   - `dist/shell/shellIntegration.cmd`
   - 可选 `dist/shell/run_and_mark.cmd`

4. **Fallback executor**  
   `child_process.spawn` + 完整 stdout/stderr + exit code  
   工作目录用当前 workspace

5. **错误文案**  
   若仍要提示集成问题，写成：

   ```text
   cmd.exe has no VS Code official shell integration.
   Deeptask fell back to direct execution.
   ```

   而不是让 `execute_command` 失败。

6. **测试矩阵（新安装、空 settings.json）**

   | 用例 | 期望 |
   |---|---|
   | 默认 cmd，`echo ok` | 成功，输出 `ok` |
   | 默认 cmd，`cmd /c echo ok` | 成功 |
   | 默认 cmd，跑 `.cmd` | 成功，有 exit code |
   | 默认 cmd，跑 `.ps1` | 成功（内部转 powershell.exe -File） |
   | 无 `633;A` | 不失败 |
   | `shellIntegration.enabled=false` | 不失败 |
   | 持久会话重连后的脏终端 | 不复用，新开后成功 |
   | PowerShell 默认 | 仍可用官方集成 |

7. **发布标准**  
   空用户设置 + Windows 默认 cmd + VSCodium 1.126：安装扩展后第一条 `execute_command` 必须成功。

## 5. 给 cmd 包装器的最小协议（可直接实现）

命令前后由插件写入 PTY：

```bat
PROMPT $P$G
echo ]633;A
echo ]633;P;Cwd=%CD%
echo ]633;B
echo ]633;E;echo hello
echo ]633;C
echo hello
echo ]633;D;%ERRORLEVEL%
```

若 ConPTY/编码把 ESC 吃掉，改用标记协议：

```bat
echo DEEPTASK_START_<nonce>
echo hello
echo DEEPTASK_EXIT_%ERRORLEVEL%_<nonce>
```

插件认第二种即可在无 OSC 环境工作。**两种都要支持，OSC 不是唯一真理。**

## 6. 明确不要做什么

- 不要在 README 里写“请把默认终端改为 PowerShell”
- 不要在首次运行弹窗要求用户改 settings
- 不要把 cmd 标成 unsupported 就拒绝执行
- 不要用 5 秒超时作为 Windows 通用策略
- 不要假设存在 `Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`
- 不要把用户 `AutoRun` 当集成方案（污染全局 cmd）

## 7. 验收一句话

**Windows 新机器，默认 cmd，空 settings，装上 Deeptask，第一条终端命令就能跑。**  
`633;A` 是增强信号，不是执行许可证。cmd 必须在插件内部被正确集成或正确绕过。
