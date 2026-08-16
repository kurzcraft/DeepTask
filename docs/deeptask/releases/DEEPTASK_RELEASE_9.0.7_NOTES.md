# Deeptask 9.0.7

本补丁为提供商高级设置中的 API 请求频率限制增加无限等待与精确秒数输入：

- 新增默认勾选的「不设超时限制」。勾选后，同一请求即使没有回应也会无限等待，不再因空闲超时中断。
- 最小间隔滑块旁增加秒数文本框和保存按钮，文本框与滑块保持协同；输入可超过滑块默认上限。
- 勾选「不设超时限制」后，最小间隔滑块、秒数输入和保存按钮禁用，间隔等待不会生效。
- 更新中英文 README、扩展包内 Marketplace 介绍页、安装命令和版本信息至 9.0.7。

## 验证

- `Task.spec.ts`：137 项通过，4 项跳过。
- `RateLimitSecondsControl.spec.tsx`：4 项通过。

## 发布产物

- 文件：`deeptask-9.0.7.vsix`（40,439,883 字节）。
- SHA-256：`ec8ffafb1dd852f9ab8ce4a5f52662b125c7c2c82e3eeadfe3274a3305fbd2f8`。
- Release：<https://github.com/kurzcraft/DeepTask/releases/tag/v9.0.7>。
