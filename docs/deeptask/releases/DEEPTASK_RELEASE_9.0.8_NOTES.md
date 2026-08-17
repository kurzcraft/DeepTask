# Deeptask 9.0.8

本补丁修复「不设超时限制」在 OpenAI 兼容客户端层被 SDK 默认 600 秒截断的问题，并修复 LM Studio 思考模型看起来一直卡住：

- 勾选默认开启的「不设超时限制」后，LM Studio 及其他 OpenAI 兼容客户端不再在约 10 分钟后中止仍在进行的同一请求。
- 配置为 `0` 的超时不再被映射成 `undefined` 或立即超时的 `0`；无限等待改为使用 32 位 `setTimeout` 上限。
- LM Studio 流式/补全会转发 `reasoning_content`，Qwen3.8 这类思考模型在 `content` 为空时不再被当成无响应。
- LM Studio 失败时保留原始错误细节，而不再只显示通用开发者日志提示。
- 更新中英文 README、扩展包内 Marketplace 介绍页、安装命令和版本信息至 9.0.8。

## 验证

- `timeout-config.spec.ts`、`lm-studio-timeout.spec.ts`、`openai-timeout.spec.ts`、`base-openai-compatible-provider-timeout.spec.ts`：24 项通过。
- `lmstudio.spec.ts`、`lmstudio-native-tools.spec.ts`：19 项通过。

## 发布产物

- 文件：`deeptask-9.0.8.vsix`（40,440,932 字节）。
- SHA-256：`3b0d65cfbea790b855218a63273f6c895cf2e4c933238dab2a4ce4ed08b2f53d`。
- Release：<https://github.com/kurzcraft/DeepTask/releases/tag/v9.0.8>。
