# Deeptask 9.0.8

本补丁修复「不设超时限制」在 OpenAI 兼容客户端层被 SDK 默认 600 秒截断的问题：

- 勾选默认开启的「不设超时限制」后，LM Studio 及其他 OpenAI 兼容客户端不再在约 10 分钟后中止仍在进行的同一请求。
- 配置为 `0` 的超时不再被映射成 `undefined` 或立即超时的 `0`；无限等待改为使用 32 位 `setTimeout` 上限。
- 更新中英文 README、扩展包内 Marketplace 介绍页、安装命令和版本信息至 9.0.8。

## 验证

- `timeout-config.spec.ts`、`lm-studio-timeout.spec.ts`、`openai-timeout.spec.ts`、`base-openai-compatible-provider-timeout.spec.ts`：24 项通过。

## 发布产物

- 文件：`deeptask-9.0.8.vsix`（40,440,263 字节）。
- SHA-256：`7a3949951c15e6226ca3823a2c04663c637eb9b686c884c2acb9ee375abe46ec`。
- Release：<https://github.com/kurzcraft/DeepTask/releases/tag/v9.0.8>。
