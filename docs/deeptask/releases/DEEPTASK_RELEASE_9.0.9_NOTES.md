# Deeptask 9.0.9

本补丁在聊天底部模型选择器右侧新增「推理强度」快捷下拉，切换即生效：

- 底部控制条新增推理强度下拉，包含「关闭 / 低 / 中 / 高 / 极高」；模型声明能力数组时按其支持的档位显示，强制推理的模型不提供「关闭」。
- 切换即写入当前 API 配置（`enableReasoningEffort` + `reasoningEffort`）并持久化，下一次请求立即按新档位发送，无需重启或进设置页。
- LM Studio 流式与单次补全把该设置转换为 `chat_template_kwargs.enable_thinking`：选「关闭」（或 `none`）关闭思考，选任意档位开启思考。
- 自动补全配置与虚拟配额回退配置不显示该下拉。
- 新增 `ReasoningEffortSelector.spec.tsx`（7 项）与 `lmstudio.spec.ts` 推理参数用例（6 项）覆盖以上行为。
- 更新中英文 README、扩展包内 Marketplace 介绍页、安装命令和版本信息至 9.0.9。

## 验证

- `src`：`lmstudio.spec.ts`（16 项）与 `shared/__tests__/api.spec.ts`（28 项）通过；`pnpm check-types` 通过。
- `webview-ui`：`ReasoningEffortSelector.spec.tsx` 7 项通过；`pnpm check-types` 通过；ESLint 无告警。
- `GhostServiceSettings.spec.tsx`、`InstalledSkillsView.spec.tsx` 存在 2 项与本次改动无关的存量失败（干净代码树同样失败）。

## 发布产物

- 文件：`deeptask-9.0.9.vsix`（40,443,778 字节）。
- SHA-256：`75e5c23f541d4de91845deac2aa3812cd4cac61a8e92616c840baf351ff5fc79`。
- Release：<https://github.com/kurzcraft/DeepTask/releases/tag/v9.0.9>。
