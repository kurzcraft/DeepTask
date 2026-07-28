# Visual Studio Marketplace 更新 Skill 进度

## 目标

- 在 `/home/kurz/.kilocode/skills` 创建全局 Marketplace 已有扩展更新 skill。
- 自动导航到发布者后台现有扩展的 `More Actions... -> Update`。
- 选择并验证 VSIX，精确点击最终 `Upload` 一次，然后立即停止全部浏览器操作。
- 严禁使用 `New extension`，严禁为绕过重复标识错误修改 package `name`。

## 里程碑

- [x] 从真实发布流程提取需求、错误模式和安全边界
- [x] 设计 skill 触发描述与逐步工作流
- [x] 创建全局 SKILL.md
- [x] 验证 frontmatter、目录命名、触发语义和点击后硬停止契约
- [x] 生成 5 条应触发与 5 条不应触发测试查询
- [x] 存储 universe-memory 原理性经验

## 已确认事实

- 更新已有 `publisher.name` 必须走扩展行的 `More Actions... -> Update`。
- `New extension -> Visual Studio Code` 会得到“extension already exists”错误；修改 `name` 会错误创建另一个扩展。
- 文件选择与最终提交是两个独立操作。
- skill 的完成态必须报告文件名、大小和更新目标，明确最终 `Upload` 已精确点击一次，并声明未做任何点击后验证或操作。
- 等价验证器 14 项契约全部通过，证据见 `EXTRA/output/vscode-marketplace-update-skill-validation.log`。
- `create-skill` 安装目录只有 `SKILL.md`，其文档引用的 `scripts/validate_skill.sh` 未实际安装；本任务使用工作区等价验证器完成检查。
- 宇宙记忆已保存至 `宇宙/记忆/技术记忆/2026-07-26-Visual-Studio-Marketplace已有扩展更新提交边界.md`，置信度 0.98。
