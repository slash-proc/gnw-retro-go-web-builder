#!/usr/bin/env node
/**
 * The Library's first-load progress: ONE scan, counted in files.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/libraryprogress.mjs'
 *
 * Two defects, both reported as "the bar is disjointed":
 *
 * 1. The denominator was FOLDERS. `done` advanced once per folder while the filename under the
 *    bar updated per file, so a single ROM folder sat at 0% with names streaming past and then
 *    jumped to 100%. It is files now, counted before the walk by enumerating entries.
 *
 * 2. It was several scans. The scan signature includes each folder's resolved prefix, which
 *    comes from the core registry, which is built from the active sources' manifests as they
 *    arrive over the network. Every arrival changed the signature and started a full re-walk, so
 *    a cold start could scan the library once per core source, each restarting the bar.
 *
 * `countRomDirectory` is exercised for real against a fake directory handle. The rest is a
 * WIRING check over the source, because the scan lives in a store driven by a Svelte effect.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const check = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

// --- countRomDirectory, for real --------------------------------------------------------------
const out = mkdtempSync(join(tmpdir(), "gnw-libprogress-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));
const esbuild = await import("esbuild");
import { gnwResolveFor } from "./gnwResolve.mjs";
await esbuild.build({
  entryPoints: [join(here, "../src/lib/romScan.ts")],
  outfile: join(out, "romScan.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  // Runes stubbed as identity functions, the same way every other suite here does it: this
  // bundle reaches store modules that declare $state at module scope, and plain node cannot
  // evaluate a rune.
  define: { $state: "__rune", $derived: "__rune" },
  banner: { js: "const __rune = Object.assign((v) => v, { by: (f) => (typeof f === 'function' ? undefined : f) });" },
  // The probe drivers are third-party browser modules this test never reaches: romScan pulls in
  // the homebrew title list, which reaches the device store. Marking them external keeps the
  // bundle honest about what it does not exercise rather than stubbing behaviour.
  external: ["@gnw/*"],
  logLevel: "warning",
  plugins: [
    gnwResolveFor(import.meta.url),
    {
      // romScan reaches the homebrew title list, which reaches the device store, which imports
      // the probe drivers. None of that runs here. Stubbed to empty modules rather than marked
      // external, so an accidental USE would throw rather than fail at import time.
      name: "stub-browser-only",
      setup(b) {
        // Vite `?url` assets (the RAM stub's firmware.bin among them) are not modules node can
        // import. Nothing here loads one; resolve them to a string so the bundle links.
        b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: "urlasset" }));
        b.onLoad({ filter: /.*/, namespace: "urlasset" }, (a) => ({
          contents: `export default ${JSON.stringify("asset:" + a.path)};`,
          loader: "js",
        }));
        // Cut the chain at its source instead of stubbing every leaf: romScan needs only the
        // homebrew whitelist, and reaching for the real module drags in the device store, the
        // probe drivers and the firmware blob, none of which this test exercises.
        b.onResolve({ filter: /homebrewTitles\.svelte\.js$/ }, () => ({ path: "hb", namespace: "stub" }));
        b.onResolve({ filter: /^(dapjs|jszip|@webstlink\/.*)$/ }, (a) => ({ path: a.path, namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          // A Proxy so any named import resolves to something that throws if CALLED.
          contents:
            "export const homebrew = { deviceFiles: new Set(), owning: () => undefined, titles: [] };\n" +
            "export const isHomebrewSourceFile = () => false;\n" +
            "const t = new Proxy(function(){}, { get: () => t, apply: () => { throw new Error('browser-only module used in a test'); } });\n" +
            "export default t; export const CortexM = t, WebUSB = t;",
          loader: "js",
        }));
      },
    },
  ],
});
const { countRomDirectory, scanRomDirectory } = await import(pathToFileURL(join(out, "romScan.js")).href);

/** A directory handle over a plain object tree. Files are Uint8Arrays. */
function dirHandle(tree) {
  return {
    kind: "directory",
    async *entries() {
      for (const [name, v] of Object.entries(tree)) {
        yield [name, v instanceof Uint8Array
          ? { kind: "file", async getFile() { return { async arrayBuffer() { return v.buffer; } }; } }
          : dirHandle(v)];
      }
    },
  };
}

const tree = {
  nes: { "a.nes": new Uint8Array(4), "b.nes": new Uint8Array(4) },
  gb: { "c.gb": new Uint8Array(4) },
  ".DS_Store": new Uint8Array(1),      // hidden, must not count
  covers: { "a.png": new Uint8Array(2) },
};

await check("countRomDirectory counts exactly what a scan reads", async () => {
  const n = await countRomDirectory(dirHandle(tree));
  const scanned = await scanRomDirectory(dirHandle(tree));
  // The count is the denominator the bar has to reach, so it must equal what the walk produced,
  // not the number of files on disk: a mismatch either stalls short of 100% or overshoots it.
  assert(n === scanned.userRoms.size,
    `counted ${n}, the scan read ${scanned.userRoms.size}`);
  assert(n === 4, `expected 4 readable files (hidden one excluded), got ${n}`);
});

await check("countRomDirectory opens no files", async () => {
  let opened = 0;
  const spy = (t) => ({
    kind: "directory",
    async *entries() {
      for (const [name, v] of Object.entries(t)) {
        yield [name, v instanceof Uint8Array
          ? { kind: "file", async getFile() { opened++; return { async arrayBuffer() { return v.buffer; } }; } }
          : spy(v)];
      }
    },
  });
  await countRomDirectory(spy(tree));
  assert(opened === 0, `getFile() was called ${opened} time(s); counting must not read`);
});

// --- the wiring ------------------------------------------------------------------------------
const lib = readFileSync(join(here, "../src/lib/library.svelte.ts"), "utf8");
const tab = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8");

function audit(libSrc, tabSrc) {
  const problems = [];
  if (!/countRomDirectory\(/.test(libSrc)) {
    problems.push("the scan never counts files, so the bar is back to a folder denominator");
  }
  if (/total: sources\.length/.test(libSrc)) {
    problems.push("progress.total is the folder count again");
  }
  if (!/sourcesResolving/.test(libSrc) || !/library\.sourcesResolving/.test(tabSrc)) {
    problems.push("the first scan does not wait for the sources to resolve, so a cold start rescans per manifest");
  }
  if (!/if \(library\.sourcesResolving && !library\.loaded\) return;/.test(tabSrc)) {
    problems.push("the wait is not gated on the FIRST scan, so a later core activation would stop rescanning");
  }
  const pickFolderBlock = libSrc.slice(libSrc.indexOf("async pickFolder()"), libSrc.indexOf("async pickSavesFolder()"));
  if (/pickAndScanRomFolder\(/.test(pickFolderBlock)) {
    problems.push("library.pickFolder() scans the directory before sync(), scanning twice on folder selection");
  }
  return problems;
}

await check("the library scan counts files and waits for the sources", () => {
  const problems = audit(lib, tab);
  assert(problems.length === 0, problems.join("; "));
});

await check("ANTI-VACUITY: the same assertions fail on the old shape", () => {
  const before = lib
    .replace(/countRomDirectory\(/g, "noCount(")
    .replace(/total: totalFiles/g, "total: sources.length")
    .replace(/sourcesResolving/g, "gone")
    .replace(/pickRomFolder\(\)/g, "pickAndScanRomFolder()");
  const problems = audit(before, tab.replace(/sourcesResolving/g, "gone"));
  assert(problems.length === 5,
    `the old shape should fail all five, ${problems.length} did: ${problems.join("; ") || "(none)"}`);
});

console.log(`\nlibraryprogress: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
