import assert from "node:assert/strict";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import console from "node:console";
import os from "node:os";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import vm from "node:vm";
import { build } from "esbuild";

const root = await mkdtemp(
  path.join(os.tmpdir(), "zotero-ai-sidebar-storage-"),
);
const profile = path.join(root, "profile");
const destination = path.join(root, "external-storage");
await Promise.all([mkdir(profile), mkdir(destination)]);

function nativeFile(value) {
  const file = {
    path: path.resolve(typeof value === "string" ? value : value.path),
    clone() {
      return nativeFile(this.path);
    },
    append(name) {
      this.path = path.join(this.path, name);
      return this;
    },
    equals(other) {
      return (
        path.resolve(this.path).toLowerCase() ===
        path.resolve(other.path).toLowerCase()
      );
    },
    get parent() {
      const parent = path.dirname(this.path);
      return parent === this.path ? null : nativeFile(parent);
    },
  };
  return file;
}

const baseIO = {
  async exists(filePath) {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  },
  async readJSON(filePath) {
    return JSON.parse(await readFile(filePath, "utf8"));
  },
  async readUTF8(filePath) {
    return readFile(filePath, "utf8");
  },
  async copy(source, target) {
    return copyFile(source, target);
  },
  async getChildren(directory) {
    return (await readdir(directory)).map((name) => path.join(directory, name));
  },
  async writeUTF8(filePath, value, options = {}) {
    if (options.backupFile && (await this.exists(filePath)))
      await copyFile(filePath, options.backupFile);
    if (options.tmpPath) {
      await writeFile(options.tmpPath, value, "utf8");
      await rename(options.tmpPath, filePath);
    } else await writeFile(filePath, value, "utf8");
  },
};

const bundle = await build({
  entryPoints: ["src/modules/chatStore.ts"],
  bundle: true,
  format: "iife",
  globalName: "ChatStore",
  target: "firefox115",
  write: false,
});

function loadStore(initialDirectory = "", fileIO = baseIO) {
  const preferences = new Map([
    ["extensions.zotero.zoteroAISidebar.chatDirectory", initialDirectory],
  ]);
  const scope = {
    Zotero: {
      getProfileDirectory: () => nativeFile(profile),
      File: { pathToFile: nativeFile },
      Prefs: {
        get: (key) => preferences.get(key),
        set: (key, value) => preferences.set(key, value),
      },
      logError: (error) => console.error(error),
    },
    addon: { data: { ztoolkit: { getGlobal: () => fileIO } } },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(bundle.outputFiles[0].text, scope);
  return { store: scope.ChatStore, preferences };
}

try {
  const local = loadStore();
  await local.store.initChatStore();
  const sourceChat = local.store.currentConversation("source-item");
  sourceChat.title = "源目录对话";
  sourceChat.messages.push({
    role: "user",
    text: "原目录内容",
    createdAt: Date.now(),
  });
  local.store.updateConversation("source-item", sourceChat);
  await local.store.flushChatStore();

  const existing = loadStore(destination);
  await existing.store.initChatStore();
  const destinationChat = existing.store.currentConversation("existing-item");
  destinationChat.title = "目标目录对话";
  destinationChat.messages.push({
    role: "assistant",
    text: "已有内容",
    createdAt: Date.now(),
  });
  existing.store.updateConversation("existing-item", destinationChat);
  await existing.store.flushChatStore();

  await local.store.chooseStorageDirectory(destination);
  assert.equal(local.store.storageInfo().directory, destination);
  assert.equal(
    local.preferences.get("extensions.zotero.zoteroAISidebar.chatDirectory"),
    destination,
  );
  const migratedPath = path.join(destination, "zotero-ai-sidebar-chats.json");
  let migrated = await baseIO.readJSON(migratedPath);
  assert.equal(migrated.items["source-item"][0].title, "源目录对话");
  assert.equal(migrated.items["existing-item"][0].title, "目标目录对话");

  const backupPath = await local.store.createBackup();
  assert.equal(
    (await baseIO.readJSON(backupPath)).items["source-item"][0].title,
    "源目录对话",
  );
  sourceChat.title = "修改后的标题";
  local.store.updateConversation("source-item", sourceChat);
  await local.store.flushChatStore();
  await local.store.restoreBackup(backupPath);
  assert.equal(
    local.store.currentConversation("source-item").title,
    "源目录对话",
  );
  assert.ok(
    (await baseIO.getChildren(destination)).some((filePath) =>
      filePath.includes(".before-restore-"),
    ),
  );

  await local.store.resetStorageDirectory();
  assert.equal(local.store.storageInfo().directory, profile);
  assert.equal(local.store.storageInfo().custom, false);
  migrated = await baseIO.readJSON(
    path.join(profile, "zotero-ai-sidebar-chats.json"),
  );
  assert.equal(migrated.items["source-item"][0].title, "源目录对话");
  assert.equal(migrated.items["existing-item"][0].title, "目标目录对话");
  console.log(
    "PASS: custom storage migration, merge, backup, restore, and reset",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
