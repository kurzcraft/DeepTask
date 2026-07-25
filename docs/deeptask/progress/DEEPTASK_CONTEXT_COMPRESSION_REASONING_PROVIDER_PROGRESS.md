# DeepTask 上下文压缩推理泄漏与 Provider 错误修复进度

## 检查清单

- [x] 查询宇宙记忆
- [x] 定位上下文压缩、reasoning 内容处理与 provider 错误代码路径
- [x] 修复上下文压缩推理泄漏与 provider 错误
- [x] 补充或更新回归测试
- [x] 运行相关测试并记录结果
- [x] 存储本次修复经验

## 当前发现

- 宇宙记忆搜索未命中直接相关经验。
- 本任务接续终端剪枝修复之后进行；终端剪枝改动不回退。
- `src/core/condense/index.ts` 在每个 summary message 中无条件注入 synthetic `reasoning` block。
- 该 synthetic reasoning 会进入压缩后的有效 API history，造成“压缩推理泄漏”，并可能让不接受 `reasoning` content block 的 provider 报错。
- 更稳妥的策略是：普通 summary 只保存 `text` block；仅在 native tools 需要保留跨边界 `tool_use`/`tool_result` 配对时，保留原始 assistant message 中已有的 reasoning block，不合成新的 reasoning。

## 验证记录

- 通过：`pnpm test core/condense/__tests__/index.spec.ts core/condense/__tests__/condense.spec.ts`，2 files passed，50 passed，3 skipped。
- 测试覆盖普通 summary 不再含 synthetic `reasoning` block、tool_use 配对时不合成 reasoning、存在原始 reasoning 时仅保留原始 reasoning。

## 风险

- 需要明确 provider 错误是由压缩请求携带不兼容字段、reasoning 内容泄漏到普通消息，还是压缩结果写回历史时结构不合法导致。
- 本次修复将压缩结果写回历史时的 synthetic reasoning 移除；仍保留 native tools 跨边界 tool_use/tool_result 配对所需的原始 reasoning blocks。
