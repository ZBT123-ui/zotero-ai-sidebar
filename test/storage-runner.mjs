import { build } from "esbuild";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import process from "node:process";
import console from "node:console";

const root = process.cwd();
const workspace = path.join(root, "work", `storage-test-${Date.now()}`);
const addonDir = path.join(workspace, "addon");
const profile = path.join(workspace, "profile");
const dataDir = path.join(workspace, "data");
await Promise.all([
  mkdir(addonDir, { recursive: true }),
  mkdir(path.join(profile, "extensions"), { recursive: true }),
  mkdir(dataDir, { recursive: true }),
]);
await build({
  entryPoints: ["src/modules/chatStore.ts"],
  outfile: path.join(addonDir, "chatStore.js"),
  bundle: true,
  format: "iife",
  globalName: "ChatStore",
  target: "firefox115",
});
await copyFile("test/storage-runtime.js", path.join(addonDir, "bootstrap.js"));
await writeFile(
  path.join(addonDir, "manifest.json"),
  JSON.stringify({
    manifest_version: 2,
    name: "AI Sidebar Storage Regression Tests",
    version: "1.0",
    applications: {
      zotero: {
        id: "ai-sidebar-storage-tests@local",
        strict_min_version: "10.0",
        strict_max_version: "10.9.9",
        update_url: "https://example.org/ai-sidebar-tests-update.json",
      },
    },
  }),
);
const archive = new AdmZip();
archive.addLocalFolder(addonDir);
archive.writeZip(
  path.join(profile, "extensions", "ai-sidebar-storage-tests@local.xpi"),
);
const prefs = {
  "extensions.zotero.useDataDir": true,
  "extensions.zotero.dataDir": dataDir,
  "extensions.autoDisableScopes": 0,
  "extensions.enabledScopes": 5,
  "extensions.experiments.enabled": true,
  "extensions.zotero.firstRun2": false,
  "extensions.zotero.firstRunGuidance": false,
  "extensions.zotero.firstRun.skipFirefoxProfileAccessCheck": true,
  "extensions.zotero.httpServer.enabled": false,
  "extensions.zotero.sync.autoSync": false,
  "extensions.zotero.automaticScraperUpdates": false,
  "extensions.zoteroWinWordIntegration.skipInstallation": true,
  "extensions.zoteroOpenOfficeIntegration.skipInstallation": true,
  "app.update.enabled": false,
  "extensions.update.enabled": false,
  "xpinstall.signatures.required": false,
};
await writeFile(
  path.join(profile, "user.js"),
  Object.entries(prefs)
    .map(
      ([key, value]) =>
        `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
    )
    .join("\n"),
);
const binary =
  process.env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH ||
  "C:\\Program Files\\Zotero\\zotero.exe";
const resultFile = path.join(profile, "storage-test-result.json");
console.log(JSON.stringify({ binary, profile, resultFile }));
