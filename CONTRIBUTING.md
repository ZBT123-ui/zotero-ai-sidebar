# 参与贡献

欢迎通过 Issue 反馈问题，或 Fork 本仓库并提交 Pull Request（PR）。公开可读不代表拥有主仓库的写入权限。

合并到 `main` 前需要维护者 [@ZBT123-ui](https://github.com/ZBT123-ui) 审核，并通过 GitHub Actions 的 `check` 检查。修改提交后，旧的审核批准会失效，讨论也需要先解决。管理员保留通过 PR 执行必要维护的权限。

请勿提交 API Key、访问令牌、个人 Zotero 配置、聊天记录或包含个人信息的日志。示例配置只使用空值或明确的占位符；反馈截图请先遮盖凭据与私人文献内容。

开发验证：

```sh
npm ci
npm run lint:check
npm run test:storage:node
npm run build
```
