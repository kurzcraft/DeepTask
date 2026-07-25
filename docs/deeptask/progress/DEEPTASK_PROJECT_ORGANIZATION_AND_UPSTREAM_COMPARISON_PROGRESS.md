# Deeptask 项目规整与 Kilo Code 上游对比进度

## 目标

- 按用户最新要求整理根目录中的历史 Deeptask Markdown 与日志。
- 不移动脚本、图片、证据、构建入口与发布入口。
- 保持历史 Markdown 正文不变，使用 Git 重命名保留文件历史。
- 将后续打包日志稳定写入归档目录，避免再次污染根目录。

## Checklist

- [x] 查询相关项目记忆与否证记录
- [x] 盘点根目录 Markdown 与实际引用
- [x] 设计 Markdown-only 迁移映射
- [x] 将历史进度归档到 `docs/deeptask/progress/`
- [x] 将根因分析归档到 `docs/deeptask/analysis/`
- [x] 将打包指南归档到 `docs/deeptask/guides/`
- [x] 验证 Git 将 81 个历史文件全部识别为纯重命名
- [x] 验证无删除、无新增、无内容修改及无 Markdown 格式错误
- [x] 将 13 份根目录日志归档到 `artifacts/deeptask/logs/`
- [x] 修改主打包脚本，使后续日志直接写入归档目录
- [x] 验证根目录日志为 0、归档日志为 13、打包脚本语法有效
- [x] 建立专业中英文 README，并以中文版作为 GitHub 默认首页
- [x] 将本专项进度归档到 `docs/deeptask/progress/`
- [x] 提交并推送目录规整与双语 README
- [x] 更新 universe-memory

## 当前原则

- 不移动 `package.json`、锁文件、许可证、标准贡献文档、monorepo 入口与工具约定文件。
- 不移动脚本、图片、证据和发布入口；不批量修改历史 Markdown 正文。
- 对历史文件使用 `git mv`，以保留提交历史和可追溯性。
- 不重新安装依赖；若后续确需安装或变更 Python 依赖，同步更新 `requirements.txt`。

## 验收结果

- 80 份进度文档归档到 `docs/deeptask/progress/`，其中包含本专项进度。
- 1 份根因分析归档到 `docs/deeptask/analysis/`。
- 1 份打包指南归档到 `docs/deeptask/guides/`。
- Git 对原有 81 份历史文档全部识别为重命名，没有删除重建。
- 根目录 Markdown 保持 10 份，其中 `README.md` 为默认中文版，`README_EN.md` 为英文版。
- 中英文 README 各 200 行，语言互链、核心章节、图片和相对资源链接均已验证。
- `git diff --check` 通过。
- 13 份未跟踪运行日志已归档到 `artifacts/deeptask/logs/`，根目录日志数为 0。
- `scripts_package_deeptask_vsix.sh` 后续直接写入归档目录，`bash -n` 验证通过。
- README 图标曾于提交 `f73b08b4` 改为 `<picture>` + SVG 主题切换，但 GitHub 实际页面仍回退显示 `alt` 文字，因此该方案已被否证。
- 目录规整与双语 README 已由提交 `6113c83a` 推送到 `origin/main`。
- 远端 SHA 与本地 HEAD 完全一致；远端中文版默认首页、英文版和双向语言链接通过验收。
- 中英文 README 曾进一步改为 HTML `<img>` 引用 `src/assets/icons/logo-outline-black.png`，但用户实际页面仍只显示可点击替代文字，因此该方案也被否证。
- GitHub 原生 Markdown 图片语法会由官方渲染器生成 `<img>`，但这仍不足以证明用户真实页面可见；真实匿名 Chrome 打开仓库返回 GitHub 404，无法加载任何 README DOM。
- 原 256×256 PNG 是黑色图形加透明背景，在 GitHub 深色主题中即使加载成功也可能近乎不可见。
- 尝试从复杂 SVG 生成固定背景横幅得到近乎纯黑空图；尝试直接复合灰度 Alpha PNG 得到纯白空图，两者均经视觉检查否证且未推送。
- 最终显式提取原图 Alpha 通道作为蒙版，在 512×512 固定白色画布上生成黑色实体指北针；像素均值为 0.94331，视觉检查确认图片清晰、无文字、无透明主题依赖。
- 中英文 README 继续使用稳定路径 `![Deeptask](./assets/deeptask-logo.png)`，仅替换该路径下的图片本体，避免继续改变引用。
