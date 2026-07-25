<p align="center">
  <img src="./assets/deeptask-logo-v2.png" alt="Deeptask compass logo" width="512" />
</p>

<h1 align="center">Deeptask</h1>

<p align="center">
  <strong>简体中文</strong> · <a href="./README_EN.md">English</a>
</p>

<p align="center">
  面向长任务与真实工程交付的 AI 编程智能体。<br />
  不只生成代码，更重视任务聚焦、可靠执行、持续验收和可恢复交付。
</p>

<p align="center">
  <a href="https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0">下载正式版</a>
  ·
  <a href="#快速开始">快速开始</a>
  ·
  <a href="#为什么选择-deeptask">核心改进</a>
  ·
  <a href="#架构概览">架构概览</a>
</p>

> **首次正式成品发布：v5.5.0**
>
> Deeptask 基于 Kilo Code 5.5.0 成熟架构持续演进，针对消息发送、终端生命周期、上下文压缩、任务续发和交付验收做了系统性加固。

## Deeptask 是什么

Deeptask 是运行在 VS Code / VSCodium 中的开源 AI 编程智能体。它可以理解自然语言需求、读取和修改工程、执行终端命令、调用工具、维护任务清单，并在长上下文中持续推进复杂任务。

与只追求“给出一段代码”不同，Deeptask 把完整任务看成一个可恢复的状态机：用户可以在执行中补充要求、暂停后继续、在任务完成后扩展新目标；智能体会保留有效历史、重新聚焦最新指令，并在真实验证完成后交付结果。

## 为什么选择 Deeptask

### 1. 消息直达，不让队列阻塞用户意图

- 用户消息由单一后端路径直接消费，不依赖易失效的可见等待队列。
- 暂停、取消、命令等待、任务完成后续发等状态均有明确路由，不静默吞消息。
- 1.5 秒短窗口只抑制完全相同的重复提交，不影响连续发送不同的新指令。
- 等待区不重复展示长消息正文，避免遮挡对话与制造“消息已经发出两次”的错觉。

### 2. 集成终端稳定受控

- 默认只保留最近 3 个已完成的 Deeptask 集成终端，并可在设置中调整。
- 正在运行的终端不计入完成终端限制，也不会被误关闭。
- 终端在命令完成、Shell 退出、兜底完成和复用前均执行收敛检查，降低事件竞态导致的超限。
- 命令输出会先持久化，再交回模型；空输出、非零退出、重复完成和 Shell 事件缺失均有确定终态。
- 长命令遵循“脚本文件 + 完整日志 + 读取验收”工作流，减少终端卡死与输出丢失。

### 3. 上下文压缩后仍聚焦最新任务

- 自动压缩与手动压缩共享输入清洗、摘要提示、provider、工具协议和焦点锚点。
- 摘要提交采用事务式校验：无效 token、过期结果或失败摘要不会污染原历史。
- 自动摘要失败时可生成有预算的本地结构化摘要，保留初始目标、最新用户要求、关键决策和近期证据。
- 过滤 reasoning 与环境噪声，并修复原生工具调用配对，避免压缩后出现协议错误。
- 手动压缩失败会明确报告；自动压缩则优先保证任务可继续，两者成功质量一致、失败策略清晰。

### 4. 完成不是终点，反馈会形成新的工作轮次

- 用户在任务结束后补充要求，会由宿主原子建立新的进行中工作项，而不是让模型重复旧结论。
- 旧清单及真实完成状态会保留，最新反馈作为扩展、修订或替换目标进入同一上下文。
- 历史恢复、跨工作区续发和编辑重发共享单一任务循环，避免两个并发循环争抢状态。
- 在没有实际工具工作前，智能体不能用空的或过早的完成结果结束新任务。
- 最终交付受未完成清单和实际验证约束，减少“看似完成、实际未验收”的使用落差。

### 5. 开箱即用，同时保持配置透明

- 新安装直接进入 Deeptask 工作区，不强制经过冗长 onboarding。
- 默认使用 OpenAI Compatible 配置，用户自行填写 endpoint、模型和 API key；发布包不内置密钥。
- 支持从模型元数据检测上下文窗口，并为未知兼容模型提供可编辑兜底值。
- 保留 Code、Architect、Debug 等多模式工作流，也支持自定义模式与 MCP 扩展。

## 相对 Kilo Code 5.5 基线的重点改进

Deeptask 尊重并继承 Kilo Code 的扩展宿主、工具系统、provider 生态和 React Webview 基础。本分支的差异重点不是简单换标，而是针对长任务体验进行工程化强化：

| 维度       | Kilo Code 5.5 基线    | Deeptask 的演进重点                                |
| ---------- | --------------------- | -------------------------------------------------- |
| 用户消息   | 通用 ask / queue 交互 | 单入口直达、取消续发原子化、短窗精确去重           |
| 集成终端   | 通用终端执行与复用    | 已完成终端硬限制、运行终端保护、终态输出闭环       |
| 上下文压缩 | 摘要与滑窗管理        | 事务提交、本地结构化 fallback、最新任务焦点锚定    |
| 完成后续发 | 通用任务恢复          | 宿主级反馈轮次、保留旧清单、只运行一个 active loop |
| 任务验收   | 模型驱动完成          | 实际工作门控、开放待办约束、拒绝过早完成           |
| 默认体验   | 面向通用 Kilo 服务    | OpenAI Compatible 默认配置与 Deeptask 品牌工作区   |

这些结论均来自仓库中的实现与回归测试，不代表对 Kilo Code 当前其他版本的全面比较。

## 主要能力

- 使用自然语言生成、修改和重构代码
- 读取工程上下文并跨文件实施变更
- 执行并跟踪终端命令与输出
- 自动维护任务清单和进度文件
- 自动或手动压缩长对话上下文
- 支持 OpenAI Compatible 等多种模型提供商
- 支持 Architect、Code、Debug 与自定义模式
- 支持 MCP 工具扩展、浏览器自动化和 Agent Manager
- 支持行内代码补全与独立 CLI / Agent Runtime 架构

## 快速开始

### 下载安装

从 [GitHub Release v5.5.0](https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0) 下载 `deeptask-5.5.0.vsix`。

在 VSCodium 中安装：

```bash
codium --install-extension ./deeptask-5.5.0.vsix --force
```

或在 VS Code 中安装：

```bash
code --install-extension ./deeptask-5.5.0.vsix --force
```

也可以打开扩展面板右上角菜单，选择 **Install from VSIX...**。

### 首次配置

1. 打开 Deeptask 设置。
2. 选择默认的 **OpenAI Compatible** provider。
3. 填写 API Base URL、API Key 和模型 ID。
4. 按需检测或手动填写上下文窗口。
5. 新建任务并直接描述预期结果、验收条件和限制。

> API key 仅由用户在本地配置；仓库和正式发布包不包含任何密钥。

## 推荐工作流

1. **说明目标**：描述需要完成的功能、修复或调研结果。
2. **给出验收条件**：例如测试范围、产物路径、安装目标或 Release 要求。
3. **持续补充反馈**：任务执行中可直接发送新要求，无需等待旧轮次结束。
4. **观察结构化进度**：Deeptask 会维护清单、保留完成状态并追加新工作。
5. **以证据交付**：代码变更应配套测试、命令日志、构建产物或安装验证。

## 架构概览

```text
VS Code / VSCodium
├── React Webview                         用户交互、设置、任务与 Agent Manager
├── Extension Host
│   ├── ClineProvider / Webview Handler   状态同步与消息路由
│   ├── Task Runtime                      单任务循环、续发、压缩和完成门控
│   ├── Tool System                       文件、命令、MCP、浏览器等工具
│   ├── Terminal Integration              命令执行、输出采集与终端保留
│   └── Provider Layer                    OpenAI Compatible 等模型适配
└── Agent Runtime / CLI                   可独立启动的 Agent 进程与命令行入口
```

### 仓库目录

- `src/`：VS Code 扩展宿主、任务运行时、provider、工具和服务。
- `webview-ui/`：React 聊天、设置、市场与 Agent Manager 界面。
- `packages/`：共享类型、IPC、遥测、云服务和 Agent Runtime。
- `cli/`：独立命令行包。
- `apps/`：文档、Storybook 与端到端应用。
- `jetbrains/`：JetBrains 插件及 Node.js host。

## 本地开发

环境要求：Node.js 20.20.0、pnpm 10.8.1。完整说明见 [`DEVELOPMENT.md`](./DEVELOPMENT.md)。

```bash
pnpm install
pnpm check-types
pnpm lint
```

聚焦测试必须在声明 Vitest 的 workspace 内运行，例如：

```bash
cd src && pnpm test core/task/__tests__/Task.spec.ts
cd webview-ui && pnpm test src/components/chat/__tests__/ChatView.spec.tsx
```

构建正式 VSIX：

```bash
./scripts_package_deeptask_vsix.sh
```

## 质量与贡献约定

- 新功能和缺陷修复必须包含回归测试。
- 修改共享上游代码时保留 `kilocode_change` 标记，降低后续同步冲突。
- 禁止提交 API key、密码和其他敏感配置。
- 实际产品变更需要 changeset；提交信息遵循 Conventional Commits。

## 开源协议

Deeptask 使用 [Apache License 2.0](./LICENSE) 发布。参与项目请同时遵守 [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)。
