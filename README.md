<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/kurzcraft/DeepTask@main/assets/deeptask-logo-v2.png" alt="Deeptask compass logo" width="512" />
</p>

<h1 align="center">Deeptask</h1>

<p align="center">
  <strong>简体中文</strong> · <a href="./README_EN.md">English</a>
</p>

<p align="center">
  <strong>把跨小时、跨会话、持续变化的软件任务真正做完。</strong><br />
  长时间运行不失控，随时补充意见不中断，自动执行与人工审查自由切换。
</p>

<p align="center">
  <a href="https://github.com/kurzcraft/DeepTask"><img src="https://img.shields.io/badge/GitHub-访问%20DeepTask%20源码仓库-181717?style=for-the-badge&logo=github&logoColor=white" alt="访问 Deeptask GitHub 源码仓库" /></a>
</p>

<p align="center">
  <a href="https://github.com/kurzcraft/DeepTask/stargazers"><img src="https://img.shields.io/github/stars/kurzcraft/DeepTask?style=flat-square&logo=github&label=Star" alt="GitHub Stars" /></a>
  <a href="https://github.com/kurzcraft/DeepTask/releases/latest"><img src="https://img.shields.io/github/v/release/kurzcraft/DeepTask?style=flat-square&label=Latest%20Release" alt="Latest GitHub Release" /></a>
  <a href="https://github.com/kurzcraft/DeepTask/issues"><img src="https://img.shields.io/github/issues/kurzcraft/DeepTask?style=flat-square&logo=github&label=Issues" alt="GitHub Issues" /></a>
</p>

<p align="center">
  <a href="https://github.com/kurzcraft/DeepTask/releases/latest"><strong>下载 Deeptask 9.2.2</strong></a>
  ·
  <a href="#三分钟开始">快速开始</a>
  ·
  <a href="./docs/deeptask/guides/USER_GUIDE.md"><strong>文档</strong></a>
  ·
  <a href="#为什么适合长程任务">核心能力</a>
  ·
  <a href="#架构与可信度">架构</a>
</p>

> **Deeptask 9.2.2** 子代理长结果截断修复 + todo 格式快速失败 + 弹窗点击外部关闭原生重写：dispatch_subagents 子代理结果回传上限 4000 → 20000 字符（ParallelManager 兜底同步放宽），长输出子任务不再丢尾；模型传入非法 todo 格式时立即报错并给出正确格式示例，不再落入"expansion required"误导循环；左下角弹窗（模式/Profile 选择器）点击外部关闭改为原生 document pointerdown 监听，流式重渲染不再自关；并行会话未读绿点竞态消除（seen 集合保留到确认完成态才消费，reopened 重置）；会话列表顺序确定性排序；evolve 系列副本编号固定（evolve-2 → Evolve-3 谱系不漂移）；模式下拉列表钉住当前模式。

## 你可以怎样使用 Deeptask

| 使用场景                             | Deeptask 提供的体验                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| 放手完成一个有测试的工程任务         | 开启 YOLO 全托管模式，Agent 连续读写、执行、验证，减少重复确认               |
| 审慎修改陌生或生产代码               | 关闭 YOLO，在工具、命令和最终完成节点逐步批准或拒绝                          |
| 同时运行多个服务器、监听器或训练任务 | 每个长任务留在集成终端列表，实时查看输出，随时单独手动终止                   |
| Agent 执行中又发现新要求             | 直接继续发送修改意见，最新反馈会成为新的工作焦点，而非等待旧任务结束         |
| 需要中途换模型、换提供商或换配置     | Agent 可自动切换模式、提供商配置与模型，并在连通与上下文容量通过后原子落盘   |
| 对话过长或需要隔天继续               | 自动压缩上下文，并用 `EXTRA/task/`、脚本和耐久日志恢复真实进度               |
| 使用自建、代理或本地模型服务         | 通过 OpenAI Compatible 填写 endpoint、模型与 API Key，并检测或覆盖上下文窗口 |

## 为什么适合长程任务

### 后台任务可见，也始终可控

命令真实运行在 VS Code / VSCodium 集成终端中。开发服务器、测试监听、构建、训练等多个长时服务可以并行保留在终端列表：你能看到实时输出和原始命令，也能对某一个终端使用停止、垃圾桶或 `Ctrl+C`，无需把控制权完全交给 Agent。

Deeptask 默认只保留最近 3 个**已完成**终端；正在运行的任务不计入限制，也不会被清理。命令完成、Shell 退出和兜底终态都会触发收敛检查，避免终端数量因事件竞态持续超出设置。

[查看后台终端与长命令教程](./docs/deeptask/guides/USER_GUIDE.md#5-驾驭长时间任务)

### 零人工托管与逐步审查可以随任务切换

- **完全托管：** 开启 YOLO Mode，在明确权限和验收条件后让 Agent 连续推进。
- **人机协作：** 关闭 YOLO，按工具或命令配置自动批准范围，在关键步骤亲自批准、拒绝或修正。
- **可渐进放权：** 从只读开始，逐步开放编辑、命令白名单和最终交付，不必在全自动与全手动之间二选一。

[查看权限与工作模式教程](./docs/deeptask/guides/USER_GUIDE.md#4-选择控制方式)

### Agent 可自动切换模式、提供商与模型

Deeptask 支持 Agent 在任务中直接切换 Agent 模式、提供商配置和模型，而不是只停留在左下角手动选择：

- **动态配置枚举：** 每次工具调用前读取最新已保存配置列表，新建或重命名配置无需重启即可被 Agent 选中。
- **同配置换模型 / 跨配置换提供商：** 可只换模型，也可整配置切换到 DeepSeek、OpenAI Compatible、Nvidia 等已保存档案。
- **原子预检：** 仅当目标 API 连通，且当前上下文未超过目标模型容量时才落盘并激活；失败时保持原配置不变。
- **独立自动批准：** 提供“模型/配置切换”专用自动批准开关，默认开启，也可随时关闭后手动确认。

### Agent 版 Minecraft：自己搭积木的可构建性

Deeptask 9.2.0 之后，**Agent 能自己创建新模式、自己改写提示词、自己调配子代理，并用文件化命令衔接一切**——能力范围与自由度远超“预设好用的工具”：

- **模型自改模式：** 通过 `manage_mode` 工具，Agent 在任务中按需 create 全新模式（角色定义、何时使用、工具组、图标一应俱全），或 copy 现有模式为 `xxx-1`/`xxx-2` 副本后修改，改完立即切换、当前会话实时生效。提示词不再是一成不变的出厂设置，而是随实践进化的活配置。
- **模型自管提供商与模型：** Agent 可直接切换 provider profile 与模型（连通与上下文容量原子预检），多模型分工——推理重的子任务交给强模型，常规执行交给便宜模型——由 Agent 在运行时自行编排。
- **与子代理功能组合调配：** 主 Agent 通过 parallel 子代理并行派发独立子任务，每个子代理可指定不同模式、不同提供商、不同模型；父代理汇总结果后继续。等于在提示词层面定义“模型主动推理时机”与“不同子代理协作的模型优势分工”。
- **进化留痕：** evolve 模式的自我修改写入 `~/.deeptask/PROMPT_EVOLUTION_LOG.md`（原理与依据），fork 谱系写入 `~/.deeptask/MACHINE_LINEAGE.md`（时间/来源/用途），进化历史可审计、可回滚。

理论上，除了“模型通过命令做不了的自身对话处理”（如工作区迁移与上下文压缩），其余一切都交给模型的命令执行、文件读写与 Git 工作区——模型甚至能改写 `~/.deeptask/` 配置目录本身。**这就是 Agent 界的 Minecraft：不是给你固定玩法，而是给你方块，让你自己搭。**

### 执行中持续纠偏，让任务跟随真实需求变化

任务运行时仍可发送新要求。Deeptask 会把反馈识别为扩展、修订或替换目标，保留已经真实完成的部分，并把最新指令锚定为后续工作和上下文压缩的焦点。完成后继续提出需求，也会建立新的工作轮次，而不是重复旧结论。

工具调用出现意外异常时，Deeptask 会把失败明确回传给模型、释放呈现锁并继续后续轮次；错误展示本身异常时也不会让任务悄然卡死。

这形成了工程意义上的“近无限上下文”工作流：任务可以经过多轮压缩、恢复和跨会话接续持续演进。它依赖持久状态和可验证证据，而不是宣称单次模型请求拥有无限 token。

[查看执行中修正与任务扩展教程](./docs/deeptask/guides/USER_GUIDE.md#在执行中持续修正)

### EXTRA 把对话变成可恢复的工程现场

```text
EXTRA/
├── task/    任务清单、发现、决策、阻塞和验收状态
├── bash/    长命令、发布、迁移和诊断脚本
└── output/  完整日志、截图、报告、校验和与状态文件
```

长命令不会只剩一段易丢失的终端输出：脚本写入 `EXTRA/bash/`，完整 stdout/stderr 写入 `EXTRA/output/`，跨会话清单写入 `EXTRA/task/`。新会话可结合 Git 状态恢复任务，历史命令则能从终端、对话、脚本和日志多路回溯。

[查看 EXTRA 跨会话接续教程](./docs/deeptask/guides/USER_GUIDE.md#6-使用-extra-持续接续)

### 广泛接入 OpenAI-compatible API

OpenAI Compatible 是开箱即用的默认入口，可连接实现 OpenAI 风格 Chat Completions 或 Responses API 的云服务、代理网关和本地推理服务。用户可填写 Base URL、API Key、模型 ID，检测服务端模型元数据，也可手动覆盖上下文和输出 token。

DeepSeek、Groq、Mistral 和 Cerebras 还提供使用当前账户凭据的模型目录刷新、账户作用域缓存隔离、手填模型与上下文覆盖。发布包不内置任何用户密钥。

[查看模型与 API 配置教程](./docs/deeptask/guides/USER_GUIDE.md#2-配置模型)

### 完成必须有证据，扩展必须重新聚焦

Deeptask 将任务视为可恢复状态机，而不是一次性回答。未完成清单、尚未执行的实际工作和缺失的验收会约束最终交付；测试、构建、安装、日志或远端资产等证据会随结果一并说明。上下文压缩采用事务式摘要，并在失败时回退到可继续执行的策略，避免失败摘要污染原历史。

## 设计理念

### 无限等待 + 条件睡眠钩子：其他主流 Agent 都没有的确定性暂停

Deeptask 保留了 Kilo Code 最精华的设计：**命令执行没有强制超时，可以无限等待**。这看似危险，实则是构建确定性工作流的基石——你可以在模式提示词里自行设置，结合计算机的条件睡眠指令（如 `sleep`、文件锁轮询、状态文件监听）构建任意钩子：等待编译完成、等待训练收敛、等待用户回来确认。其他主流 Agent 一定会超时强行继续，Kilo Code 也因误卡住自动继续而在新版放弃了无限等待；Deeptask 则通过**文件化命令**（长命令先写成脚本文件再执行，输出持久化到日志）解决了误卡住问题，同时保留无限等待。想等就等，想停就停。

### 在现有 GUI 软件成果上智能化，而不是“大模型包一切”

Deeptask 选择寄生在 VSCodium 里而不是做成独立软件，是刻意为之：VS Code 生态已有的 Git 集成、diff 手动审查、集成终端、多服务器长时命令管理、按需询问写权限——这些成熟的人机控制设施全部直接继承。大模型负责推理与编排，GUI 负责呈现与控制，两者各司其职，而不是把一切都塞进模型对话框。

### 你不能丢失你的全面控制权

全自动与全手动不是二选一：

- **小白友好：** GUI 直接对话，门槛极低，打开就能用。
- **审核员友好：** 关闭写权限后，Agent 的每一处改动都以 diff 呈现，看 diff 决定最终是否修改再保存——最终代码审核员可以直接把关，人机协同改进。
- **随时介入：** 任务运行中可继续对话纠偏、可手动管理集成终端里的后台服务器、可 git 回滚任何一步。

### 可构建性：理论上可以自己构建任何功能

除了“模型通过命令做不了的自身对话处理”（工作区迁移与上下文压缩），剩下的全部交给模型的命令执行、文件读写与 Git 工作区。模型还能改写 `~/.deeptask/` 配置目录本身——skills、workflows、rules、模式定义都是纯文件，文件化带来灵活性与记忆性。在提示词里可以定义模型主动推理的时机、不同子代理的协作方式与模型优势分工——**可玩度很高，上限由你的想象力决定。**

## 三分钟开始

1. 从 [GitHub Releases](https://github.com/kurzcraft/DeepTask/releases/latest) 下载 `deeptask-9.2.2.vsix`。
2. 安装到 VSCodium：

    ```bash
    codium --install-extension ./deeptask-9.2.2.vsix --force
    ```

    或安装到 VS Code：

    ```bash
    code --install-extension ./deeptask-9.2.2.vsix --force
    ```

3. 打开 Deeptask 设置，选择 **OpenAI Compatible**，填写 API Base URL、API Key 和模型 ID。
4. 描述目标、限制和验收条件，并选择 YOLO 全托管或逐步审批。
5. 任务运行中直接继续发送修正意见；在集成终端和 `EXTRA/` 中观察真实进度。

完整步骤见 [Deeptask 使用指南](./docs/deeptask/guides/USER_GUIDE.md)。

## 统一配置目录 `~/.deeptask/`

所有全局配置集中于一个目录，与 skills/rules/workflows 平级，一目了然：

```text
~/.deeptask/
├── skills/                # 全局技能（SKILL.md 结构）
├── rules/                 # 全局规则（AGENTS.md 等）
├── workflows/             # 全局 workflows（含 17 个内置 git 操作流程）
├── modes/                 # 模式自定义配置文件（evolve-1.md 等 fork 副本）
├── mcp_settings.json      # MCP 服务器配置
├── custom_modes.yaml      # 自定义模式定义
├── PROMPT_EVOLUTION_LOG.md # evolve 改进日志（原理、置信度、修正依据）
└── MACHINE_LINEAGE.md     # 本机模式 fork 谱系（时间/来源/用途）
```

项目级配置则位于工作区 `.deeptask/` 目录（rules-<mode>/、skills/、mcp.json）。旧版 `~/.kilocode/`、`~/.deeptask/settings/` 位置会在启动时自动逐文件迁移（不覆盖已有文件）。

## 文档

| 文档                                                          | 内容                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| [完整使用指南](./docs/deeptask/guides/USER_GUIDE.md)          | 安装、API、权限、长任务、终端、EXTRA、压缩恢复与故障处理 |
| [English User Guide](./docs/deeptask/guides/USER_GUIDE_EN.md) | Complete English user documentation                      |
| [开发环境](./DEVELOPMENT.md)                                  | Monorepo 环境、构建与开发流程                            |
| [打包与发布](./docs/deeptask/guides/DEEPTASK_PACKAGING.md)    | 稳定 VSIX 构建、安装和发布流程                           |
| [版本说明](./docs/deeptask/releases/)                         | Deeptask 各版本的改进与验收摘要                          |
| [工程记录索引](./docs/deeptask/README.md)                     | 架构分析、历史进度和内部证据的目录边界                   |
| [贡献指南](./CONTRIBUTING.md)                                 | 代码贡献、测试与提交约定                                 |

## 架构与可信度

```text
VS Code / VSCodium
├── React Webview                         对话、设置、任务与 Agent Manager
├── Extension Host
│   ├── ClineProvider / Webview Handler   状态同步与消息路由
│   ├── Task Runtime                      单任务循环、反馈接续、压缩与完成门控
│   ├── Tool System                       文件、命令、MCP、浏览器等工具
│   ├── Terminal Integration              命令执行、实时输出与终端生命周期
│   └── Provider Layer                    OpenAI Compatible 与专用模型适配
└── Agent Runtime / CLI                   隔离 Agent 进程与命令行入口
```

Deeptask 尊重并继承 Kilo Code 的扩展宿主、工具系统、provider 生态和 React Webview 基础。本分支的重点不是换标，而是通过回归测试和真实发布流程强化消息直达、终端硬限制、反馈工作轮次、压缩焦点、任务验收与透明默认配置。

主要目录：

- `src/`：扩展宿主、任务运行时、provider、工具和服务。
- `webview-ui/`：React 对话、设置和 Agent Manager。
- `packages/`：共享类型、IPC、云服务和 Agent Runtime。
- `cli/`：独立命令行包。
- `docs/deeptask/`：用户指南、版本说明、架构分析与验收记录。
- `scripts/deeptask/`：Deeptask 专用打包、发布与诊断自动化。

## 开发与贡献

环境要求：Node.js 20.20.0、pnpm 10.8.1。完整说明见 [开发文档](./DEVELOPMENT.md)。

```bash
pnpm install
pnpm check-types
pnpm lint
```

聚焦测试必须在声明 Vitest 的 workspace 中运行。产品代码变更需要回归测试和 changeset；禁止提交 API Key、密码和其他敏感配置。

## 开源协议

Deeptask 使用 [Apache License 2.0](./LICENSE) 发布，并遵循 [行为准则](./CODE_OF_CONDUCT.md)。
