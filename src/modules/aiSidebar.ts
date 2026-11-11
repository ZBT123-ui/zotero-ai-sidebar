import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
import {
  addConversation,
  conversationsFor,
  currentConversation,
  hasConversation,
  initChatStore,
  chooseStorageDirectory,
  createBackup,
  openStorageDirectory,
  resetStorageDirectory,
  restoreBackup,
  storageInfo,
  notifyChats,
  removeConversation as removeStoredConversation,
  selectConversation,
  setDraft,
  storageWarning,
  subscribeChats,
  updateConversation,
  type ChatMessage,
  type Conversation,
} from "./chatStore";
import { buildMessages, normalizeEndpoint, requestAnswer } from "./chatApi";
import {
  readDocument,
  readMetadata,
  requestsReading,
  selectContext,
  type DocumentContext,
} from "./documentContext";
import { action, copyText, html, icon, renderMarkdown } from "./chatView";
import { loadSidebarStyles } from "./sidebarStyles";

const SECTION_ID = "zotero-ai-sidebar";
const DEFAULT_TITLE = "新对话";
let registeredPaneID: string | false | null = null;
const panels = new Map<HTMLElement, PanelState>();
interface ChatJob {
  busy: boolean;
  text: string;
  error: string;
  stopped: boolean;
  cancel?: () => void;
}
const jobs = new Map<string, ChatJob>();

interface PanelState {
  item: Zotero.Item;
  itemKey: string;
  context?: DocumentContext;
  contextLabel: HTMLElement;
  transcript: HTMLElement;
  question: HTMLTextAreaElement;
  status: HTMLElement;
  ask: HTMLButtonElement;
  select: HTMLSelectElement;
  settings: HTMLDetailsElement;
  warning: HTMLElement;
  conversation: Conversation;
  contextPromise?: Promise<void>;
  disposed: boolean;
  cleanup: () => void;
}

export async function registerAISidebar() {
  await initChatStore();
  if (registeredPaneID) return registeredPaneID;
  registeredPaneID = Zotero.ItemPaneManager.registerSection({
    paneID: SECTION_ID,
    pluginID: config.addonID,
    header: {
      l10nID: `${config.addonRef}-head`,
      icon: "chrome://zotero/skin/16/universal/book.svg",
    },
    sidenav: {
      l10nID: `${config.addonRef}-nav`,
      icon: "chrome://zotero/skin/20/universal/magic-wand.svg",
    },
    bodyXHTML: '<html:div class="zai-host"></html:div>',
    onItemChange: ({ setEnabled }) => setEnabled(true),
    onRender: ({ body, item }) => renderPanel(body, item),
    onDestroy: ({ body }) => destroyPanel(body),
  });
  return registeredPaneID;
}

export function unregisterAISidebar() {
  for (const job of jobs.values()) {
    job.stopped = true;
    job.cancel?.();
  }
  jobs.clear();
  for (const panel of panels.values()) panel.cleanup();
  panels.clear();
  if (registeredPaneID)
    Zotero.ItemPaneManager.unregisterSection(registeredPaneID);
  registeredPaneID = null;
}

function renderPanel(body: HTMLDivElement, item: Zotero.Item) {
  destroyPanel(body);
  const doc = body.ownerDocument!;
  loadSidebarStyles(doc);
  const itemKey = String((item.parentItem || item).id || item.id || "unknown");
  const state: PanelState = {
    item,
    itemKey,
    contextLabel: html(doc, "div", "zai-context"),
    transcript: html(doc, "div", "zai-transcript"),
    question: html(doc, "textarea", "zai-question"),
    status: html(doc, "div", "zai-status"),
    ask: html(doc, "button", "zai-ask"),
    select: html(doc, "select", "zai-conversation-select"),
    settings: html(doc, "details", "zai-settings"),
    warning: html(doc, "div", "zai-warning"),
    conversation: currentConversation(itemKey),
    context: readMetadata(item),
    cleanup: () => undefined,
    disposed: false,
  };
  const root = html(doc, "div", "zai-root");
  const header = html(doc, "header", "zai-header");
  const brand = html(doc, "div", "zai-brand");
  const mark = html(doc, "div", "zai-brand-mark");
  mark.append(icon(doc, "spark"));
  const copy = html(doc, "div", "zai-brand-copy");
  copy.append(
    html(doc, "strong", "zai-brand-title", "AI 文献助手"),
    html(doc, "span", "zai-brand-subtitle", "在当前文献上连续追问"),
  );
  brand.append(mark, copy);
  const actions = html(doc, "div", "zai-header-actions");
  const newChat = action(doc, "新建对话", "plus");
  const settingsButton = action(doc, "模型设置", "settings");
  actions.append(newChat, settingsButton);
  header.append(brand, actions);

  const summary = html(doc, "summary", "zai-settings-summary");
  summary.append(icon(doc, "settings"), doc.createTextNode("模型设置"));
  const settingsGrid = html(doc, "div", "zai-settings-grid");
  const endpoint = field(
    doc,
    "接口地址",
    String(getPref("endpoint") || ""),
    "url",
  );
  const model = field(doc, "模型名称", String(getPref("model") || ""));
  const apiKey = field(
    doc,
    "API Key",
    String(getPref("apiKey") || ""),
    "password",
  );
  const stream = field(doc, "流式输出", "", "checkbox");
  stream.control.checked = Boolean(getPref("stream"));
  const fontScale = selectField(
    doc,
    "字体大小",
    String(getPref("fontScale") || "normal"),
    [
      ["small", "小"],
      ["normal", "标准"],
      ["large", "大"],
    ],
  );
  const save = html(doc, "button", "zai-primary-button", "保存设置");
  save.type = "button";
  const test = html(doc, "button", "zai-secondary-button", "检查配置");
  test.type = "button";
  const hint = html(
    doc,
    "p",
    "zai-settings-hint",
    "支持 OpenAI Chat Completions 兼容接口；API Key 仅保存在本机 Zotero 配置中。",
  );
  settingsGrid.append(
    endpoint.wrapper,
    model.wrapper,
    apiKey.wrapper,
    stream.wrapper,
    fontScale.wrapper,
    html(doc, "div", "zai-settings-buttons"),
  );
  (settingsGrid.lastElementChild as HTMLElement).append(save, test);
  settingsGrid.append(hint);
  const storageBox = html(doc, "div", "zai-storage-settings");
  const storageTitle = html(
    doc,
    "div",
    "zai-storage-title",
    "聊天记录 · 保存位置",
  );
  const storagePath = html(doc, "div", "zai-storage-path");
  const storageButtons = html(doc, "div", "zai-storage-buttons");
  const chooseFolder = html(
    doc,
    "button",
    "zai-secondary-button",
    "选择文件夹",
  );
  const openFolder = html(doc, "button", "zai-secondary-button", "打开目录");
  const backup = html(doc, "button", "zai-secondary-button", "创建备份");
  const restore = html(doc, "button", "zai-secondary-button", "恢复自动备份");
  const restoreFile = html(doc, "button", "zai-secondary-button", "从文件恢复");
  const defaultFolder = html(
    doc,
    "button",
    "zai-secondary-button",
    "使用默认位置",
  );
  for (const button of [
    chooseFolder,
    openFolder,
    backup,
    restore,
    restoreFile,
    defaultFolder,
  ])
    button.type = "button";
  storageButtons.append(
    chooseFolder,
    openFolder,
    backup,
    restore,
    restoreFile,
    defaultFolder,
  );
  storageBox.append(storageTitle, storagePath, storageButtons);
  settingsGrid.append(storageBox);
  const updateStoragePath = () => {
    const info = storageInfo();
    storagePath.textContent = info.custom ? info.path : `${info.path}（默认）`;
    storagePath.title = info.path;
    defaultFolder.hidden = !info.custom;
  };
  updateStoragePath();
  state.settings.append(summary, settingsGrid);

  const conversationBar = html(doc, "div", "zai-conversation-bar");
  conversationBar.append(
    html(doc, "span", "zai-bar-label", "对话"),
    state.select,
  );
  const deleteButton = action(
    doc,
    "删除当前对话",
    "trash",
    "zai-icon-button zai-danger-button",
  );
  conversationBar.append(deleteButton);
  const contextRow = html(doc, "div", "zai-context-row");
  const readFull = html(doc, "button", "zai-secondary-button", "阅读正文");
  readFull.type = "button";
  readFull.title = "按需提取 PDF 正文，不在打开文献时预读";
  const refreshContext = action(doc, "重新读取正文", "refresh");
  contextRow.append(state.contextLabel, readFull, refreshContext);
  state.contextLabel.textContent =
    "正文尚未读取 · 点击“阅读正文”或输入“阅读全文”";
  state.select.setAttribute("aria-label", "选择对话");
  state.question.rows = 3;
  state.question.value = state.conversation.draft;
  state.question.placeholder = "问问这篇文献…";
  state.question.setAttribute("aria-label", "问题");
  const fontClass = `zai-scale-${getPref("fontScale") || "normal"}`;
  root.classList.add(fontClass);
  state.status.setAttribute("role", "status");
  state.status.setAttribute("aria-live", "polite");
  state.transcript.setAttribute("role", "region");
  state.transcript.setAttribute("aria-label", "聊天记录");
  state.transcript.tabIndex = 0;
  const composer = html(doc, "div", "zai-composer");
  composer.append(state.question);
  const composerActions = html(doc, "div", "zai-composer-actions");
  const quote = html(doc, "button", "zai-secondary-button", "引用选文");
  quote.type = "button";
  quote.title = "插入 PDF 阅读器中选中的文字";
  state.ask.textContent = "提问";
  state.ask.type = "button";
  composerActions.append(quote, state.ask);
  composer.append(composerActions);
  const footnote = html(
    doc,
    "div",
    "zai-footnote",
    "Enter 发送 · Shift+Enter 换行 · AI 回答请核对原文",
  );
  const tools = html(doc, "div", "zai-chat-tools");
  const rename = action(doc, "重命名对话", "edit");
  const exportChat = action(doc, "复制整段对话为 Markdown", "export");
  tools.append(rename, exportChat);
  conversationBar.insertBefore(tools, deleteButton);
  state.warning.textContent = storageWarning();
  root.append(
    header,
    state.settings,
    conversationBar,
    contextRow,
    state.warning,
    state.transcript,
    composer,
    state.status,
    footnote,
  );
  body.append(root);
  panels.set(body, state);

  const unsubscribe = subscribeChats((changedKey) => {
    if (!changedKey || changedKey === itemKey) refreshFromStore(state);
  });
  state.cleanup = () => {
    state.disposed = true;
    unsubscribe();
    panels.delete(body);
  };
  populateSelect(state);
  renderTranscript(state);
  // Full text is deliberately loaded only after a click or the first submitted instruction.
  newChat.addEventListener("click", () => {
    setDraft(state.conversation, state.question.value);
    state.conversation = addConversation(itemKey);
    state.question.value = "";
    state.status.textContent = "";
    refreshFromStore(state);
    state.question.focus();
  });
  deleteButton.addEventListener("click", () => {
    if (
      (state.conversation.messages.length || state.conversation.draft) &&
      !doc.defaultView?.confirm("删除当前对话？此操作不可撤销。")
    )
      return;
    const job = jobs.get(state.conversation.id);
    if (job) {
      job.stopped = true;
      job.cancel?.();
      jobs.delete(state.conversation.id);
    }
    removeStoredConversation(itemKey, state.conversation.id);
    state.conversation = currentConversation(itemKey);
    state.question.value = state.conversation.draft;
    state.status.textContent = "";
    refreshFromStore(state);
  });
  state.select.addEventListener("change", () => {
    const selectedID = state.select.value;
    setDraft(state.conversation, state.question.value);
    selectConversation(itemKey, selectedID);
    state.conversation = conversationsFor(itemKey).find(
      (chat) => chat.id === selectedID,
    )!;
    state.question.value = state.conversation.draft;
    state.status.textContent = "";
    refreshFromStore(state);
  });
  rename.addEventListener("click", () => {
    const title = doc.defaultView
      ?.prompt("对话名称", state.conversation.title)
      ?.trim();
    if (title) {
      state.conversation.title = title.slice(0, 120);
      updateConversation(itemKey, state.conversation);
    }
  });
  exportChat.addEventListener("click", () => {
    copyText(
      `# ${state.conversation.title}\n\n${state.conversation.messages.map((message) => `## ${message.role === "user" ? "你" : "AI"}\n\n${message.text}`).join("\n\n")}`,
    );
    state.status.textContent = "整段对话已复制为 Markdown。";
  });
  settingsButton.addEventListener("click", () => {
    state.settings.open = !state.settings.open;
    if (state.settings.open) endpoint.control.focus();
  });
  save.addEventListener("click", () =>
    saveSettings(
      state,
      endpoint.control.value,
      model.control.value,
      apiKey.control.value,
      stream.control.checked,
      save,
    ),
  );
  fontScale.control.addEventListener("change", () => {
    setPref(
      "fontScale",
      fontScale.control.value as "small" | "normal" | "large",
    );
    root.classList.remove(
      "zai-scale-small",
      "zai-scale-normal",
      "zai-scale-large",
    );
    root.classList.add(`zai-scale-${fontScale.control.value}`);
  });
  chooseFolder.addEventListener(
    "click",
    () => void selectStorageFolder(state, doc, storagePath, updateStoragePath),
  );
  openFolder.addEventListener("click", () => void openStorageFolder(state));
  restore.addEventListener(
    "click",
    () => void restoreStorageBackup(state, doc, updateStoragePath),
  );
  backup.addEventListener("click", () => void createStorageBackup(state));
  restoreFile.addEventListener(
    "click",
    () => void restoreStorageFile(state, doc, updateStoragePath),
  );
  defaultFolder.addEventListener(
    "click",
    () => void useDefaultStorage(state, doc, updateStoragePath),
  );
  test.addEventListener("click", () => {
    try {
      normalizeEndpoint(endpoint.control.value);
      state.status.textContent =
        apiKey.control.value.trim() && model.control.value.trim()
          ? "配置格式正确，可以提问。"
          : "接口地址格式正确，但还缺少模型或 API Key。";
    } catch (error) {
      state.status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  });
  readFull.addEventListener("click", () => void loadContext(state));
  refreshContext.addEventListener("click", () => void loadContext(state));
  quote.addEventListener("click", () => void insertSelection(state));
  state.ask.addEventListener("click", () => void submit(state));
  state.question.addEventListener("input", () =>
    setDraft(state.conversation, state.question.value),
  );
  state.question.addEventListener("keydown", (event) => {
    const key = event as KeyboardEvent;
    if (
      key.key === "Enter" &&
      !key.shiftKey &&
      !key.isComposing &&
      key.keyCode !== 229
    ) {
      key.preventDefault();
      void submit(state);
    }
  });
}

function destroyPanel(body: HTMLElement) {
  panels.get(body)?.cleanup();
  panels.delete(body);
}
function field(doc: Document, labelText: string, value: string, type = "text") {
  const wrapper = html(doc, "label", "zai-field");
  const label = html(doc, "span", "zai-field-label", labelText);
  const control = html(doc, "input", "zai-field-input");
  control.type = type;
  control.value = value;
  control.spellcheck = false;
  if (type === "checkbox") {
    control.className = "zai-checkbox";
  }
  wrapper.append(label, control);
  return { wrapper, control };
}
function selectField(
  doc: Document,
  labelText: string,
  value: string,
  options: [string, string][],
) {
  const wrapper = html(doc, "label", "zai-field");
  const label = html(doc, "span", "zai-field-label", labelText);
  const control = html(doc, "select", "zai-field-input");
  for (const [optionValue, text] of options) {
    const option = html(doc, "option", "", text);
    option.value = optionValue;
    control.append(option);
  }
  control.value = value;
  wrapper.append(label, control);
  return { wrapper, control };
}

async function selectStorageFolder(
  state: PanelState,
  doc: Document,
  pathLabel: HTMLElement,
  update: () => void,
) {
  try {
    const path = await new addon.data.ztoolkit.FilePicker(
      "选择聊天记录保存文件夹",
      "folder",
      [],
      undefined,
      doc.defaultView || undefined,
    ).open();
    if (!path) return;
    pathLabel.textContent = "正在迁移聊天记录…";
    await chooseStorageDirectory(path);
    update();
    state.status.textContent = "聊天记录已迁移到新文件夹。";
  } catch (error) {
    state.status.textContent = `迁移失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function openStorageFolder(state: PanelState) {
  try {
    await openStorageDirectory();
    state.status.textContent = "已打开聊天记录目录。";
  } catch (error) {
    state.status.textContent = `打开目录失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function restoreStorageBackup(
  state: PanelState,
  doc: Document,
  update: () => void,
) {
  if (
    !doc.defaultView?.confirm(
      "用最近一次备份覆盖当前聊天记录？当前文件会先保留为 .bak。",
    )
  )
    return;
  try {
    await restoreBackup();
    update();
    refreshFromStore(state);
    state.status.textContent = "已从备份恢复聊天记录。";
  } catch (error) {
    state.status.textContent = `恢复失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function createStorageBackup(state: PanelState) {
  try {
    const backup = await createBackup();
    state.status.textContent = `聊天记录备份已创建：${backup}`;
  } catch (error) {
    state.status.textContent = `创建备份失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function restoreStorageFile(
  state: PanelState,
  doc: Document,
  update: () => void,
) {
  try {
    const selected = await new addon.data.ztoolkit.FilePicker(
      "选择聊天记录 JSON 备份",
      "open",
      [["JSON 备份", "*.json"]],
      undefined,
      doc.defaultView || undefined,
    ).open();
    if (!selected) return;
    if (
      !doc.defaultView?.confirm(
        "从所选备份恢复全部聊天记录？当前记录会先另存一份。",
      )
    )
      return;
    await restoreBackup(selected);
    update();
    refreshFromStore(state);
    state.status.textContent = "聊天记录已从文件恢复。";
  } catch (error) {
    state.status.textContent = `恢复失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function useDefaultStorage(
  state: PanelState,
  doc: Document,
  update: () => void,
) {
  if (!doc.defaultView?.confirm("将聊天记录迁移回 Zotero 默认配置目录？"))
    return;
  try {
    await resetStorageDirectory();
    update();
    refreshFromStore(state);
    state.status.textContent = "已恢复默认保存位置。";
  } catch (error) {
    state.status.textContent = `迁移失败：${error instanceof Error ? error.message : String(error)}`;
  }
}
function saveSettings(
  state: PanelState,
  endpoint: string,
  model: string,
  apiKey: string,
  stream: boolean,
  button: HTMLElement,
) {
  try {
    normalizeEndpoint(endpoint);
  } catch (error) {
    state.status.textContent =
      error instanceof Error ? error.message : String(error);
    return;
  }
  setPref("endpoint", endpoint.trim());
  setPref("model", model.trim());
  setPref("apiKey", apiKey.trim());
  setPref("stream", stream);
  button.textContent = "已保存";
  state.status.textContent = "模型设置已保存。";
  setTimeout(() => {
    button.textContent = "保存设置";
  }, 1200);
}
function populateSelect(state: PanelState) {
  state.select.replaceChildren();
  for (const conversation of conversationsFor(state.itemKey)) {
    const option = html(state.select.ownerDocument!, "option");
    option.value = conversation.id;
    option.textContent = conversation.title || DEFAULT_TITLE;
    state.select.append(option);
  }
  state.select.value = state.conversation.id;
}
function refreshFromStore(state: PanelState) {
  if (state.disposed) return;
  const next =
    conversationsFor(state.itemKey).find(
      (chat) => chat.id === state.conversation.id,
    ) || currentConversation(state.itemKey);
  const changed = state.conversation !== next;
  state.conversation = next;
  if (changed || state.question !== state.question.ownerDocument?.activeElement)
    state.question.value = next.draft;
  populateSelect(state);
  renderTranscript(state);
  state.warning.textContent = storageWarning();
  const job = jobs.get(next.id);
  state.ask.textContent = job?.busy ? "停止" : "提问";
  state.ask.classList.toggle("zai-stop-button", Boolean(job?.busy));
  if (job?.busy) state.status.textContent = "正在生成，切换对话后会在后台继续…";
  else if (job?.error) state.status.textContent = job.error;
  else if (job) state.status.textContent = "";
}
function renderTranscript(state: PanelState) {
  const nearBottom =
    state.transcript.scrollHeight -
      state.transcript.scrollTop -
      state.transcript.clientHeight <
    70;
  const previousScroll = state.transcript.scrollTop;
  state.transcript.replaceChildren();
  const job = jobs.get(state.conversation.id);
  if (!state.conversation.messages.length) {
    const doc = state.transcript.ownerDocument!;
    const welcome = html(doc, "div", "zai-welcome");
    welcome.append(
      html(doc, "div", "zai-welcome-icon", "✦"),
      html(doc, "strong", "", "一起读懂这篇文献"),
      html(doc, "span", "", "从一个问题开始，沿着证据继续追问。"),
    );
    const prompts = html(doc, "div", "zai-prompts");
    for (const label of [
      "阅读全文并概括核心问题与主要贡献",
      "阅读全文，解释研究方法与实验设计",
      "阅读全文，分析局限与待验证的结论",
    ]) {
      const chip = html(doc, "button", "zai-prompt", label);
      chip.type = "button";
      chip.addEventListener("click", () => {
        state.question.value = label;
        setDraft(state.conversation, label);
        state.question.focus();
      });
      prompts.append(chip);
    }
    welcome.append(prompts);
    state.transcript.append(welcome);
    return;
  }
  for (const message of state.conversation.messages)
    appendMessage(state, message);
  if (job?.busy || job?.text)
    state.transcript.append(liveMessage(state, job.text, !job.busy));
  if (job?.error && !job.busy) {
    const retry = html(
      state.transcript.ownerDocument!,
      "button",
      "zai-retry zai-secondary-button",
      "重试本次请求",
    );
    retry.type = "button";
    retry.addEventListener("click", () => void submit(state, true));
    state.transcript.append(retry);
  }
  state.transcript.scrollTop = nearBottom
    ? state.transcript.scrollHeight
    : previousScroll;
}
function appendMessage(state: PanelState, message: ChatMessage) {
  const doc = state.transcript.ownerDocument!;
  const block = html(doc, "article", `zai-message zai-${message.role}`);
  const heading = html(doc, "div", "zai-message-heading");
  const author = html(
    doc,
    "strong",
    "zai-message-author",
    message.role === "assistant" ? "AI" : "你",
  );
  heading.append(author);
  if (message.role === "assistant") {
    const copy = action(doc, "复制回答", "copy", "zai-message-action");
    copy.addEventListener("click", () => {
      copyText(message.text);
      state.status.textContent = "回答已复制。";
    });
    heading.append(copy);
  }
  const content = html(doc, "div", "zai-message-text");
  if (message.role === "assistant") renderMarkdown(content, message.text);
  else content.textContent = message.text;
  block.append(heading, content);
  state.transcript.append(block);
}
function liveMessage(state: PanelState, text: string, interrupted = false) {
  const doc = state.transcript.ownerDocument!;
  const live = html(doc, "article", "zai-message zai-assistant zai-live");
  const heading = html(
    doc,
    "div",
    "zai-message-heading",
    interrupted ? "AI · 未完成（尚未保存）" : "AI · 正在生成",
  );
  const content = html(doc, "div", "zai-message-text");
  renderMarkdown(content, text || "▍");
  live.append(heading, content);
  return live;
}
function loadContext(state: PanelState) {
  state.contextLabel.textContent = "正在读取文献…";
  state.context = readMetadata(state.item);
  const promise = (async () => {
    try {
      const context = await readDocument(state.item);
      state.context = context;
      if (state.disposed) return;
      state.contextLabel.textContent = context.text
        ? `正文已按需读取 · ${context.pages ? `${context.pages} 页 · ` : ""}${context.text.length.toLocaleString()} 字符`
        : "仅题名与摘要 · 正文尚未读取";
      state.contextLabel.title = context.title;
    } catch (error) {
      state.contextLabel.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  state.contextPromise = promise;
  return promise;
}
async function insertSelection(state: PanelState) {
  try {
    const reader = await addon.data.ztoolkit.Reader.getReader();
    const selected = reader
      ? addon.data.ztoolkit.Reader.getSelectedText(reader).trim()
      : "";
    if (!selected)
      throw new Error("没有检测到选中文字，请先在 PDF 中选择一段文字。");
    state.question.value =
      `${state.question.value.trim()}\n\n引用文本：\n${selected}`.trim();
    setDraft(state.conversation, state.question.value);
    state.question.focus();
    state.status.textContent = "已插入选中文字。";
  } catch (error) {
    state.status.textContent =
      error instanceof Error ? error.message : String(error);
  }
}
async function submit(state: PanelState, retry = false) {
  const previous = jobs.get(state.conversation.id);
  if (previous?.busy) {
    previous.stopped = true;
    previous.cancel?.();
    return;
  }
  const last = state.conversation.messages.at(-1);
  const question =
    retry && last?.role === "user" ? last.text : state.question.value.trim();
  if (!question) return;
  if (question.length > 12000) {
    state.status.textContent = "问题与选文合计请控制在 12,000 字符以内。";
    return;
  }
  let endpoint: string;
  try {
    endpoint = normalizeEndpoint(String(getPref("endpoint") || ""));
  } catch {
    state.settings.open = true;
    state.status.textContent = "请先在模型设置中填写完整的接口地址。";
    return;
  }
  const apiKey = String(getPref("apiKey") || "").trim();
  const model = String(getPref("model") || "").trim();
  if (!apiKey || !model) {
    state.settings.open = true;
    state.status.textContent = "请先填写模型名称和 API Key。";
    return;
  }
  const conversation = state.conversation;
  if (!hasConversation(state.itemKey, conversation)) return;
  if (conversation.title === DEFAULT_TITLE) {
    conversation.title = question.replace(/\s+/g, " ").slice(0, 28);
  }
  const user: ChatMessage = {
    role: "user",
    text: question,
    createdAt: Date.now(),
  };
  if (previous?.error && last?.role === "user") last.text = question;
  else conversation.messages.push(user);
  conversation.draft = "";
  state.question.value = "";
  const job: ChatJob = { busy: true, text: "", error: "", stopped: false };
  jobs.set(conversation.id, job);
  updateConversation(state.itemKey, conversation);
  // A normal question can use metadata only. Explicit reading requests trigger full-text extraction.
  const fullText = requestsReading(question);
  if (fullText) await loadContext(state);
  await state.contextPromise;
  if (fullText && !state.context?.text) {
    job.busy = false;
    job.error = state.contextLabel.textContent || "正文读取失败";
    updateConversation(state.itemKey, conversation);
    return;
  }
  if (job.stopped || !hasConversation(state.itemKey, conversation)) {
    job.busy = false;
    job.error = "已停止生成";
    notifyChats(state.itemKey);
    return;
  }
  const source = state.context || {
    title: "",
    metadata: "",
    text: "",
    truncated: false,
    source: "metadata" as const,
  };
  const context = selectContext(source);
  state.contextLabel.textContent = `文献上下文 · ${context.label}`;
  let updateTimer: ReturnType<typeof setTimeout> | undefined;
  const request = requestAnswer(
    { endpoint, apiKey, model, stream: Boolean(getPref("stream")) },
    buildMessages(conversation.messages, context.content),
    (text) => {
      if (job.stopped) return;
      job.text = text;
      if (!updateTimer)
        updateTimer = setTimeout(() => {
          updateTimer = undefined;
          notifyChats(state.itemKey);
        }, 90);
    },
  );
  job.cancel = request.cancel;
  try {
    const answer = await request.promise;
    if (!job.stopped && hasConversation(state.itemKey, conversation)) {
      conversation.messages.push({
        role: "assistant",
        text: answer,
        createdAt: Date.now(),
      });
      job.text = "";
    }
  } catch (error) {
    job.error = job.stopped
      ? "已停止生成，可以重试。"
      : `请求失败：${error instanceof Error ? error.message : "网络连接失败或请求超时，请检查网络后重试。"}`;
  } finally {
    if (updateTimer) clearTimeout(updateTimer);
    job.busy = false;
    job.cancel = undefined;
    if (job.stopped) job.error = "已停止生成，可以重试。";
    updateConversation(state.itemKey, conversation);
  }
}
