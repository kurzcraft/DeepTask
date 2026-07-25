# Deeptask Agent 队列与成品稳定性审计

## 目标

- 多次发送不能形成不可恢复的多消息卡队列。
- 用户消息走单一后端直达路径；精确重复发送应在短窗口内被拒绝。
- 等待发送时不渲染长消息正文，避免遮挡对话视野。
- 系统性验证发送、取消、压缩、终端反馈及任务拓展链路。

## Checklist

- [x] 查询历史记忆
- [x] 审计后端队列与前端 queued UI
- [x] 实现短窗精确去重与直达状态机
- [x] 移除等待队列和临时长消息正文 UI
- [x] 回归测试
- [x] 联合稳定性验证
- [x] changeset、提交、安装、发布
- [x] universe-memory

## 根因与决策

- 后端已经禁用可见消息队列并将旧 `queueMessage` 直达当前任务；`MessageQueueService` 仅作为旧状态清理器。
- 实际遮挡来自 `ChatView` 的 `recentCommandFeedbackMessages`：它会在输入框上方再次完整渲染长文本，且与持久化 `user_feedback` 重复。
- React 状态和扩展状态均为异步，快速双击 Enter 可在输入清空前重复发送相同 payload。
- 采用最小状态策略：等待 UI 不持有消息正文；1.5 秒内仅抑制完全相同的文本和图片签名，不吞掉不同的连续新指令。
- 否决重新建立可编辑消息队列：当前后端已有取消重建、续发串行化和压缩焦点锚点，再引入第二个持久队列会恢复双入口与 stale replay 风险。

## 验证

- Webview 队列与发送 UI：20 passed，12 skipped。
- 后端直达路由：51 passed。
- 任务续发、压缩、去重：93 passed，4 skipped。
- 取消重建：7 passed。
- 终端完成反馈：21 passed。
- Webview 与 backend TypeScript 检查通过。
- 完整日志：`EXTRA/output/verify-agent-queue-product-stability.log`，最终状态 0。

## 交付

- 提交 `856988ea` 已推送到 `origin/main`。
- VSIX：`deeptask-5.5.0.vsix`，42,421,603 bytes，内容与品牌验证通过。
- VSCodium 已强制安装 `deeptask.deeptask@5.5.0`。
- GitHub Release 已更新：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`。
