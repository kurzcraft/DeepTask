# Deeptask 9.2.6

发布日期：2026-10-03

## 修复内容

### 修复 9.2.5 回归：进入对话后继续/取消按钮永久消失

9.2.5 为了修复"按钮闪现到其他对话开始界面"，把清按钮逻辑放在了一个定义在
lastMessage 恢复 effect **之后**的 task 切换 effect 里。React 在同一 commit 内按
定义顺序执行 effects，导致先恢复、后清除——刚恢复出来的继续/取消/审批按钮在同一
次 commit 里被擦掉，且之后 lastMessage 深比较不再变化，按钮永久消失，用户无法
控制对话。

修复：新增一个前置 reset effect（仅依赖 `task?.ts`），定义在 lastMessage 恢复
effect **之前**。同一 commit 内先清掉上一个对话的按钮、再恢复当前对话自己的按钮，
两个目标（不闪现 + 进入即显示）同时成立。原 task 切换 effect 移除清按钮块，保留
refs 清理职责。依赖数组刻意不含 `isHidden`：面板隐藏/显示不得清按钮（消息未变化时
恢复 effect 不会重跑，清了就没有恢复源）。

## 验证

- `webview-ui` check-types：PASS
- `src` check-types：PASS
- ChatView spec 45 用例：新增 2 个回归用例通过（进入对话即显示控制按钮、切换对话按钮跟随替换）；唯一失败的 touch-follow 用例经 git stash 基线对照确认为预存失败（与本次修改无关）

## 涉及文件

- `webview-ui/src/components/chat/ChatView.tsx`：新增前置 reset effect（reset-before-restore 顺序契约），原 task-switch effect 移除清按钮块
- `webview-ui/src/components/chat/__tests__/ChatView.spec.tsx`：+2 回归用例
- `src/package.json`：9.2.5 → 9.2.6
