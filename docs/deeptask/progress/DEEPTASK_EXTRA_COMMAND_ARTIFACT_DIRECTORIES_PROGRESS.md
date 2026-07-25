# Deeptask 长命令产物 EXTRA 目录规则

## 目标

- 系统提示词明确要求长/复杂命令脚本存放在工作目录 `EXTRA/bash/`。
- 完整 stdout/stderr 与状态日志存放在工作目录 `EXTRA/output/`。
- XML 与 native execute_command 工具描述同步，避免不同协议行为漂移。

## Checklist

- [x] 查询相关记忆
- [x] 定位系统提示词和工具提示词
- [x] 修改提示词
- [x] 更新测试并验证
- [x] changeset、提交推送
- [x] 打包安装并更新 Release
- [x] universe-memory

## 实现

- 系统可靠执行规则要求脚本位于工作目录 `EXTRA/bash/`，完整 stdout/stderr 位于 `EXTRA/output/`，目录不存在时创建。
- XML `execute_command` 描述与 native tool schema 描述同步，避免协议切换后规则丢失。
- 系统提示词测试增加两个目录断言，并更新 8 份受影响快照。

## 验证

- `system-prompt.spec.ts`：20 passed，8 snapshots updated。
- `src` TypeScript check 通过。

## 交付

- Commit：`d47e6726`，已推送，`origin/main...main = 0/0`。
- VSIX：`deeptask-5.5.0.vsix`，42,422,282 bytes，已强制安装到 VSCodium。
- Release：`https://github.com/kurzgesagtcraft/deeptask/releases/tag/v5.5.0`，资产已替换。
- 新规则已在本次交付中落地：打包与发布日志位于 `EXTRA/output/`。
