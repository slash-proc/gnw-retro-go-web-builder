// Guard: a non-production build must not share persisted storage with production.
//
// `/wip/` on GitHub Pages is the SAME ORIGIN as production, so localStorage, IndexedDB and OPFS
// are shared unless every persisted name is scoped. Two things can go wrong and both are
// silent:
//
//   1. Production's names change -> every existing user looks like a first-time visitor and
//      their registrations, handles and caches are orphaned. This is the regression that would
//      actually hurt people, so it is asserted first and hardest.
//   2. A new persisted name is added later without `scoped()` -> the wip build writes it into
//      production's storage. The inventory below is the defence: it is checked against the
//      source, so an unscoped key added tomorrow fails here rather than in a user's browser.
//
// Cost: three small file reads plus one esbuild of a pure module. No network, no OPFS.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "../src/lib");
const read = (rel) => readFileSync(join(SRC, rel), "utf8");

let failures = 0;
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(`  ok   ${name}`);
  } catch (e) {
    failures++;
    results.push(`  FAIL ${name}: ${e.message}`);
  }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}: got ${a}, want ${b}`);
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- the module under test, compiled from source ------------------------------------------
const bundle = await build({
  entryPoints: [join(SRC, "storageScope.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
});
const mod = await import(
  "data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const { scoped, isScopedBuild } = mod;

// --- THE INVENTORY -------------------------------------------------------------------------
// Every persisted name in the app, with the file that owns it. Grep basis:
//   localStorage | sessionStorage | indexedDB | navigator.storage.getDirectory
// A name here must be produced by `scoped(...)` in its owning file.
const PERSISTED = [
  // localStorage, namespaced through persist.ts
  { name: "gnw:", file: "persist.ts", what: "localStorage namespace for every loadSel/saveSel key" },
  // localStorage, written directly by their own modules
  { name: "gnw.convertedHash.v1", file: "sources/convertedCache.ts", what: "converted-output pointers" },
  { name: "gnw.unsupplied.v1", file: "sources/prepareState.svelte.ts", what: "explicit user removals" },
  { name: "gnw.install-paths", file: "engine/devicePaths.ts", what: "learned manifest install paths" },
  { name: "gnw.coverHash.v1", file: "screenscraper/coverStore.ts", what: "cover pointers" },
  { name: "gnw.coverMigrated.v1", file: "screenscraper/coverStore.ts", what: "cover migration flag" },
  { name: "gnw.bundleZipHash.v1", file: "sources/bundleStore.ts", what: "bundle zip pointers" },
  { name: "gnw.bundleZipMigrated.v1", file: "sources/bundleStore.ts", what: "bundle migration flag" },
  { name: "gnw.favorites.v1", file: "favorites.svelte.ts", what: "starred device paths, pending a sync" },
  // sessionStorage: same origin, same collision, same rule. A wip build reading production's
  // activity log would be harmless; a wip build OVERWRITING it destroys the one thing a user
  // refreshed the page to go and read.
  { name: "gnw.activityLog.v1", file: "auditLogPersist.ts", what: "the activity log, across a reload" },
  // IndexedDB databases
  { name: "gnw-handles", file: "persist.ts", what: "directory handles (not bytes, cannot move to OPFS)" },
  { name: "gnw-bundles", file: "sources/bundleStore.ts", what: "imported bundle zips" },
  // OPFS
  { name: "blob-cache", file: "sources/blobCache.ts", what: "the content-addressed blob cache root" },
];

check("production names are UNCHANGED, so no existing user is orphaned", () => {
  for (const { name } of PERSISTED) {
    eq(scoped(name, ""), name, `production must still use ${name} verbatim`);
  }
  eq(isScopedBuild(""), false, "an empty scope is production");
});

check("a scoped build shares no name with production", () => {
  const prod = new Set(PERSISTED.map((p) => scoped(p.name, "")));
  for (const { name } of PERSISTED) {
    const wip = scoped(name, "wip");
    ok(!prod.has(wip), `${wip} collides with a production name`);
    ok(wip !== name, `${name} was not scoped at all`);
  }
  eq(isScopedBuild("wip"), true, "a non-empty scope is not production");
});

check("every persisted name in the inventory is scoped in its own source file", () => {
  const unscoped = [];
  for (const { name, file } of PERSISTED) {
    const src = read(file);
    // The literal must appear as an argument to scoped(...), not as a bare assignment.
    const isScoped = new RegExp(`scoped\\(\\s*["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(src);
    if (!isScoped) unscoped.push(`${file} -> ${name}`);
  }
  eq(unscoped, [], "these persisted names bypass scoped() and would hit production storage");
});

check("no persisted name is built by string concatenation around scoped()", () => {
  // `scoped("a") + "-b"` would produce a name the inventory cannot see. Cheap shape check on
  // the files that own persisted names.
  const offenders = [];
  for (const { file } of PERSISTED) {
    const src = read(file);
    if (/scoped\([^)]*\)\s*\+/.test(src)) offenders.push(file);
  }
  eq(offenders, [], "a scoped name is being concatenated, so the inventory cannot audit it");
});

check("the ScreenScraper credential keys are scoped too", () => {
  const src = readFileSync(join(SRC, "views/GameDetailsPanel.svelte"), "utf8");
  // A `gnw:ss*` literal is only allowed as an argument to scoped(); anywhere else it is a raw
  // key that would land in production's storage.
  const raw = [...src.matchAll(/(scoped\(\s*)?["']gnw:ss\w+["']/g)].filter((m) => !m[1]);
  eq(raw.map((m) => m[0]), [], "a hardcoded gnw:ss* key survives; a tester would read the production login");
  for (const k of ["ssUsername", "ssPassword", "ssRemember", "ssPreferLocal", "ssSaveLocal"]) {
    ok(new RegExp(`${k}:\\s*scoped\\(`).test(src), `${k} is not scoped`);
  }
});

check("the legacy un-namespaced migration is production-only", () => {
  // loadRawMigrated ADOPTS and then DELETES a bare `theme` / `locale` key. A scoped build doing
  // that would consume the production user's value.
  const src = read("persist.ts");
  const fn = src.slice(src.indexOf("export function loadRawMigrated"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  ok(/isScopedBuild\(\)/.test(body), "loadRawMigrated does not guard against a scoped build");
  ok(
    body.indexOf("isScopedBuild()") < body.indexOf("removeItem(legacyKey)"),
    "the guard must come before the legacy key is deleted",
  );
});

check("a migration cannot see the other build's data", () => {
  // Storage migrations key off the same names, so scoping the names scopes the migrations.
  // Assert the two byte stores and the pointer keys a migration reads are all distinct.
  const migrationTouched = ["gnw.coverMigrated.v1", "gnw.bundleZipMigrated.v1", "blob-cache", "gnw-bundles"];
  for (const name of migrationTouched) {
    ok(
      PERSISTED.some((p) => p.name === name),
      `${name} is read by a migration but is not in the inventory`,
    );
    ok(scoped(name, "wip") !== scoped(name, ""), `${name} is shared, so a wip migration would run on production data`);
  }
});

// --- the build wiring ----------------------------------------------------------------------
check("vite defines the scope from PUBLIC_STORAGE_SCOPE", () => {
  const cfg = readFileSync(join(here, "../vite.config.ts"), "utf8");
  ok(/__STORAGE_SCOPE__/.test(cfg), "vite.config.ts does not define __STORAGE_SCOPE__");
  ok(/PUBLIC_STORAGE_SCOPE/.test(cfg), "vite.config.ts does not read PUBLIC_STORAGE_SCOPE");
  ok(/\?\?\s*""/.test(cfg), "the scope must default to production, not to a scoped build");
});

check("the deploy workflow gives /wip/ its own scope, and production none", () => {
  const wf = readFileSync(join(here, "../../../.github/workflows/deploy-pages.yml"), "utf8");
  ok(/PUBLIC_BASE:\s*\/gnw-retro-go-web-builder\/wip\//.test(wf), "no /wip/ base in the workflow");
  ok(/PUBLIC_STORAGE_SCOPE:\s*wip/.test(wf), "the wip build does not set PUBLIC_STORAGE_SCOPE");
  // Production must not inherit a scope from a previous step.
  const prodStep = wf.slice(wf.indexOf("Build Web App (production"), wf.indexOf("Build Web App (/wip/)"));
  ok(/PUBLIC_STORAGE_SCOPE:\s*""/.test(prodStep), "the production build does not pin an empty scope");
  ok(/continue-on-error:\s*true/.test(wf), "a failing wip build could take production down");
  ok(/ref:\s*main/.test(wf), "production is not pinned to main, so a wip push could redeploy it");
});

console.log(results.join("\n"));
if (failures > 0) {
  console.log(`\nstorage scope: ${failures} FAILED, ${results.length - failures} passed`);
  process.exit(1);
}
console.log(`storage scope: ${results.length} checks passed`);
