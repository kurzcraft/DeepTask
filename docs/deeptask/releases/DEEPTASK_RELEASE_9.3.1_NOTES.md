# Deeptask 9.3.1

## 长会话灰屏根治：webview 转录有界持有（boundTranscript）

9.3.0 已把渲染进程 heap 从 4GB 级压回数百 MB，但 webview 仍对完整消息史做无界持有——超长会话（7k+ 行）的渲染 heap 依旧会线性爬到 jsHeapSizeLimit 后灰屏。9.3.1 补上最后一环：**给转录本身做有界投影**。

### 修复内容

- **boundTranscript 投影器**：保留一条逐字尾部窗口（800 行 + 256 行迟滞），更早的行替换为轻量墓碑——丢弃 text/images/reasoning 大负载；保留 ts/类型/ask/say/partial/isAnswered/checkpoint，`api_req_started` 成本 JSON 与 `contextCondense` 保留，token/成本统计不受损。
- **双摄取路径全投影**：全量 state 快照与流式 `messageUpdated` 追加都过投影器，渲染进程对 7k 行会话的常驻副本不再随消息数线性增长。
- **稳定的墓碑身份**：按 ts 缓存、按引用返回；逐字/墓碑边界只在越过 TAIL+迟滞后分批推进；任务切换/回卷重置投影器——增量缓存（consolidateCommands / getApiMetrics / filterVisibleMessages 的 Incremental 版本）持续命中。
- **墓碑不渲染**：转录顶部一条紧凑横幅报告已折叠的更早消息数并说明完整历史仍在磁盘。
- **存储与模型 I/O 完全不动**：host 仍全量持久化与回放，只有 webview 常驻副本有界。

### 现场验收（2026-11-01）

装入 VSCodium 重启后连续采样：渲染进程 360-560MB 区间波动、可见 GC 回落、零灰屏告警；对照旧实例（9.3.0 无界持有）同期曾达 4432MB 后灰屏。

### 证伪条件

长会话下渲染 anon 内存仍随消息数线性增长，即推翻本修复。

### 安装

```bash
codium --install-extension deeptask-9.3.1.vsix
```
