# Zotero AI Sidebar

[中文](README.md) · English

A free AI literature-reading sidebar for Zotero 10.x. It uses your own OpenAI Chat Completions-compatible API and does not require a plugin subscription.

[Download the 0.2.3 installer](https://github.com/ZBT123-ui/zotero-ai-sidebar/releases/download/v0.2.3/zotero-ai-sidebar-0.2.3.xpi) · [All releases](https://github.com/ZBT123-ui/zotero-ai-sidebar/releases) · [Report an issue](https://github.com/ZBT123-ui/zotero-ai-sidebar/issues)

The plugin is free and open source. Model API pricing and data handling depend on the provider you configure. It targets Zotero 10.x and has been developed mainly on Windows; other platforms have not received full UI validation yet.

## Installation and setup

1. Download the latest `zotero-ai-sidebar-version.xpi` from the [GitHub Releases](https://github.com/ZBT123-ui/zotero-ai-sidebar/releases) page. In Zotero, choose **Tools -> Add-ons -> gear icon -> Install Add-on From File...**, select the XPI, and restart Zotero.
2. Select a paper and open **AI Literature Assistant** in the item pane on the right.
3. Open the settings button and enter a complete endpoint, model name, and API key.
4. You can use `https://api.openai.com/v1/chat/completions` or the complete `/chat/completions` endpoint supplied by another provider. A bare domain is rejected so that an HTML homepage is not mistaken for an API response.
5. Streaming requires a standard SSE response from the provider. Turn it off to use a regular JSON response when the provider does not support SSE.

The API key is stored in Zotero's local plugin preferences and is sent to the provider you configure with each request. The plugin does not provide model credits; pricing and data processing are controlled by that provider.

## Features

- **Multiple conversations**: Create, switch, rename, delete, and export separate conversations for each paper. Drafts are preserved.
- **Persistent history**: Chat history is stored in `zotero-ai-sidebar-chats.json` outside the preference values. Writes use temporary files and backups.
- **Movable storage**: In Settings -> Chat History, choose an E: drive folder or another location. The plugin migrates existing records, preserves a backup of an existing destination file, opens the directory, creates JSON backups, restores automatic or selected backups, and returns to the default location.
- **On-demand full-text reading**: Opening a paper reads only its title, date, and abstract. The PDF is not pre-read and the plugin does not build a full-text cache. Clicking **Read Full Text** or explicitly asking to read the whole paper invokes Zotero PDFWorker page by page. Extracted text stays in sidebar memory for follow-up questions and is not written to the chat history file.
- **Math and chemistry rendering**: KaTeX and mhchem support `$...$`, `\\(...\\)`, `\\[...\\]`, `$$...$$`, and `\\ce{H2O}`. Invalid formulas remain visible as source text instead of breaking the response.
- **Reading experience**: Safe Markdown rendering for headings, lists, tables, quotes, and code blocks; copy answers or code; copy a conversation as Markdown; insert selected PDF text; use quick prompts; and choose small, standard, or large text.
- **Request controls**: Stop generation, retry failed requests, inspect HTTP errors, detect non-JSON responses, handle IME Enter correctly, and enforce request timeouts. Switching or deleting a conversation does not attach a response to the wrong conversation.
- **Dark mode**: Follows the Zotero/system theme and remains usable in a narrow item pane.

## Limitations and roadmap

The plugin depends on a PDF text layer and does not perform OCR. Scanned PDFs, password-protected files, and formulas embedded in images need OCR first. PDFWorker is called only after an explicit reading request. If the extracted text exceeds the single-request limit, the plugin stops and explains the limit instead of silently truncating the paper. Streaming depends on standard SSE support from the provider.

Possible future work includes cross-paper search, page-linked citations, model presets, and operating-system keychain storage.

## Building from source

Node.js is required. Run `npm ci`, then `npm run build`; the installer is written to `.scaffold/build/zotero-ai-sidebar.xpi`.

Run `npm run lint:check` and `npm run test:storage:node` for static checks and the storage regression suite that does not require Zotero. GitHub Actions runs these checks and builds the plugin for pushes and pull requests.

On Windows, `npm run test:storage` uses an isolated Zotero profile and data directory to verify saving, reloading, Chinese drafts, deletion, backups, and recovery. Set `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` when the Zotero executable is not at the default location.

## Open source and releases

The source is licensed under [AGPL-3.0-or-later](LICENSE). KaTeX, mhchem, and their license files are included in the source and installer.

When a maintainer pushes a `v<version>` tag, GitHub Actions verifies the project, builds the installer, and publishes the XPI, source ZIP, `update.json`, and SHA-256 checksums. Run `npm run package:release` locally after building and committing to prepare the same release files. Automatic updates point to the latest Release in this repository.

## Privacy and contributions

Do not commit API keys, access tokens, private Zotero settings, chat history, or personal logs. The repository uses CODEOWNERS and protected `main` branch rules: changes must go through a pull request, receive maintainer review, pass the `check` workflow, and resolve review conversations.
