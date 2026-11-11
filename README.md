# Zotero AI Sidebar

一个面向 Zotero 10.x 的免费 AI 文献阅读侧栏。它使用你自己的 OpenAI Chat Completions 兼容 API，不绑定会员服务。

[下载 0.2.3 安装包](https://github.com/ZBT123-ui/zotero-ai-sidebar/releases/download/v0.2.3/zotero-ai-sidebar-0.2.3.xpi) · [所有版本](https://github.com/ZBT123-ui/zotero-ai-sidebar/releases) · [反馈问题](https://github.com/ZBT123-ui/zotero-ai-sidebar/issues)

插件免费开源，模型 API 是否收费取决于你选择的服务商。面向 Zotero 10.x，主要在 Windows 环境开发和使用；其他系统尚未进行界面验证。

## 安装与配置

1. 在 [GitHub Releases](https://github.com/ZBT123-ui/zotero-ai-sidebar/releases) 页面下载最新的 `zotero-ai-sidebar-版本号.xpi`，然后在 Zotero 选择 **工具 → 插件 → 齿轮 → 从文件安装插件…** 安装，最后重启 Zotero。
2. 选中一篇文献，在条目右侧打开 **AI 文献助手**。
3. 点击右上角设置按钮，填写完整接口地址、模型名称和 API Key。
4. 接口地址可以填 `https://api.openai.com/v1/chat/completions`，也可以填服务商提供的完整 `/chat/completions` 地址；只填域名会被拒绝，避免把 HTML 首页误当成 JSON 接口。
5. “流式输出”需要服务商返回标准 SSE；如果云端服务不支持，关闭后使用普通 JSON 请求。

API Key 保存在 Zotero 本机配置中，并会随每次请求发送给你填写的服务商。插件不提供额度，费用和数据处理规则由服务商决定。

## 这一版的功能

- **多对话**：当前文献可以新建、切换、重命名、删除和导出多个对话；每个对话保留草稿和最近上下文。
- **持久保存**：聊天记录独立写入 Zotero 配置目录的 `zotero-ai-sidebar-chats.json`，不会占用偏好设置容量。写入采用临时文件和备份，多个 Zotero 窗口共享内存状态。
- **可迁移存储**：在设置 → 聊天记录中选择 E 盘或其他文件夹，插件会自动迁移并保留目标目录已有文件的备份；支持打开目录、创建 JSON 备份、恢复最近备份、从文件恢复和回到默认位置。
- **按需读取正文**：打开文献时只读取题名、日期和摘要，不预读 PDF 正文，也不建立插件全文缓存。点击“阅读正文”或发送“阅读整篇文章”等明确指令后，才调用 Zotero PDFWorker 逐页提取正文；正文保留在侧栏内存中供后续追问使用，不写入聊天记录文件。
- **数学与化学排版**：内置 KaTeX 和 mhchem，支持 `$...$`、`\\(...\\)`、`\\[...\\]`、`$$...$$`、`\ce{H2O}` 等公式和化学式；无效公式会保留源码并提示，而不会阻断整条回答。
- **阅读体验**：支持安全的 Markdown 标题、列表、表格、引用和代码块渲染；可复制回答、复制代码、复制整段 Markdown 对话、插入 PDF 选文和快捷提问。正文默认字号已调大，可在设置中选择小、标准或大。
- **请求控制**：支持停止生成、失败后重试、HTTP 状态提示、非 JSON 响应提示、输入法回车保护和请求超时。切换或删除对话不会把回答写入错误的会话。
- **深色模式**：跟随 Zotero/系统主题，窄侧栏中保持紧凑布局。

## 限制与后续方向

插件当前依赖 PDF 的文字层，不负责 OCR；扫描件、密码保护文件和图片中的公式需要先在 Zotero 或其他工具中 OCR。PDFWorker 会在用户主动要求后提取正文，正文超过单次读取上限时会停止发送并明确提示，不会假装已经读完整篇。流式输出依赖服务商的标准 SSE 格式。下一步适合增加跨文献检索、引用定位到 PDF 页码、模型预设管理和系统钥匙串存储。

## 0.2.3 按钮排版

修正停止按钮、快捷提问和设置按钮的文字垂直对齐，统一按钮行高与最小高度，避免文字贴近按钮下沿。

## 0.2.2 体验修复

默认聊天字号调整为 15px，设置、对话列表和状态文字同步放大；可在“模型设置 → 聊天记录 · 保存位置”中选择文件夹、打开目录、创建备份、恢复自动备份或从 JSON 文件恢复。正文只在点击“阅读正文”或明确要求阅读全文时提取。

## 0.2.1 存储修复

修复了 Windows 上混用反斜杠与正斜杠导致 Zotero 无法识别聊天文件路径的问题。普通存储、备份及恢复文件现在统一使用原生路径。保存出错时显示真实原因，不再把所有错误都归为磁盘权限。

如果 0.2.0 已提示保存失败，请先复制重要对话，再升级；尚未保存到文件的旧版内存记录无法自动恢复。API 配置沿用原有偏好设置。

## 从源码构建

需要 Node.js。运行 `npm ci` 后执行 `npm run build`，安装包会生成在 `.scaffold/build/zotero-ai-sidebar.xpi`。

运行 `npm run lint:check` 和 `npm run test:storage:node` 可进行静态检查及不依赖 Zotero 的存储回归测试。GitHub Actions 会在提交与拉取请求时执行这些检查并构建安装包。

Windows 可在项目目录运行 `npm run test:storage`。测试使用独立的 Zotero 配置目录和文献数据目录，验证保存、重载、中文草稿、删除、备份与故障恢复；可用 `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` 指定 Zotero 程序路径。

## 开源与发布

源码按 [AGPL-3.0-or-later](LICENSE) 开源。内置 KaTeX 及 mhchem，相关许可证随源码和安装包提供。

维护者提交版本并推送 `v版本号` 标签后，GitHub Actions 会验证、构建并发布 XPI、源码 ZIP、`update.json` 与 SHA-256 校验文件。运行 `npm run package:release` 可在本地已构建、已提交的源码上准备同样的发布文件。自动更新地址指向本仓库的最新 Release。
