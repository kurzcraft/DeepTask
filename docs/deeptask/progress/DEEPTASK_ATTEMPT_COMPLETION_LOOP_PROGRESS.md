# DeepTask 结束任务后重复结束任务问题进度

## 检查清单

- [x] 查询相关记忆
- [x] 创建结束任务循环问题进度清单
- [x] 定位 attempt_completion / task completion 后继续触发路径
- [x] 复现或补充回归测试
- [x] 实现修复
- [x] 运行相关测试
- [x] 打包安装并发布 VSIX
- [x] 存储经验

## 问题

- 用户反馈：修复“结束任务后对话模型一直说结束任务”。
- 初步假设：`attempt_completion` 工具结果、任务结束状态、队列处理或自动继续路径之间存在状态未清理，导致模型在完成后被再次续跑，并重复选择结束任务。

## 当前观察

- universe-memory 搜索未命中同主题记录。
- 需要检查 `AttemptCompletionTool`、任务主循环、webview ask/feedback 路径、队列处理和 task completion 测试。
