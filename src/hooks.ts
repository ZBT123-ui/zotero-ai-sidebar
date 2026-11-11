import { registerAISidebar, unregisterAISidebar } from "./modules/aiSidebar";
import { flushChatStore } from "./modules/chatStore";
import {
  loadSidebarStyles,
  unloadSidebarStyles,
} from "./modules/sidebarStyles";
let retryTimer: ReturnType<typeof setTimeout> | undefined;

async function onStartup() {
  await Promise.all([Zotero.initializationPromise, Zotero.uiReadyPromise]);
  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );
  await tryRegisterAISidebar();
  // A restored reader tab can finish creating its item pane after startup.
  // Retry once so the custom section is added to that pane as well.
  retryTimer = setTimeout(() => void tryRegisterAISidebar(), 800);
  addon.data.initialized = true;
}

async function tryRegisterAISidebar() {
  if (!addon.data.alive) return;
  try {
    await registerAISidebar();
  } catch (error) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
  }
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow) {
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );
  loadSidebarStyles(win.document);
}

async function onMainWindowUnload(win: Window) {
  unloadSidebarStyles(win.document);
  await flushChatStore();
}

async function onShutdown() {
  if (retryTimer) clearTimeout(retryTimer);
  unregisterAISidebar();
  unloadSidebarStyles();
  await flushChatStore();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onAppShutdown() {
  unregisterAISidebar();
  await flushChatStore();
}
export default {
  onStartup,
  onShutdown,
  onAppShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
