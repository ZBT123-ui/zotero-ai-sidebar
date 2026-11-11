import { getPref, setPref } from "../utils/prefs";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  draft: string;
  updatedAt: number;
}

interface ChatData {
  version: 1;
  items: Record<string, Conversation[]>;
  active: Record<string, string>;
}

export function createConversation(): Conversation {
  return {
    id: `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: "新对话",
    messages: [],
    draft: "",
    updatedAt: Date.now(),
  };
}

// Validate every stored field before any panel sees it. Never overwrite an unreadable original.
export function decodeStore(raw: unknown): ChatData {
  const value = raw as ChatData;
  if (
    !value ||
    value.version !== 1 ||
    !value.items ||
    typeof value.items !== "object" ||
    Array.isArray(value.items)
  )
    throw new Error("聊天文件格式不正确");
  const items: ChatData["items"] = Object.create(null);
  for (const [key, chats] of Object.entries(value.items)) {
    if (!Array.isArray(chats)) throw new Error("对话列表格式不正确");
    const ids = new Set<string>();
    items[key] = chats.map((chat) => {
      if (
        !chat ||
        typeof chat.id !== "string" ||
        ids.has(chat.id) ||
        typeof chat.title !== "string" ||
        !Array.isArray(chat.messages)
      )
        throw new Error("对话格式不正确");
      ids.add(chat.id);
      const messages = chat.messages.map((message) => {
        if (
          !message ||
          !["user", "assistant"].includes(message.role) ||
          typeof message.text !== "string"
        )
          throw new Error("消息格式不正确");
        return {
          role: message.role,
          text: message.text,
          createdAt: Number(message.createdAt) || 0,
        };
      });
      return {
        id: chat.id,
        title: chat.title,
        messages,
        draft: typeof chat.draft === "string" ? chat.draft : "",
        updatedAt: Number(chat.updatedAt) || 0,
      };
    });
  }
  const active: Record<string, string> = Object.create(null);
  for (const [key, id] of Object.entries(value.active || {}))
    if (typeof id === "string") active[key] = id;
  return { version: 1, items, active };
}

const FILE_NAME = "zotero-ai-sidebar-chats.json";
const SAVE_WARNING_PREFIX = "聊天记录暂未保存";
let data: ChatData = {
  version: 1,
  items: Object.create(null),
  active: Object.create(null),
};
let path = "";
let initial: Promise<void> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let draftTimer: ReturnType<typeof setTimeout> | undefined;
let revision = 0;
let savedRevision = 0;
let warning = "";
const listeners = new Set<(itemKey?: string) => void>();
let fileIO: typeof IOUtils;
const io = () => fileIO;

function profileFilePath(name: string) {
  const file = Zotero.getProfileDirectory().clone();
  file.append(name);
  return file.path;
}

function directoryFilePath(directory: string, name: string) {
  const file = Zotero.File.pathToFile(directory);
  file.append(name);
  return file.path;
}

export function storageInfo() {
  return {
    path,
    directory: path ? Zotero.File.pathToFile(path).parent!.path : "",
    custom: Boolean(String(getPref("chatDirectory") || "").trim()),
  };
}

export async function chooseStorageDirectory(directory: string) {
  const selected = directory.trim();
  if (!selected) throw new Error("没有选择文件夹。");
  return migrateDirectory(selected, selected);
}

export async function resetStorageDirectory() {
  return migrateDirectory(Zotero.getProfileDirectory().path, "");
}

export async function openStorageDirectory() {
  const directory = storageInfo().directory;
  if (directory) Zotero.launchFile(directory);
  return directory;
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.catch(() => undefined).then(operation);
  queue = result.catch(() => undefined);
  return result;
}

function mergeStores(current: ChatData, incoming: ChatData): ChatData {
  const merged = decodeStore(JSON.parse(JSON.stringify(current)));
  for (const [key, chats] of Object.entries(incoming.items)) {
    const destination = (merged.items[key] ||= []);
    for (const chat of chats) {
      const existing = destination.find((entry) => entry.id === chat.id);
      if (!existing) destination.push(chat);
      else if (JSON.stringify(existing) !== JSON.stringify(chat))
        destination.push({
          ...chat,
          id: createConversation().id,
          title: chat.title + "（原目录副本）",
        });
    }
    if (!merged.active[key] && incoming.active[key])
      merged.active[key] = incoming.active[key];
  }
  return merged;
}

async function migrateDirectory(directory: string, preference: string) {
  await initChatStore();
  const target = directoryFilePath(directory, FILE_NAME);
  await enqueue(async () => {
    if (!(await io().exists(directory)))
      throw new Error("选择的文件夹不存在或无法访问。");
    if (Zotero.File.pathToFile(path).equals(Zotero.File.pathToFile(target))) {
      setPref("chatDirectory", preference);
      return;
    }
    let incoming: ChatData | undefined;
    if (await io().exists(target)) {
      incoming = decodeStore(await io().readJSON(target));
      await io().copy(
        target,
        target + ".before-migration-" + Date.now() + ".json",
      );
    }
    const merged = incoming
      ? mergeStores(data, incoming)
      : decodeStore(JSON.parse(JSON.stringify(data)));
    await io().writeUTF8(target, JSON.stringify(merged), {
      tmpPath: target + ".tmp",
      flush: true,
    });
    // Only commit the location after the destination is readable and valid.
    decodeStore(await io().readJSON(target));
    setPref("chatDirectory", preference);
    path = target;
    // Preserve live conversation objects so pending answers keep their original destination.
    if (incoming) {
      for (const [key, chats] of Object.entries(merged.items)) {
        const current = (data.items[key] ||= []);
        for (const chat of chats)
          if (!current.some((entry) => entry.id === chat.id))
            current.push(chat);
        if (!data.active[key]) data.active[key] = merged.active[key];
      }
    }
    warning = "";
    revision++;
    savedRevision = -1;
  });
  await persist();
  notifyChats();
  return storageInfo();
}

export async function createBackup() {
  await flushChatStore();
  return enqueue(async () => {
    const destination = path + ".backup-" + Date.now() + ".json";
    await io().writeUTF8(destination, JSON.stringify(data), {
      tmpPath: destination + ".tmp",
      flush: true,
    });
    return destination;
  });
}

export async function restoreBackup(filePath?: string) {
  await initChatStore();
  await enqueue(async () => {
    const backupPath = filePath || path + ".bak";
    if (!(await io().exists(backupPath)))
      throw new Error("还没有找到聊天记录备份文件，请选择 JSON 备份。");
    const restored = decodeStore(await io().readJSON(backupPath));
    const beforeRestore = path + ".before-restore-" + Date.now() + ".json";
    await io().writeUTF8(beforeRestore, JSON.stringify(data), {
      tmpPath: beforeRestore + ".tmp",
      flush: true,
    });
    await io().writeUTF8(path, JSON.stringify(restored), {
      tmpPath: path + ".tmp",
      backupFile: path + ".bak",
      flush: true,
    });
    data = restored;
    revision++;
    savedRevision = revision;
    warning = "";
  });
  notifyChats();
  return storageInfo();
}

export function initChatStore() {
  if (!initial) initial = load();
  return initial;
}

async function load() {
  fileIO = addon.data.ztoolkit.getGlobal("IOUtils") as typeof IOUtils;
  // IOUtils requires native paths: mixing '\\' and '/' fails on Windows.
  const customDirectory = String(getPref("chatDirectory") || "").trim();
  path = customDirectory
    ? directoryFilePath(customDirectory, FILE_NAME)
    : profileFilePath(FILE_NAME);
  try {
    if (customDirectory && !(await io().exists(customDirectory))) {
      path = profileFilePath(FILE_NAME);
      setPref("chatDirectory", "");
      warning =
        "自定义聊天记录目录当前不可用；暂时使用 Zotero 默认目录，请在设置中重新选择保存位置。";
    }
    if (await io().exists(path)) data = decodeStore(await io().readJSON(path));
  } catch {
    // Preserve corrupt originals before replacing them, and try the previous atomic-write backup.
    try {
      await io().copy(path, `${path}.unreadable-${Date.now()}`);
      try {
        data = decodeStore(await io().readJSON(`${path}.bak`));
      } catch {
        /* Start clean with the unreadable original preserved. */
      }
      warning = "原聊天文件读取失败，已另存原文件并尝试恢复备份。";
    } catch {
      path = customDirectory
        ? directoryFilePath(
            customDirectory,
            "zotero-ai-sidebar-chats-recovered.json",
          )
        : profileFilePath("zotero-ai-sidebar-chats-recovered.json");
      try {
        if (await io().exists(path))
          data = decodeStore(await io().readJSON(path));
      } catch {
        /* Writes will show an error if this location is also unavailable. */
      }
      warning = "原聊天文件无法读写，已保留；当前使用 recovered 恢复文件。";
    }
  }
}

export function storageWarning() {
  return warning;
}
export function subscribeChats(listener: (itemKey?: string) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notifyChats(itemKey?: string) {
  for (const listener of listeners) {
    try {
      listener(itemKey);
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}

export function conversationsFor(itemKey: string) {
  if (!data.items[itemKey]?.length) {
    data.items[itemKey] = [createConversation()];
    data.active[itemKey] = data.items[itemKey][0].id;
    saveChatStore();
  }
  return data.items[itemKey];
}
export function currentConversation(itemKey: string) {
  const chats = conversationsFor(itemKey);
  return chats.find((chat) => chat.id === data.active[itemKey]) || chats[0];
}
export function selectConversation(itemKey: string, id: string) {
  if (!conversationsFor(itemKey).some((chat) => chat.id === id)) return;
  data.active[itemKey] = id;
  saveChatStore();
  notifyChats(itemKey);
}
export function addConversation(itemKey: string) {
  const chat = createConversation();
  conversationsFor(itemKey).unshift(chat);
  selectConversation(itemKey, chat.id);
  return chat;
}
export function removeConversation(itemKey: string, id: string) {
  const chats = conversationsFor(itemKey);
  const index = chats.findIndex((chat) => chat.id === id);
  if (index < 0) return;
  chats.splice(index, 1);
  if (!chats.length) chats.push(createConversation());
  if (data.active[itemKey] === id) data.active[itemKey] = chats[0].id;
  saveChatStore();
  notifyChats(itemKey);
}
export function hasConversation(itemKey: string, chat: Conversation) {
  return data.items[itemKey]?.includes(chat) || false;
}
export function updateConversation(itemKey: string, chat: Conversation) {
  if (!hasConversation(itemKey, chat)) return;
  chat.updatedAt = Date.now();
  saveChatStore();
  notifyChats(itemKey);
}
export function setDraft(chat: Conversation, text: string) {
  chat.draft = text;
  revision++;
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = undefined;
    void persist();
  }, 450);
}
export function saveChatStore() {
  revision++;
  return persist();
}
function persist() {
  if (!path || savedRevision === revision) return queue;
  return enqueue(async () => {
    if (savedRevision === revision) return;
    const version = revision;
    const snapshot = JSON.stringify(data);
    try {
      await io().writeUTF8(path, snapshot, {
        tmpPath: `${path}.tmp`,
        backupFile: `${path}.bak`,
        flush: true,
      });
      savedRevision = version;
      if (warning.startsWith(SAVE_WARNING_PREFIX)) {
        warning = "";
        notifyChats();
      }
    } catch (error) {
      savedRevision = -1;
      const detail = String(error).replace(/\s+/g, " ").slice(0, 240);
      const message = `${SAVE_WARNING_PREFIX}（${detail}）；当前记录仍在内存中。`;
      if (warning !== message) Zotero.logError(new Error(message));
      warning = message;
      notifyChats();
    }
  });
}
export async function flushChatStore() {
  if (draftTimer) {
    clearTimeout(draftTimer);
    draftTimer = undefined;
  }
  await persist();
  await queue;
}
