#!/usr/bin/env node
/** Offline checks for independent Retro-Go repository enable/default/operation state. */
import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-firmware-repositories-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/firmwareDist/repositories.svelte.ts")],
  outfile: join(out, "repositories.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
});
await esbuild.build({
  entryPoints: [join(here, "../src/lib/firmwareDist/curated.ts")],
  outfile: join(out, "curated.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
});

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const { firmwareRepositories: store } = await import(pathToFileURL(join(out, "repositories.js")).href);
const { loadCuratedProjectsFromRepositories } = await import(pathToFileURL(join(out, "curated.js")).href);
const repositoryUi = readFileSync(join(here, "../src/lib/ui/RetroGoRepositories.svelte"), "utf8");
if (!repositoryUi.includes("t.retroGoDefault") || repositoryUi.includes("t.useRetroGoRepo")) {
  throw new Error('repository default control must say "Default source"');
}
const wizardUi = readFileSync(join(here, "../src/lib/views/Wizard.svelte"), "utf8");
if (!wizardUi.includes("versionsUrlFor(firmwareRepositories.defaultRepo)") ||
    !wizardUi.includes("fetchBundle(\n      target.tag") ||
    !wizardUi.includes("{ versionsUrl },")) {
  throw new Error("Guided Setup must fetch firmware from the configured default source");
}
const sourceStoreUi = readFileSync(join(here, "../src/lib/sources/store.svelte.ts"), "utf8");
if (!sourceStoreUi.includes("repository.catalogTag ? { tag: repository.catalogTag }")) {
  throw new Error("curated source discovery must follow each repository's selected release");
}
const catalogCalls = [];
const catalog = await loadCuratedProjectsFromRepositories(
  [
    { repo: "one/retro-go", tag: "v1.0.0" },
    { repo: "two/retro-go", tag: "v2.0.0" },
    { repo: "offline/retro-go", tag: "v3.0.0" },
  ],
  async (repo, tag) => {
    catalogCalls.push(`${repo}@${tag}`);
    if (repo.startsWith("offline/")) throw new Error("offline");
    return [{
      project: "same-core",
      title: "Same core",
      kind: "core",
      versionsUrl: `https://${repo.split("/")[0]}.github.io/${repo.split("/")[1]}/dist/versions.json`,
      catalog: { repo, tag },
    }];
  },
);
if (catalogCalls.length !== 3 || catalogCalls[0] !== "one/retro-go@v1.0.0" ||
    catalogCalls[1] !== "two/retro-go@v2.0.0" || catalog?.length !== 2 ||
    catalog[0].catalog?.repo !== "one/retro-go" || catalog[0].catalog?.tag !== "v1.0.0" ||
    catalog[1].catalog?.repo !== "two/retro-go" || catalog[1].catalog?.tag !== "v2.0.0") {
  throw new Error("enabled catalogs must load independently and keep each provider's identity");
}
if (await loadCuratedProjectsFromRepositories([], async () => { throw new Error("must not load"); }) !== null) {
  throw new Error("no enabled repository must yield no catalog");
}
const rows = [
  { repo: "one/retro-go", active: true, versions: 2, status: "ready" },
  { repo: "two/retro-go", active: true, versions: 3, status: "ready" },
  { repo: "three/retro-go", active: false, versions: 1, status: "ready" },
];
store.rows = rows;
store.defaultRepo = rows[0].repo;
store.selectedRepo = rows[0].repo;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function equal(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
}

store.setActive(rows[1].repo, true);
equal(store.activeRows.length, 2, "multiple firmware sources can be enabled together");
store.select(rows[1].repo);
equal(store.selectedRepo, rows[1].repo, "Advanced operation source can be changed");
equal(store.defaultRepo, rows[0].repo, "Advanced selection does not change the Guided Setup default");

store.setDefault(rows[1].repo);
equal(store.defaultRepo, rows[1].repo, "default source can be changed independently");
equal(store.selectedRepo, rows[1].repo, "default change leaves the current operation source intact");

store.setActive(rows[1].repo, false);
equal(store.defaultRepo, rows[0].repo, "disabling the default falls back to another enabled repository");
equal(store.selectedRepo, rows[0].repo, "disabling the selected operation source falls back to default");
equal(store.activeRows.length, 1, "deactivation leaves other enabled repositories available");

store.setActive(rows[0].repo, false);
equal(store.defaultRepo, "", "no enabled repositories means no default source");
equal(store.selectedRepo, "", "no enabled repositories means no operation source");
store.setActive(rows[2].repo, true);
equal(store.defaultRepo, rows[2].repo, "enabling a source chooses a default when none exists");
equal(store.selectedRepo, rows[2].repo, "enabling a source restores an operation choice when none exists");

const savedDefault = [...storage.entries()].find(([key]) => key.endsWith("firmware-repository.default.v1"));
const savedSelected = [...storage.entries()].find(([key]) => key.endsWith("firmware-repository.selected.v1"));
assert(savedDefault, "default source is persisted separately");
assert(savedSelected, "Advanced selection is persisted separately");
equal(JSON.parse(savedDefault[1]), rows[2].repo, "persisted default source");
equal(JSON.parse(savedSelected[1]), rows[2].repo, "persisted Advanced selection");

console.log("firmwarerepositories: 17 checks passed");
