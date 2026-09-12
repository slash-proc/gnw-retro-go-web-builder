/**
 * Clearing the cache unprepares what it was holding.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/cacheclear.mjs'
 *
 * The owner: "When I clear cache files, library items need to reflect that immediately."
 *
 * `ui/CachePane.svelte` cleared the store and refreshed its OWN totals, and nothing else heard
 * about it. `prepareState.assets` keeps a prepared title's bytes in memory so a tab switch
 * cannot lose them, and that copy stays perfectly usable after the disk copy is deleted -- so
 * the Library went on reading "prepared" against a store holding nothing, until a reload
 * silently flipped it back.
 *
 * The seam under test is `blobCache.ts`'s module-level clear announcement: the store that owns
 * the bytes says when they are gone, `prepareState` is the only thing listening, and the pane
 * still knows nothing but its own totals. `blobCache`, `convertedCache` and `prepareState` are
 * therefore compiled in ONE splitting build -- a second build would hand `prepareState` a
 * private copy of the listener registry and the announcement would go nowhere.
 *
 * WHAT THIS CANNOT PROVE. Every suite in this repo stubs runes as identity functions
 * (`define: { $state: "__rune" }`), so a `$derived` re-running is not observable here. These
 * checks pin the STORE rule -- that the bytes and their bookkeeping are gone. That the Library
 * row repaints without a reload rests on the `assets` reassignment the store already does for
 * every other mutation, and only a human can confirm it on screen.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const here = new URL(".", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "gwrg-cacheclear-"));
const failures = [];
let passed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e && e.message ? e.message : e}`);
  }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// --- Build -------------------------------------------------------------------------------------

const { gnwResolve } = await import("./gnwResolve.mjs");

// Only what reaches OUT of the process is faked: the converter (worker + WASM), the artifact
// fetch (network) and the locale table. The cache, its announcement, the pointer index and
// every piece of `prepareState`'s bookkeeping stay real.
const fake = {
  "homebrewConvert.js":
    "export async function convertHomebrewTitle(t, f) { return globalThis.__ccFakes.convert(t, f); }",
  "installArtifacts.js":
    "export async function fetchTargetArtifacts(t) { return globalThis.__ccFakes.artifacts(t); }",
  "locale.svelte.js":
    "export const locale = { t: { roms: { selectGames: {" +
    " convertFailed: (c) => `CF|${c}`, convertUnrecognised: (f) => `UR|${f}` } } } };",
};

const src = join(here, "../src/lib/sources");
await esbuild.build({
  entryPoints: [
    join(src, "prepareState.svelte.ts"),
    join(src, "blobCache.ts"),
    join(src, "convertedCache.ts"),
  ],
  outdir: join(out, "store"),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { $state: "__rune" },
  banner: { js: "const __rune = (v) => v;" },
  logLevel: "warning",
  plugins: [
    gnwResolve(join(here, ".")),
    {
      name: "cacheclear-fakes",
      setup(build) {
        build.onResolve({ filter: /(homebrewConvert|installArtifacts|locale\.svelte)\.js$/ }, (a) => ({
          path: a.path.slice(a.path.lastIndexOf("/") + 1),
          namespace: "cc-fake",
        }));
        build.onLoad({ filter: /.*/, namespace: "cc-fake" }, (a) => ({
          contents: fake[a.path],
          loader: "js",
        }));
      },
    },
  ],
});

// `buildGameRows` is pure -- a plain second build. Nothing crosses between them by identity.
await esbuild.build({
  entryPoints: [join(src, "gameRows.ts")],
  outdir: join(out, "pure"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
  plugins: [gnwResolve(join(here, "."))],
});

const { prepareState } = await import(pathToFileURL(join(out, "store", "prepareState.svelte.js")).href);
const { BlobCache, blobKey } = await import(pathToFileURL(join(out, "store", "blobCache.js")).href);
const { restoreConverted } = await import(pathToFileURL(join(out, "store", "convertedCache.js")).href);
const { buildGameRows } = await import(pathToFileURL(join(out, "pure", "gameRows.js")).href);

// --- Fixtures ----------------------------------------------------------------------------------

const bytes = (n, fill) => new Uint8Array(n).fill(fill);

globalThis.__ccFakes = {
  convert: async () => ({ files: new Map(), unrecognised: [], warnings: [] }),
  artifacts: async () => new Map(),
};

/** A localStorage that behaves, so `removed` and the converted pointer are really exercised. */
function fakeStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
  return map;
}

/** An in-memory blob backend, so a real `BlobCache` can really be cleared. */
function backend() {
  const files = new Map();
  return {
    available: true,
    async list() {
      return [...files.keys()];
    },
    async stat(name) {
      return files.has(name) ? files.get(name).length : null;
    },
    async read(name) {
      return files.has(name) ? files.get(name) : null;
    },
    async write(name, b) {
      files.set(name, b.slice());
      return true;
    },
    async remove(name) {
      files.delete(name);
    },
    _files: files,
  };
}
const quota = { estimate: async () => null, persisted: async () => false, persist: async () => false };

function title({ repo = "o/r", id = "t", artifacts = [], hasTool = true } = {}) {
  return {
    key: `${repo}#${id}`,
    repo,
    targetId: id,
    label: id,
    displayName: id,
    deviceFiles: [],
    sourceExtensions: [],
    selfContained: false,
    promptsForInput: true,
    isCore: false,
    ...(hasTool
      ? { tool: { id: "conv", binary: { sha256: "a".repeat(64) }, inputs: [], outputs: [], limits: {}, processor: {} } }
      : {}),
    target: { id, kind: "homebrew", artifacts },
  };
}

const offer = (filename, inputId = "base") => ({
  inputId,
  filename,
  bytes: bytes(8, 1),
  variant: undefined,
  recognised: false,
});

/** Prepare a title for real: artifacts and/or converted output, through `run()`. */
async function prepare(t, { artifacts = new Map(), converted = new Map(), offered = [offer("in.rom")] } = {}) {
  globalThis.__ccFakes.artifacts = async () => artifacts;
  globalThis.__ccFakes.convert = async () => ({ files: converted, unrecognised: [], warnings: [] });
  return prepareState.run(t, offered);
}

/** Everything `prepareState` is holding, as plain keys. */
const assetKeys = () => [...prepareState.assets.keys()].sort();

function reset() {
  prepareState.assets = new Map();
  prepareState.notices = new Map();
  prepareState.failures = new Map();
  prepareState.supplied = new Map();
  prepareState.discovered = new Map();
  prepareState.removed = new Set();
  fakeStorage();
}

// --- 1. A converted clear unprepares what it produced -------------------------------------------

await check("a `converted` clear drops the bytes it was holding", async () => {
  reset();
  const cache = new BlobCache({ backend: backend(), quota });
  const t = title();
  await prepare(t, { converted: new Map([["out.bin", bytes(16, 7)]]) });
  eq(prepareState.preparedSize("homebrew", "out.bin"), 16, "prepared before the clear");

  await cache.clearCategory("converted");
  eq(prepareState.preparedSize("homebrew", "out.bin"), undefined, "and gone after it");
  eq(assetKeys().length, 0, "nothing left in assets");
});

// --- 2. Only the affected category --------------------------------------------------------------

await check("clearing an unrelated category changes nothing", async () => {
  reset();
  const cache = new BlobCache({ backend: backend(), quota });
  const t = title();
  await prepare(t, { converted: new Map([["out.bin", bytes(16, 7)]]) });

  for (const category of ["cover", "firmware", "converter", "offline", "other"]) {
    await cache.clearCategory(category);
    eq(
      prepareState.preparedSize("homebrew", "out.bin"),
      16,
      `a \`${category}\` clear cannot unprepare anything`,
    );
  }
});

await check("an `artifact` clear spares a title whose files are all converted output", async () => {
  reset();
  const cache = new BlobCache({ backend: backend(), quota });
  await prepare(title({ id: "conv-only" }), { converted: new Map([["out.bin", bytes(16, 7)]]) });

  await cache.clearCategory("artifact");
  eq(prepareState.preparedSize("homebrew", "out.bin"), 16, "it holds nothing from that category");
});

await check("an `artifact` clear takes the WHOLE title that lost one, converted half included", async () => {
  reset();
  const cache = new BlobCache({ backend: backend(), quota });
  const t = title({ id: "both", artifacts: [{ filename: "engine.bin", sha256: "b".repeat(64) }] });
  await prepare(t, {
    artifacts: new Map([["engine.bin", bytes(4, 2)]]),
    converted: new Map([["out.bin", bytes(16, 7)]]),
  });
  eq(assetKeys().length, 2, "both halves are held");

  await cache.clearCategory("artifact");
  // All-or-nothing per title: half a file set renders as prepared and installs incomplete.
  eq(assetKeys().length, 0, "the converted half went with the artifact half");
});

// --- 3. A user's explicit removal is not cache --------------------------------------------------

await check("an explicit removal survives a clear, in memory and on disk", async () => {
  reset();
  const store = fakeStorage();
  const cache = new BlobCache({ backend: backend(), quota });
  const t = title();
  await prepare(t, { converted: new Map([["out.bin", bytes(16, 7)]]) });
  prepareState.unsupply("o/r", "base", [t]);
  ok(prepareState.removed.has("o/r#base"), "removed before the clear");
  const persisted = store.get("gnw.unsupplied.v1");
  ok(persisted && persisted.includes("o/r#base"), "and persisted");

  await cache.clear();
  ok(prepareState.removed.has("o/r#base"), "the user's decision is not cache");
  eq(store.get("gnw.unsupplied.v1"), persisted, "and the pointer on disk is untouched");
});

// --- 4. Empty-all ------------------------------------------------------------------------------

await check("`clear()` empties every prepared title at once", async () => {
  reset();
  const cache = new BlobCache({ backend: backend(), quota });
  await prepare(title({ id: "a" }), { converted: new Map([["a.bin", bytes(8, 1)]]) });
  await prepare(title({ id: "b" }), { converted: new Map([["b.bin", bytes(8, 2)]]) });
  eq(assetKeys().length, 2, "two titles prepared");

  await cache.clear();
  eq(assetKeys().length, 0, "and none after Empty cache");
});

// --- 5. The verdict goes with the preparation it described --------------------------------------

await check("a dropped title's notices go with it", async () => {
  reset();
  const cache = new BlobCache({ backend: backend(), quota });
  const t = title();
  globalThis.__ccFakes.artifacts = async () => new Map();
  globalThis.__ccFakes.convert = async () => ({
    files: new Map([["out.bin", bytes(16, 7)]]),
    unrecognised: [],
    warnings: ["cropped 11 widescreen lumps"],
  });
  await prepareState.run(t, [offer("in.rom")]);
  // Asked per FILE, not per title: the whole-title roll-ups were removed with the panel that
  // was their only caller, and `noticesFor` is what a Library row actually reads.
  ok(prepareState.noticesFor(t.key, "in.rom").length > 0, "the run left a note");

  await cache.clearCategory("converted");
  eq(prepareState.noticesFor(t.key, "in.rom").length, 0, "a row back on Prepare carries no verdict");
});

// --- 6. The pointer index is pruned -------------------------------------------------------------

await check("a `converted` clear drops the pointers that named those bytes", async () => {
  reset();
  const store = fakeStorage();
  store.set("gnw.convertedHash.v1", JSON.stringify({ "o/r#t": { files: { "out.bin": "c".repeat(64) } } }));
  const cache = new BlobCache({ backend: backend(), quota });

  await cache.clearCategory("cover");
  ok(store.has("gnw.convertedHash.v1"), "an unrelated category leaves it alone");

  await cache.clearCategory("converted");
  ok(!store.has("gnw.convertedHash.v1"), "every `files` hash in it names bytes that are gone");
});

// --- 7. No phantom on the next reload -----------------------------------------------------------

await check("a reload after a clear restores nothing", async () => {
  const b = backend();
  const cache = new BlobCache({ backend: b, quota });
  const out16 = bytes(16, 7);
  // The store is content-addressed and `get()` re-hashes, so an invented key is a guaranteed
  // miss and would have made this check pass for the wrong reason.
  const hash = await blobKey(out16);
  await cache.put(hash, out16, "converted");
  const index = {
    map: new Map([
      ["o/r#t", { sig: "s", tool: "a".repeat(64), repo: "o/r", inputs: ["base"], files: { "out.bin": hash }, warnings: [], unrecognised: [] }],
    ]),
    get(k) {
      return this.map.get(k) ?? null;
    },
    set(k, e) {
      this.map.set(k, e);
    },
    entries() {
      return [...this.map.entries()];
    },
  };
  const t = title();

  const before = await restoreConverted([t], { cache, index });
  eq(before.length, 1, "restorable while the bytes are there");

  await cache.clearCategory("converted");
  const after = await restoreConverted([t], { cache, index });
  eq(after.length, 0, "and not restorable once they are not -- no phantom prepared row");
});

// --- 8. A row backed by a file on disk is not the cache's business ------------------------------

await check("a row whose output is a real file is unaffected by any clear", () => {
  // `gameRows` asks `preparedSizeFor` only when the scan found nothing, so an output sitting in
  // the user's own folder answers first and a cleared cache cannot touch it.
  const entries = [
    { key: "doom/DOOM.WAD", system: "doom", name: "DOOM.WAD", size: 100, role: "ingestable", inFolder: true, installed: false },
    { key: "doom/DOOM.whd", system: "doom", name: "DOOM.whd", size: 200, role: "installable", inFolder: true, installed: false },
  ];
  // undefined for every lookup: the post-clear world.
  const rows = buildGameRows(entries, () => ".whd", () => undefined, () => undefined);
  eq(rows.length, 1, "the pair is one row");
  eq(rows[0].needsPrepare, false, "and it is still prepared, from the file on disk");
});

// --- Report ------------------------------------------------------------------------------------

rmSync(out, { recursive: true, force: true });
if (failures.length > 0) {
  console.error(`cache clear: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`cache clear: ${passed} checks passed`);
