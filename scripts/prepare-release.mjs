import { execFileSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const tag = `v${pkg.version}`;
const repository = "https://github.com/ZBT123-ui/zotero-ai-sidebar";
const buildDirectory = ".scaffold/build";
const output = "release-assets";
const xpiName = `${pkg.name}-${pkg.version}.xpi`;
const sourceName = `${pkg.name}-${pkg.version}-source.zip`;
const manifest = JSON.parse(
  await readFile(`${buildDirectory}/addon/manifest.json`, "utf8"),
);
const update = JSON.parse(
  await readFile(`${buildDirectory}/update.json`, "utf8"),
);
const xpi = await readFile(`${buildDirectory}/${pkg.name}.xpi`);
const entries = update.addons[pkg.config.addonID]?.updates;
const current = entries?.find((entry) => entry.version === pkg.version);
const expectedLink = `${repository}/releases/download/${tag}/${xpiName}`;
const expectedHash = `sha512:${createHash("sha512").update(xpi).digest("hex")}`;
if (
  manifest.version !== pkg.version ||
  manifest.applications.zotero.id !== pkg.config.addonID ||
  manifest.applications.zotero.update_url !==
    `${repository}/releases/latest/download/update.json` ||
  current?.update_link !== expectedLink ||
  current?.update_hash !== expectedHash
)
  throw new Error(
    "Release metadata does not match the built installation file",
  );

const status = execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
});
if (status.trim())
  throw new Error(
    "Commit the release sources before creating the source archive",
  );

await mkdir(output, { recursive: true });
await copyFile(`${buildDirectory}/${pkg.name}.xpi`, path.join(output, xpiName));
await copyFile(
  `${buildDirectory}/update.json`,
  path.join(output, "update.json"),
);
execFileSync("git", [
  "archive",
  "--format=zip",
  `--prefix=${pkg.name}-${tag}/`,
  "-o",
  path.join(output, sourceName),
  "HEAD",
]);
const files = [xpiName, sourceName, "update.json"];
const checksums = await Promise.all(
  files.map(async (name) => {
    const bytes = await readFile(path.join(output, name));
    return `${createHash("sha256").update(bytes).digest("hex")}  ${name}`;
  }),
);
await writeFile(
  path.join(output, "SHA256SUMS.txt"),
  checksums.join("\n") + "\n",
);
console.log(
  `Prepared ${tag}: installation file, source archive, update manifest, and checksums`,
);
