# 标题链接采集工具（zhihu-title）

批量标题转知乎链接采集桌面工具（Electron，Windows / macOS）：

1. 导入含「标题」列的 .xlsx 表格（支持选择导入行数）
2. 按标题批量搜索知乎问答/专栏，归一化 + 相似度匹配：
   - 归一化相等 → 精确匹配，自动采纳
   - 相似度 ≥ 90% → 自动采纳点赞最高候选
   - 85% ~ 90% → 待人工确认（绝不自动回填）
3. 可选：AI 对采集正文做内容打标（故事 / 职场 / 历史科普等，分类可自定义）
4. 导出回填「文章链接 / 采集状态 / 原文字数 / 内容标签 /（可选）正文」的结果表格

进度以 JSONL 增量落盘，支持断点续跑。

## 开发

```bash
npm install
npm run dev        # 构建并启动 Electron
npm run typecheck  # 类型检查
```

## 本地打包

```bash
npm run make:win32   # Windows（需在 Windows 上执行）
npm run make:darwin  # macOS
```

产物输出至 `release/`。

## 自动打包

推送 `main` 分支或 `v*` 标签后，GitHub Actions（见 `.github/workflows/build-packages.yml`）
会在 windows-latest 与 macos-latest 上分别构建安装包，
产物在 Actions 运行页的 Artifacts 中下载（`windows-installers` / `mac-installers`）。

## 配置说明

应用「设置」页需要填写两个 Key：

- 搜索 API Key：用于标题搜索服务
- AI Key：用于内容打标（OpenAI 兼容接口，Base URL / 模型可配置）

Key 均以系统级加密（Electron safeStorage）存储在本机，不会上传。
