/* global Zotero, IOUtils, Services, Ci, setTimeout, clearTimeout */
/* exported install, uninstall, shutdown, startup */
/* eslint-disable no-unused-vars -- Zotero calls these bootstrap hooks by name. */

function install() {}
function uninstall() {}
function shutdown() {}

async function startup({ rootURI }) {
  await Zotero.initializationPromise;
  // Headless Zotero does not resolve uiReadyPromise, while this test only uses
  // the profile and IOUtils APIs.
  const profile = Zotero.getProfileDirectory();
  const results = [];
  const errors = [];
  const nativePath = (dir, name) => {
    const file = dir.clone();
    file.append(name);
    return file.path;
  };
  const assert = (value, message) => {
    if (!value) throw new Error(message);
    results.push(message);
  };
  const loadModule = (dir, fileIO = IOUtils) => {
    const prefs = new Map();
    const asFile = (value) => {
      const initialPath = typeof value === "string" ? value : value.path;
      const file = {
        path: initialPath,
        clone: () => asFile(file.path),
        append: (name) => {
          file.path = file.path + "\\" + name;
          return file;
        },
        equals: (other) =>
          other && other.path.toLowerCase() === file.path.toLowerCase(),
        get parent() {
          const index = Math.max(
            file.path.lastIndexOf("\\"),
            file.path.lastIndexOf("/"),
          );
          return index > 0 ? asFile(file.path.slice(0, index)) : null;
        },
      };
      return file;
    };
    const scope = {
      Zotero: {
        getProfileDirectory: () => dir.clone(),
        logError: (error) => errors.push(String(error)),
        Prefs: {
          get: (key) => prefs.get(key),
          set: (key, value) => prefs.set(key, value),
        },
        File: { pathToFile: (value) => asFile(value) },
      },
      addon: { data: { ztoolkit: { getGlobal: () => fileIO } } },
      setTimeout,
      clearTimeout,
    };
    Services.scriptloader.loadSubScript(`${rootURI}chatStore.js`, scope);
    return scope.ChatStore;
  };
  const scenarioDir = async (name) => {
    const file = profile.clone();
    file.append(name);
    await IOUtils.makeDirectory(file.path);
    return file;
  };
  let failure;
  try {
    const directory = await scenarioDir("roundtrip");
    const store = loadModule(directory);
    await store.initChatStore();
    const first = store.currentConversation("paper-1");
    first.title = "中文保存测试";
    first.messages.push({
      role: "user",
      text: "保存后重新打开还能看到吗？",
      createdAt: Date.now(),
    });
    store.updateConversation("paper-1", first);
    const second = store.addConversation("paper-1");
    second.messages.push({
      role: "assistant",
      text: "第二个对话独立保存",
      createdAt: Date.now(),
    });
    store.updateConversation("paper-1", second);
    store.setDraft(first, "未发送的中文草稿");
    await store.flushChatStore();
    const savedPath = nativePath(directory, "zotero-ai-sidebar-chats.json");
    assert(
      await IOUtils.exists(savedPath),
      "native-path file created in Zotero",
    );
    assert(!store.storageWarning(), "no save warning after actual disk write");
    assert(
      (await IOUtils.readJSON(savedPath)).items["paper-1"].length === 2,
      "two conversations saved together",
    );
    assert(
      await IOUtils.exists(`${savedPath}.bak`),
      "backup created on subsequent writes",
    );
    const reloaded = loadModule(directory);
    await reloaded.initChatStore();
    const restored = reloaded
      .conversationsFor("paper-1")
      .find((chat) => chat.id === first.id);
    assert(
      restored.messages[0].text === first.messages[0].text &&
        restored.draft === first.draft,
      "fresh module restores Chinese messages and draft",
    );
    assert(
      reloaded.currentConversation("paper-1").id === second.id,
      "active conversation survives reload",
    );
    const otherPaper = reloaded.currentConversation("paper-2");
    assert(
      otherPaper.id !== restored.id && !otherPaper.messages.length,
      "documents retain separate conversations",
    );
    reloaded.removeConversation("paper-1", second.id);
    await reloaded.flushChatStore();
    assert(
      (await IOUtils.readJSON(savedPath)).items["paper-1"].every(
        (chat) => chat.id !== second.id,
      ),
      "deleted conversation removed from disk",
    );

    const failureDir = await scenarioDir("failure-retry");
    let failWrites = true;
    const failingIO = {
      exists: (...args) => IOUtils.exists(...args),
      readJSON: (...args) => IOUtils.readJSON(...args),
      copy: (...args) => IOUtils.copy(...args),
      writeUTF8: (...args) =>
        failWrites
          ? Promise.reject(new Error("simulated write failure"))
          : IOUtils.writeUTF8(...args),
    };
    const retryStore = loadModule(failureDir, failingIO);
    await retryStore.initChatStore();
    const unsaved = retryStore.currentConversation("paper-3");
    unsaved.messages.push({
      role: "user",
      text: "must survive failed write",
      createdAt: Date.now(),
    });
    retryStore.updateConversation("paper-3", unsaved);
    await retryStore.flushChatStore();
    assert(
      retryStore.storageWarning().includes("simulated write failure"),
      "save warning retains actual failure reason",
    );
    assert(
      !retryStore.storageWarning().includes("磁盘权限"),
      "generic write error does not blame permissions",
    );
    failWrites = false;
    await retryStore.flushChatStore();
    assert(!retryStore.storageWarning(), "successful retry clears warning");
    assert(
      (
        await IOUtils.readJSON(
          nativePath(failureDir, "zotero-ai-sidebar-chats.json"),
        )
      ).items["paper-3"][0].messages.length === 1,
      "retry saves in-memory conversation",
    );

    const corruptDir = await scenarioDir("corrupt-recovery");
    const corruptPath = nativePath(corruptDir, "zotero-ai-sidebar-chats.json");
    await IOUtils.writeUTF8(corruptPath, "invalid-json");
    const recovery = loadModule(corruptDir);
    await recovery.initChatStore();
    recovery.currentConversation("paper-4");
    await recovery.flushChatStore();
    const preserved = (await IOUtils.getChildren(corruptDir.path)).find(
      (path) => path.includes(".unreadable-"),
    );
    assert(
      preserved && (await IOUtils.readUTF8(preserved)) === "invalid-json",
      "corrupt original preserved with native backup path",
    );
    assert(
      (await IOUtils.readJSON(corruptPath)).items["paper-4"].length === 1,
      "recovery writes valid JSON using native path",
    );

    const lockedDir = await scenarioDir("recovery-path");
    const recoveryPath = nativePath(
      lockedDir,
      "zotero-ai-sidebar-chats-recovered.json",
    );
    await IOUtils.writeUTF8(
      nativePath(lockedDir, "zotero-ai-sidebar-chats.json"),
      "invalid-json",
    );
    const lockedIO = {
      exists: (...args) => IOUtils.exists(...args),
      readJSON: (...args) => IOUtils.readJSON(...args),
      copy: () => Promise.reject(new Error("cannot copy original")),
      writeUTF8: (...args) => IOUtils.writeUTF8(...args),
    };
    const fallback = loadModule(lockedDir, lockedIO);
    await fallback.initChatStore();
    const recovered = fallback.currentConversation("paper-5");
    recovered.messages.push({
      role: "user",
      text: "fallback record",
      createdAt: Date.now(),
    });
    fallback.updateConversation("paper-5", recovered);
    await fallback.flushChatStore();
    assert(
      await IOUtils.exists(recoveryPath),
      "fallback recovery file uses native path",
    );
    const fallbackReload = loadModule(lockedDir, lockedIO);
    await fallbackReload.initChatStore();
    assert(
      fallbackReload.currentConversation("paper-5").messages[0].text ===
        "fallback record",
      "fallback recovery survives reload",
    );
  } catch (error) {
    failure = String(error) + "\n" + error.stack;
  }
  await IOUtils.writeJSON(nativePath(profile, "storage-test-result.json"), {
    version: Zotero.version,
    passed: results,
    failure: failure || null,
    expectedErrors: errors,
  });
  Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
}
