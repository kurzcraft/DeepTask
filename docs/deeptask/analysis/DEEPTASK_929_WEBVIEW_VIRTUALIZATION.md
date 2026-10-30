# DeepTask 9.2.9：聊天列表虚拟化（实现前记录）

日期：2026-10-30
范围：展示层 DOM/React 挂树与 webview 视口约束。不改 `apiConversationHistory`，不裁模型必要信息，不重做 9.2.8 已落地的克隆削减。

## 1. 9.2.8 之后仍会堆满的真实持有链

现场与源码交叉后，长会话 webview 堆随消息数线性涨的主因**不是**「没用 Virtuoso」，而是 **Virtuoso 视口高度未约束，退化成全量渲染**。

主聊天：

- [`ChatView.tsx`](webview-ui/src/components/chat/ChatView.tsx) 已把 `groupedMessages` 交给 `react-virtuoso`。
- 外层 `fixed ... flex flex-row overflow-hidden` 与 `grow flex flex-col min-h-0` 是对的。
- 列表包裹却是 `div.flex-auto.min-h-0`（**不是 flex 容器**），Virtuoso 只有 `className="scrollable grow overflow-y-scroll mb-1"`。
- `grow` 在非 flex 父级上无效。react-virtuoso 官方约束：没有有界高度就会尝试渲染全部 item。
- 结果：N 条历史 = N 个 [`ChatRow`](webview-ui/src/components/chat/ChatRow.tsx) 同时挂树。

每条 `ChatRow` 的放大因子：

1. `useSize`（ResizeObserver）包住整行，包括非末条。高度回调其实只对 `isLast` 有意义。
2. `ChatRowContent` → `MarkdownBlock`（react-markdown + remark-gfm/math + rehype-katex + 代码高亮/Mermaid）。
3. 命令行、推理块、图片、工具卡片等重子树。

侧链（次要，但同会话会叠加）：

- [`UserMessageRail`](webview-ui/src/components/kilocode/parallel/UserMessageRail.tsx) 为每条 `user_feedback` 挂一个按钮 + Tooltip（内容最多 2000 字），不随滚动卸载。
- [`ParallelSessionPanel`](webview-ui/src/components/kilocode/parallel/ParallelSessionPanel.tsx) 同样把 Virtuoso 放在 flex-row 里只写 `flex-1`，高度靠 stretch，仍应显式 `height: 100%`。
- webview 仍持有完整 `clineMessages` 数组（9.2.8 已把历史命令投影为短预览）。本轮不把「面板没显示」做成「模型没看到」；磁盘与模型 I/O 保持全文。

## 2. 明确不是本轮根因（禁止重做 / 禁止误修）

- 灰屏 ≠ OOM 杀 renderer。9.2.8 水合前 Loading 壳已修 `return null` 空灰。见宇宙记忆：灰屏否证、9.2.8 内存边界。
- 增量 `messageUpdated`、命令输出展示投影、设置 context 与转录拆分、辅助转义缓存、Shiki 按需主题：已在 9.2.8，不要再砍一遍。
- 禁止裁 `apiConversationHistory`、删历史截图、弱指纹省略全文、调高 heap、关掉 90% 告警。

## 3. 本轮改法（保功能）

1. **给 Virtuoso 有界视口**
   列表包裹改为 `h-full min-h-0 overflow-hidden`；Virtuoso `style={{ height: "100%" }}` + `h-full`。主聊天与并行面板同样处理。
   验收：屏外 `ChatRow` 不进入 React 提交；滚动仍能 `scrollToIndex` / followOutput。

2. **只给末条挂 `useSize`**
   历史行不再每人一个 ResizeObserver。末条流式高度变化仍驱动跟随滚动。

3. **`computeItemKey` 用 `message.ts`**
   避免 index key 在追加/压缩时错位回收，展开状态按 ts 保存在 `expandedRows`。

4. **侧栏 Tooltip 懒内容**
   轨道刻度仍全量（刻度是定位用的轻 DOM），Tooltip 正文延迟到悬停，避免每条预挂 2000 字节点。不减少跳转能力。

5. **不改磁盘存储与模型输入**
   展开命令输出仍按 ts `requestCommandOutput` 取回全文；末条 `partial` 命令保持完整投影。

## 4. 回归必须覆盖

- 末条流式：高度增长时 stick-to-bottom；用户上滚后不强制拉回。
- 展开/折叠命令输出、checkpoint 配对、浏览器会话行。
- 任务切换：`key={task.ts}` 重建列表，滚到最新。
- 发送、resend、UserMessageRail 跳转。
- 并行子代理面板滚动与展开。
- 现有 ChatView / ChatRow / CommandExecution / UserMessageRail 测试全绿。

## 5. 发布

版本 **9.2.9**。9.2.8 已发布；本轮是虚拟化视口修复，不是重做克隆削减。
