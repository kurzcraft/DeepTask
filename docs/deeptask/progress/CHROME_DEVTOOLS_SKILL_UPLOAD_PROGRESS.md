# Chrome DevTools MCP CLI 文件上传功能改进进度

## 目标

- 为全局 `chrome-devtools-mcp-cli` skill 增加正式、通用的文件上传命令。
- 上传器必须在同一 MCP 会话内获取 accessibility snapshot、解析目标 UID 并调用原生 `upload_file`。
- 支持明确目标控件，避免模糊匹配或自动点击表单最终提交按钮。
- 更新 skill 文档、帮助文本与可复现测试。

## 里程碑

- [x] 从 Visual Studio Marketplace 上传实践确认真实需求
- [x] 证伪将 CSS selector 直接作为 `upload_file.uid` 的方案
- [x] 审计现有 skill、通用 browser-agent 和测试结构
- [x] 设计通用上传命令参数与安全边界
- [x] 实现上传器并更新 SKILL.md
- [x] 添加聚焦测试并验证帮助文本、UID 解析和错误处理
- [x] 使用本地自有页面完成端到端上传验收
- [x] 将 Kilo 与 OpenCode 两份 skill 按 SHA-256 同步一致
- [x] 系统性存储 universe-memory

## 已确认事实

- Chrome DevTools MCP 的 `upload_file` 参数是 snapshot 节点 UID，不是 CSS selector。
- UID 可能跨 snapshot 或 MCP 会话漂移，因此必须在同一客户端会话内先调用 `take_snapshot`，随后解析目标 UID 并上传。
- `upload_file` 只负责绑定文件，不应默认点击页面的 Upload/Submit/Publish 等最终提交按钮。
- 已在 Visual Studio Marketplace 上用控件名称 `Click here to upload a package` 成功上传 `deeptask-5.5.1.vsix`。
- 真实 HTML 常让 `<label>` 的 `StaticText` 与文件输入映射出的 `button` 共享可访问名称；解析器应忽略同名静态文本，仅在多个同名按钮间判定歧义。
- 正式命令为 `upload <file-path> <exact-accessible-name>`；相对文件路径按调用目录解析，文件不存在时在连接浏览器前 fail-fast。

## 验证结果

- Node 单元测试：6/6 通过，覆盖唯一匹配、转义名称、缺失、同名静态标签、同名按钮歧义和空名称。
- CLI 帮助：包含上传语法和“只选择文件、不提交表单”警告。
- 预期失败：不存在文件返回退出码 1 和绝对路径错误。
- 本地端到端：成功将本进度文件绑定到自有 HTML fixture，页面确认文件名与 1790 字节。
- 结构校验：14/14 通过。
- Node 语法检查：`browser-agent.mjs` 通过。
- 双平台同步：Kilo/OpenCode 的 5 个新增或修改文件 SHA-256 完全一致。

## 验收标准

- 用户可以通过稳定、简洁的 CLI 命令上传任意本地文件。
- 可按 accessibility 名称定位上传控件；歧义、缺失和 MCP 错误必须 fail-fast。
- CLI 输出包含所用 UID、文件路径和 MCP 返回结果，不泄漏文件内容。
- 帮助与 SKILL.md 明确说明“上传文件”不等于“提交表单”。

## 触发准确性样例

### 应触发

1. “用 Chrome MCP 上传这个 VSIX。”
2. “给网页的文件选择框传一张图片。”
3. “自动操作浏览器选择本地 PDF。”
4. “DevTools MCP 怎么操作 input file？”
5. “上传文件后先别提交表单。”

### 不应仅因上传器而触发

1. “用 curl 上传文件到 API。”
2. “把文件复制到服务器目录。”
3. “实现后端 multipart 上传接口。”
4. “解释 HTML file input 的原理，不操作浏览器。”
5. “把附件提交到 GitHub Release API。”

## 元认知结论

- 任务前：不确定 Chrome MCP 的文件上传参数是否能直接接受 CSS selector，也未建模 accessibility 同名标签边界。
- 任务后：确认 `upload_file` 依赖 snapshot UID，建立同会话绑定、按钮角色过滤、歧义 fail-fast 与提交分离四层约束。
- 被挑战的信念：最初认为“任何同名 snapshot 节点都应判歧义”；本地 fixture 证明 `<label>` 的静态文本与文件输入按钮常自然同名，应按可交互角色过滤。
- 最薄弱处：当前角色过滤基于 Chrome snapshot 把文件输入暴露为 `button` 的已验证行为；若 MCP 将来改用其他交互角色，需要扩展允许角色并重新测试。
- 净熵：显著下降；排除了 CSS-selector 直传和首节点猜测，确认了可复现端到端路径。
- 长期记忆：`宇宙/记忆/技术记忆/2026-07-26-Chrome-DevTools-MCP文件上传与Snapshot-UID绑定.md`。
