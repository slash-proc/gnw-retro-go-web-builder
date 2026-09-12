#!/usr/bin/env node
/**
 * Offline coverage for persist.ts's `loadRawMigrated()` / `saveRaw()` — the one-time move of
 * the two pre-namespace localStorage keys (`theme`, `locale`) onto the `gnw:` namespace.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/storage-migration.mjs'
 *
 * Plain node, no framework (repo convention). Nothing here touches a device.
 *
 * Why this file exists: a bare rename of a persisted key silently RESETS every existing
 * user (their theme flips back to the OS default, their language back to the browser's) on
 * the next visit. The migration must adopt the legacy value, write it forward, and then stop
 * looking — so the three cases below (legacy only / new only / neither) are the contract.
 *
 * Sections 1-5 exercise the helpers. Section 6 exercises the CALL SITES: the helpers being
 * correct buys nothing if theme.svelte.ts or locale.svelte.ts stop going through them (or if
 * some third file starts reading the bare key again), and neither tsc nor svelte-check can
 * see that — a direct `localStorage.getItem("theme")` type-checks perfectly.
 */
import { mkdtempSync, symlinkSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e && e.message ? e.message : e}`); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// --- localStorage shim, installed BEFORE the module is imported ------------------------
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-storage-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/persist.ts")],
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
});
const { loadRawMigrated, saveRaw } = await import(pathToFileURL(join(out, "persist.js")).href);

const reset = () => mem.clear();

// 1. Legacy key only — an existing user upgrading.
check("legacy key present: its value is adopted, written forward, and the old key removed", () => {
  reset();
  localStorage.setItem("theme", "dark");
  eq(loadRawMigrated("theme", "theme"), "dark", "returned value");
  eq(localStorage.getItem("gnw:theme"), "dark", "written forward under the namespace");
  eq(localStorage.getItem("theme"), null, "legacy key cleared");
});

check("the migration is one-time: a second read no longer needs the legacy key", () => {
  reset();
  localStorage.setItem("locale", "ja");
  loadRawMigrated("locale", "locale");
  eq(localStorage.getItem("locale"), null, "legacy key gone after the first read");
  eq(loadRawMigrated("locale", "locale"), "ja", "second read still returns the value");
});

// 2. New key only — the steady state. A stale legacy value must NOT win.
check("namespaced key present: the legacy key is ignored, not adopted", () => {
  reset();
  localStorage.setItem("gnw:theme", "light");
  localStorage.setItem("theme", "dark"); // stale leftover from an older build
  eq(loadRawMigrated("theme", "theme"), "light", "namespaced value wins");
  eq(localStorage.getItem("theme"), null, "stale legacy key swept away");
});

// 3. Neither — a first-time visitor falls through to the caller's default.
check("neither key present: returns null so the caller uses its own default", () => {
  reset();
  eq(loadRawMigrated("theme", "theme"), null, "no value");
  eq(localStorage.getItem("gnw:theme"), null, "nothing written on a miss");
});

// 4. saveRaw writes namespaced and un-encoded (theme/locale are bare strings, not JSON).
check("saveRaw writes the raw string under the gnw: namespace", () => {
  reset();
  saveRaw("locale", "de");
  eq(localStorage.getItem("gnw:locale"), "de", "namespaced, unencoded");
  eq(localStorage.getItem("locale"), null, "never writes the bare key");
});

// 5. A storage-disabled browser (private mode) must not throw out of either helper.
check("a throwing localStorage is swallowed by both helpers", () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
  };
  try {
    eq(loadRawMigrated("theme", "theme"), null, "read falls back to null");
    saveRaw("theme", "dark"); // must not throw
  } finally {
    globalThis.localStorage = real;
  }
});

// --- 6. Call-site guards ----------------------------------------------------------------
// The two consumers are `.svelte.ts` rune modules, so they can't be imported/bundled here
// (esbuild has no rune transform). Assert on their SOURCE instead: they must route through
// the helpers with the right key/legacy-key pair, and must not touch localStorage directly.

const srcRoot = join(here, "../src");
const read = (rel) => readFileSync(join(srcRoot, rel), "utf8");

function has(src, re, msg) {
  if (!re.test(src)) throw new Error(`${msg}: no match for ${re}`);
}

check("theme.svelte.ts goes through the migration helpers for `theme`", () => {
  const src = read("lib/theme.svelte.ts");
  has(src, /loadRawMigrated\(\s*"theme"\s*,\s*"theme"\s*\)/, "reads via loadRawMigrated(new, legacy)");
  has(src, /saveRaw\(\s*"theme"\s*,/, "writes via saveRaw");
  if (/localStorage\s*\./.test(src)) throw new Error("touches localStorage directly");
});

check("locale.svelte.ts goes through the migration helpers for `locale`", () => {
  const src = read("lib/i18n/locale.svelte.ts");
  has(src, /loadRawMigrated\(\s*"locale"\s*,\s*"locale"\s*\)/, "reads via loadRawMigrated(new, legacy)");
  has(src, /saveRaw\(\s*"locale"\s*,/, "writes via saveRaw");
  if (/localStorage\s*\./.test(src)) throw new Error("touches localStorage directly");
});

// A bare `theme` key is a plausible collision with anything else on the same origin, so no
// OTHER file may read or write it either — including the index.html pre-paint guard, if one
// is ever added (a FOUC stamp reading the old key would silently show the wrong theme).
check("no other reader of the bare `theme` / `locale` keys anywhere in apps/web", () => {
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name === ".svelte-kit") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|js|mjs|svelte|html)$/.test(name)) files.push(full);
    }
  })(join(here, ".."));

  // Bare-key access: getItem/setItem/removeItem("theme"|"locale") with no `gnw:` prefix.
  const bare = /(?:getItem|setItem|removeItem)\(\s*(["'])(theme|locale)\1/;
  const offenders = [];
  for (const f of files) {
    if (f.endsWith(join("test", "storage-migration.mjs"))) continue; // this file's own shim
    if (bare.test(readFileSync(f, "utf8"))) offenders.push(f);
  }
  eq(offenders.length, 0, `bare-key readers found: ${offenders.join(", ")}`);
});

check("index.html has no inline pre-paint script reading storage", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  if (/localStorage/.test(html)) throw new Error("index.html reads localStorage inline");
});

console.log(`\nstorage-migration: ${passed} checks passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
