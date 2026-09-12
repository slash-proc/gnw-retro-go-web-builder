/**
 * A title's size is the bytes it would actually install, converted files included.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/titlesize.mjs'
 *
 * The owner, with OpenLara added and prepared: "the calculated size only seems to encompass the
 * binary and not the converted files" -- 136.62 KB, which is `OpenLara.bin` (139903 B) exactly,
 * with every converted `.PKD` level uncounted, on the Library row, the info box under the
 * carousel and the Configure page's "What gets installed".
 *
 * ONE DEFECT, TWO INDEPENDENT COMPUTATIONS. Both walked names the MANIFEST declares:
 * `HomebrewTitle.deviceFiles` is `artifacts[]` plus outputs carrying a `filename`, and
 * `composeInstallRows` skipped an output with no `filename` outright. A DERIVED output declares
 * an extension and is named per input file (`filename` XOR `extension`, types.ts), so it can
 * appear in neither by construction -- no matter how many of them have been built. Doom's
 * `.whd` games have the same shape.
 *
 * The bytes were never missing. `run()` records which keys a title produced (`produced`) and
 * which cache backs each (`assetSource`), because a placement key like
 * `doom/The Ultimate Doom.whd` says nothing about who wrote it and two titles share a
 * directory. Summing that provenance is exact: it is what an install writes.
 *
 * WHAT THIS CANNOT PROVE. Runes are stubbed as identity functions here, so a `$derived`
 * re-running is not observable; and `getHomebrewSize` lives inside a `.svelte` component and
 * cannot be imported. These checks pin the STORE rule and the pure composition rule the three
 * surfaces read through.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const here = new URL(".", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "gwrg-titlesize-"));
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
    "export async function convertHomebrewTitle(t, f) { return globalThis.__tsFakes.convert(t, f); }",
  "installArtifacts.js":
    "export async function fetchTargetArtifacts(t) { return globalThis.__tsFakes.artifacts(t); }",
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
      name: "titlesize-fakes",
      setup(build) {
        build.onResolve({ filter: /(homebrewConvert|installArtifacts|locale\.svelte)\.js$/ }, (a) => ({
          path: a.path.slice(a.path.lastIndexOf("/") + 1),
          namespace: "ts-fake",
        }));
        build.onLoad({ filter: /.*/, namespace: "ts-fake" }, (a) => ({
          contents: fake[a.path],
          loader: "js",
        }));
      },
    },
  ],
});

// `installRows` is pure -- a plain second build. Nothing crosses between them by identity.
await esbuild.build({
  entryPoints: [join(src, "installRows.ts"), join(src, "selectedAssets.ts")],
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
const { composeInstallRows, installTotal } = await import(
  pathToFileURL(join(out, "pure", "installRows.js")).href
);
const { selectedPreparedAssets } = await import(
  pathToFileURL(join(out, "pure", "selectedAssets.js")).href
);

// --- The selection store, executed ------------------------------------------------------------
//
// `selectedHomebrewKeys` is a plain getter over `homebrew.titles`, so it can be RUN rather than
// grepped, which is the difference between proving the rule and proving nothing. Only what
// reaches outside it is faked; the getter itself is the shipped code.
const selFakes = {
  "library.svelte.js": "export const library = { scan: null };",
  "device.svelte.js": "export const device = { installedGames: [], targetMedia: 'flash' };",
  "romScan.js": "export function nativeFolderPickerSupported(){return true;}",
  "consoles.js": "export function consoleLabel(s){return s;}",
  "homebrewTitles.svelte.js":
    "export const homebrew = { titles: [], find(k){return this.titles.find(t=>t.key===k);}," +
    " isComplete(hb,dev){return hb.deviceFiles.length>0 && hb.deviceFiles.every(f=>dev.includes(f));}," +
    " owning(){return undefined;} };\nglobalThis.__tsHb = homebrew;",
  "libraryScan.js": "export function basePath(p){return p;}",
  "coreRegistry.svelte.js":
    "export const coreRegistry = { current: { systems: [], hasCoreSources: false, folders: new Map() }," +
    " get authoritative(){return false;}, groups: [], declaredFolders: new Set() };",
  "prepareState.svelte.js":
    "export const prepareState = { assets: new Map(), preparedBytesFor(){return undefined;}," +
    " producedKeys(){return [];}, assetSourceOf(){return undefined;}, preparedSize(){return undefined;} };",
  "discoveryWire.svelte.js": "export const variantHints = { get(){return undefined;} };",
};
await esbuild.build({
  entryPoints: [join(here, "../src/lib/romSelection.svelte.ts")],
  outdir: join(out, "sel"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { $state: "__rune", $derived: "__derived" },
  banner: { js: "const __rune=(v)=>v; const __derived=(v)=>v; __derived.by=(f)=>f();" },
  logLevel: "warning",
  plugins: [
    gnwResolve(join(here, ".")),
    {
      name: "titlesize-sel-fakes",
      setup(build) {
        build.onResolve(
          { filter: /(library\.svelte|device\.svelte|romScan|consoles|homebrewTitles\.svelte|libraryScan|coreRegistry\.svelte|prepareState\.svelte|discoveryWire\.svelte)\.js$/ },
          (a) => ({ path: a.path.slice(a.path.lastIndexOf("/") + 1), namespace: "ts-sel" }),
        );
        build.onLoad({ filter: /.*/, namespace: "ts-sel" }, (a) => ({ contents: selFakes[a.path], loader: "js" }));
      },
    },
  ],
});
const selMod = await import(pathToFileURL(join(out, "sel", "romSelection.svelte.js")).href);
const { romSelection: sel } = selMod;

// --- Fixtures ----------------------------------------------------------------------------------

const bytes = (n, fill) => new Uint8Array(n).fill(fill);

globalThis.__tsFakes = {
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
  globalThis.__tsFakes.artifacts = async () => artifacts;
  globalThis.__tsFakes.convert = async () => ({ files: converted, unrecognised: [], warnings: [] });
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


// OpenLara's real published shape (dist/v0.0.1/manifest.json): one shipped binary of exactly
// 139903 bytes, and a converter whose single output declares an EXTENSION and no filename, so
// every level it produces is named by the run.
const OPENLARA_BIN = 139903;
const olTitle = () =>
  title({ repo: "slash-proc/openlara-retro-go-sd", id: "gnw-retro-go", artifacts: [{ filename: "OpenLara.bin" }] });
const olManifest = {
  tools: [{ id: "openlara-levels", outputs: [{ id: "pkd", extension: ".PKD" }] }],
};
const olTarget = {
  artifacts: [{ filename: "OpenLara.bin", bytes: OPENLARA_BIN }],
  uses: [{ tool: "openlara-levels", outputs: ["pkd"] }],
};
const NOT_BUILT = () => undefined;

// --- 1. Unprepared: the store claims nothing ----------------------------------------------------
//
// Nothing has run, so there are no bytes to report and no name for a level that does not exist.
// `undefined` is what sends `getHomebrewSize` to its device-files fallback, which is the number
// an install would write right now: the shipped files and no more.

await check("an unprepared title has prepared nothing, and says so", async () => {
  reset();
  eq(prepareState.preparedBytesFor(olTitle().key), undefined, "no provenance yet");
  eq(prepareState.preparedOutputsFor(olTitle().key).length, 0, "and no named outputs");
});

// --- 2. Prepared: the binary AND every converted level -------------------------------------------
//
// THE OWNER'S CASE. Mutation: summing `deviceFiles` instead of `produced` reports 139903 here,
// which is the 136.62 KB he saw.

await check("a prepared title counts its converted levels, not just its binary", async () => {
  reset();
  const t = olTitle();
  await prepare(t, {
    artifacts: new Map([["OpenLara.bin", bytes(OPENLARA_BIN, 3)]]),
    converted: new Map([
      ["LEVEL1.PKD", bytes(4096, 1)],
      ["LEVEL2.PKD", bytes(8192, 2)],
    ]),
  });
  eq(prepareState.preparedBytesFor(t.key), OPENLARA_BIN + 4096 + 8192, "binary plus both levels");
  ok(prepareState.preparedBytesFor(t.key) > OPENLARA_BIN, "and strictly more than the binary alone");
});

// --- 3. Partially prepared: exact for what exists ------------------------------------------------
//
// `runPerFile` means one level at a time, so a half-converted shelf is the normal state. The
// number is not an estimate of the finished set; it is what an install would write now.

await check("a partially prepared title counts exactly what has been built", async () => {
  reset();
  const t = olTitle();
  await prepare(t, {
    artifacts: new Map([["OpenLara.bin", bytes(OPENLARA_BIN, 3)]]),
    converted: new Map([["LEVEL1.PKD", bytes(4096, 1)]]),
  });
  eq(prepareState.preparedBytesFor(t.key), OPENLARA_BIN + 4096, "one level, counted once");
});

// --- 4. The budget cannot under-count ------------------------------------------------------------
//
// `currentEstSize` and `validateFit` spend this number against the flash gap, so it must equal
// every byte the title is holding -- not a subset chosen by name.

await check("the total is every byte the title produced, so a budget cannot under-count", async () => {
  reset();
  const t = olTitle();
  await prepare(t, {
    artifacts: new Map([["OpenLara.bin", bytes(OPENLARA_BIN, 3)]]),
    converted: new Map([["A.PKD", bytes(1024, 1)], ["B.PKD", bytes(2048, 2)], ["C.PKD", bytes(512, 3)]]),
  });
  let held = 0;
  for (const v of prepareState.assets.values()) held += v.length;
  eq(prepareState.preparedBytesFor(t.key), held, "matches everything in the store");
});

// --- 5. A title with only NAMED outputs is unchanged ----------------------------------------------

await check("a title whose outputs all declare a filename is unaffected", async () => {
  reset();
  const t = title({ repo: "o/hb", id: "t", artifacts: [{ filename: "app.bin" }] });
  await prepare(t, {
    artifacts: new Map([["app.bin", bytes(200, 1)]]),
    converted: new Map([["assets.dat", bytes(300, 2)]]),
  });
  eq(prepareState.preparedBytesFor(t.key), 500, "binary plus its named output");
});

// --- 6. Converted outputs are told apart from shipped ones ----------------------------------------
//
// "What gets installed" lists shipped files from the manifest and converted ones from the run,
// so the accessor must return the second half only.

await check("preparedOutputsFor returns the CONVERTER's files, not the shipped binary", async () => {
  reset();
  const t = olTitle();
  await prepare(t, {
    artifacts: new Map([["OpenLara.bin", bytes(OPENLARA_BIN, 3)]]),
    converted: new Map([["LEVEL1.PKD", bytes(4096, 1)]]),
  });
  const outs = prepareState.preparedOutputsFor(t.key);
  eq(outs.length, 1, "one converted file");
  eq(outs[0].filename, "LEVEL1.PKD", "named by its run");
  eq(outs[0].bytes, 4096, "with its real size");
  ok(!outs.some((o) => o.filename === "OpenLara.bin"), "and the shipped binary is not one of them");
});

// --- 7. The Configure page lists built levels and totals them -------------------------------------
//
// The third surface, and a SECOND independent computation: `composeInstallRows` skipped an
// output with no `filename` outright, so the page totalled the binary alone.

await check("What gets installed lists the built levels and totals them", () => {
  const built = [
    { filename: "LEVEL1.PKD", bytes: 4096 },
    { filename: "LEVEL2.PKD", bytes: 8192 },
  ];
  const rows = composeInstallRows(olTarget, olManifest, NOT_BUILT, () => built);
  eq(rows.length, 3, "the binary and both levels");
  eq(rows[0].filename, "OpenLara.bin", "shipped first");
  eq(rows[1].type, "built", "then the run's own files");
  eq(installTotal(rows), OPENLARA_BIN + 4096 + 8192, "and the total counts them");
});

// --- 8. Before the run there is still no name to promise ------------------------------------------
//
// The rule that was already right stays right: an extension-only output that has produced
// nothing contributes no row, because the manifest never stated a filename for it.

await check("an unbuilt derived output is still not named", () => {
  const rows = composeInstallRows(olTarget, olManifest, NOT_BUILT, () => []);
  eq(rows.length, 1, "the shipped binary only");
  eq(rows[0].filename, "OpenLara.bin", "and nothing invented beside it");
});

// --- 9. Deselecting gives the bytes back --------------------------------------------------------
//
// The owner: preparing OpenLara added 42.92 MB to the net change, and deselecting it dropped
// that only to 42.79 MB -- the 0.13 MB that left is `OpenLara.bin`, which the packer drops on
// its own through `selectedHomebrew`. The converted `.PKD` levels had no such gate, so they
// stayed in the image. Doom moved not at all: its `.whd` games reach the image ONLY through the
// merge of `prepareState.assets`, which consulted nothing. One cause, two symptoms; clearing
// the cache "fixed" both only because that is what emptied `assets`.
//
// These drive the REAL store, so `produced` and `assetSource` are the real provenance.

const sizeOf = (m) => [...m.values()].reduce((n, b) => n + b.length, 0);

/** The three inputs the component reads off `prepareState`, wired to the real store. */
const wire = (rows, selectedRowKeys, selectedTitleKeys) => ({
  assets: prepareState.assets,
  sourceOf: (k) => prepareState.assetSourceOf(k),
  producedBy: (k) => prepareState.producedKeys(k),
  rows,
  selectedRowKeys: new Set(selectedRowKeys),
  selectedTitleKeys: new Set(selectedTitleKeys),
});

await check("a deselected homebrew title takes its CONVERTED bytes out of the install", async () => {
  reset();
  const t = title({ id: "openlara", artifacts: [{ filename: "OpenLara.bin" }] });
  await prepare(t, {
    artifacts: new Map([["OpenLara.bin", bytes(139903, 7)]]),
    converted: new Map([["LEVEL1.PKD", bytes(4096, 2)], ["LEVEL2.PKD", bytes(8192, 3)]]),
  });
  const all = sizeOf(prepareState.assets);
  eq(all, 139903 + 4096 + 8192, "the fixture is the shape the owner has: one binary plus levels");

  const kept = selectedPreparedAssets(wire([], [], [t.key]));
  eq(sizeOf(kept), all, "selected, every prepared byte installs");

  const dropped = selectedPreparedAssets(wire([], [], []));
  eq(sizeOf(dropped), 139903, "deselected, only the artifact remains -- the levels are gone");
  ok(!("" + [...dropped.keys()]).includes("PKD"), "and no converted level is still named");
});

await check("a deselected game takes its converted output out of the install", async () => {
  reset();
  const t = title({ id: "doom" });
  await prepare(t, { converted: new Map([["The Ultimate Doom.whd", bytes(10_000, 4)]]) });
  const whdKey = [...prepareState.assets.keys()][0];
  const system = whdKey.slice(0, whdKey.lastIndexOf("/"));
  const rows = [{ key: "doom/DOOM.WAD", system, outputName: "The Ultimate Doom.whd" }];

  eq(sizeOf(selectedPreparedAssets(wire(rows, ["doom/DOOM.WAD"], []))), 10_000, "selected, it installs");
  eq(sizeOf(selectedPreparedAssets(wire(rows, [], []))), 0, "deselected, it does not");
});

await check("one game leaving does not take its sibling with it", async () => {
  reset();
  const t = title({ id: "doom" });
  await prepare(t, {
    converted: new Map([["Doom.whd", bytes(10_000, 4)], ["Doom II.whd", bytes(20_000, 5)]]),
  });
  const anyKey = [...prepareState.assets.keys()][0];
  const system = anyKey.slice(0, anyKey.lastIndexOf("/"));
  const rows = [
    { key: "a.wad", system, outputName: "Doom.whd" },
    { key: "b.wad", system, outputName: "Doom II.whd" },
  ];
  // Per-GAME granularity: both were produced by the one core title, so a title-level filter
  // would keep both. The row is the unit because the selection is.
  eq(sizeOf(selectedPreparedAssets(wire(rows, ["b.wad"], []))), 20_000, "only the selected game's output");
});

await check("an ARTIFACT is never filtered out -- a core's engine is not this module's call", async () => {
  reset();
  const t = title({ id: "core", artifacts: [{ filename: "engine.bin" }] });
  await prepare(t, { artifacts: new Map([["engine.bin", bytes(5000, 9)]]), converted: new Map() });
  eq(sizeOf(selectedPreparedAssets(wire([], [], []))), 5000, "selected by nothing, still shipped");
});

await check("a row with no output name claims nothing", async () => {
  reset();
  const t = title({ id: "doom" });
  await prepare(t, { converted: new Map([["Doom.whd", bytes(10_000, 4)]]) });
  const anyKey = [...prepareState.assets.keys()][0];
  const system = anyKey.slice(0, anyKey.lastIndexOf("/"));
  // An unprepared row is selected and has no output; it must not sweep a sibling's bytes in.
  eq(sizeOf(selectedPreparedAssets(wire([{ key: "x.wad", system }], ["x.wad"], []))), 0,
    "a selected row with nothing built keeps nothing");
});

await check("run() records a source for every asset key it writes", async () => {
  reset();
  const t = title({ id: "mixed", artifacts: [{ filename: "bin.bin" }] });
  await prepare(t, {
    artifacts: new Map([["bin.bin", bytes(16, 1)]]),
    converted: new Map([["out.dat", bytes(32, 2)]]),
  });
  // The filter keeps an unrecorded key, deliberately (a wrong number beats a broken install).
  // That fallback must never become the normal case, so pin that provenance is total.
  for (const k of prepareState.assets.keys()) {
    ok(prepareState.assetSourceOf(k) !== undefined, `no source recorded for ${k}`);
  }
  eq(prepareState.producedKeys(t.key).length, 2, "and both keys are provenance for the title");
});

// --- 10. The call sites actually use it -----------------------------------------------------------
//
// Everything above proves the RULE. None of it noticed when I reverted one call site to
// `extractedAssets` -- the module stayed right and the install went back to being wrong, which
// is precisely how the defect existed in the first place. The component cannot be imported
// (Svelte), so this reads its source.
//
// Comments are stripped first: the explanation of this very bug names `extractedAssets` several
// times, and a grep whose corpus includes its own commentary vouches for whatever it is hunting.

await check("every install map merges the SELECTED assets, never the whole store", () => {
  const raw = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8");
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // `for (const [k, v] of SOURCE) TARGET.set(k, v)` -- the merge shape, however it is spelled.
  const merges = [...code.matchAll(/for\s*\(const\s*\[k,\s*v\]\s*of\s*(\w+)(?:\.entries\(\))?\)\s*(\w+)\.set\(k,\s*v\)/g)];
  ok(merges.length >= 3, `expected the preview and both installs, found ${merges.length}`);

  const fromStore = merges.filter((m) => m[1] === "extractedAssets");
  eq(fromStore.length, 0,
    `an install map is still merging the whole asset store: ${fromStore.map((m) => `${m[1]} -> ${m[2]}`).join(", ")}`);
  ok(merges.some((m) => m[1] === "selectedAssets"), "and the filtered map is the one being merged");
});

// --- A core is not a homebrew title ------------------------------------------------------------
//
// The owner, with Doom prepared: "once I hit prepare, it adds the size of a doom release and
// doesn't go away. I have to do a workaround for it to go away." The workaround was clearing the
// cache, which is the only thing that empties `prepareState.assets`.
//
// `runPrepare()` force-selects a title after a successful run. `homebrew.titles` holds cores as
// well ("targets with something to prepare"), so a core landed in `selectedHomebrewKeys` -- and
// from there in `hbAdditionsBytes`, which adds `preparedBytesFor`, the WHOLE run. A core's games
// are GAME ROWS, and a row toggle writes `overrides`, never `homebrewOverrides`, so nothing the
// user could click took it out again.

const DOOM = {
  key: "sylverb/doom#doom",
  isCore: true,
  deviceFiles: ["doom.bin"],
  displayName: "Doom",
};
const OPENLARA = {
  key: "xproger/openlara#openlara",
  isCore: false,
  deviceFiles: ["OpenLara.bin"],
  displayName: "OpenLara",
};
const withTitles = (titles, fn) => {
  const hb = globalThis.__tsHb;
  const prev = hb.titles;
  hb.titles = titles;
  try {
    return fn();
  } finally {
    hb.titles = prev;
    for (const t of titles) sel.homebrewOverrides.delete(t.key);
  }
};

await check("preparing a CORE does not put it in the homebrew selection", () => {
  withTitles([DOOM, OPENLARA], () => {
    // Exactly the state runPrepare() leaves behind for both.
    sel.toggleHomebrew(DOOM.key, true);
    sel.toggleHomebrew(OPENLARA.key, true);
    const keys = [...sel.selectedHomebrewKeys];
    ok(!keys.includes(DOOM.key), `a core is in the homebrew selection: ${JSON.stringify(keys)}`);
    ok(keys.includes(OPENLARA.key), "a real homebrew title is still selected");
  });
});

await check("a core's prepared bytes cannot reach the summary through the title", () => {
  withTitles([DOOM], () => {
    sel.toggleHomebrew(DOOM.key, true);
    // `hbAdditionsBytes` and the footprint total both iterate this set and add
    // getHomebrewSize(k) == preparedBytesFor(k). An empty set is a zero contribution.
    eq(sel.selectedHomebrewKeys.size, 0, "the set the byte totals iterate is empty for a core");
  });
});

await check("a core's converted outputs are not wanted by title, only by row", () => {
  // The other half of the same cause: selectedAssets keeps every key a SELECTED TITLE produced,
  // so a force-selected core shipped its .whd files whatever the rows said.
  const system = "doom";
  const rows = [{ key: "doom/DOOM.WAD", system, outputName: "The Ultimate Doom.whd" }];
  const assets = new Map([[`${system}/The Ultimate Doom.whd`, new Uint8Array(21_980_000)]]);
  const wireCore = (selectedRowKeys, selectedTitleKeys) => ({
    assets,
    sourceOf: () => "converted",
    producedBy: (k) => (k === DOOM.key ? [`${system}/The Ultimate Doom.whd`] : []),
    rows,
    selectedRowKeys: new Set(selectedRowKeys),
    selectedTitleKeys: new Set(selectedTitleKeys),
  });
  const sizeOfMap = (m) => [...m.values()].reduce((n, v) => n + v.length, 0);
  eq(sizeOfMap(selectedPreparedAssets(wireCore(["doom/DOOM.WAD"], []))), 21_980_000,
    "the row selected, its output installs");
  eq(sizeOfMap(selectedPreparedAssets(wireCore([], []))), 0,
    "the row deselected and the core absent from the title set, nothing installs");
});

await check("the byte totals and the install filter both read the homebrew SELECTION", () => {
  // The wiring, not the rule. The last pass shipped a fix whose checks proved the rule while a
  // call site still merged the whole store, which is how this survived to be reported twice.
  const tab = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  for (const name of ["hbAdditionsBytes", "hbRemovalsBytes"]) {
    const at = tab.indexOf(`const ${name}`);
    ok(at > -1, `${name} is gone -- this check needs re-pointing, not deleting`);
    // Bound the window to THIS declaration. A fixed-width slice reached into the next one,
    // which also names the set, so rewiring this one alone passed -- the slice-past-the-thing
    // failure the mutation notes warn about.
    const end = tab.indexOf("\n  });", at);
    ok(end > at, `${name} does not end where expected; re-point this check`);
    const body = tab.slice(at, end);
    ok(/romSelection\.selectedHomebrewKeys/.test(body),
      `${name} no longer reads selectedHomebrewKeys, so excluding cores there cannot reach it`);
  }
  ok(/selectedTitleKeys:\s*romSelection\.selectedHomebrewKeys/.test(tab),
    "selectedAssets is no longer fed from selectedHomebrewKeys, so a core could ship by title again");
});

// --- A converter's INPUT never reaches the card ------------------------------------------------
//
// The owner's card carried `roms/doom/doom.wad` (12996515 B) and `doom2.wad` (14951361 B) beside
// the `.whd` games they become -- ~27 MB of his own source files. `Game.role` has said since
// gameRows.ts that an ingestable is "a real Library file that is NEVER copied to the card", and
// `coreregistry.mjs` pins that a `.wad` classifies that way; nothing enforced it. A row's
// identity is the INPUT's key, so selecting a Doom game selected the WAD.
//
// This pins the ENFORCEMENT. The role assignment is coreregistry.mjs's; the end-to-end map is
// not driven here, because `plannedInstallNames` reads `library.scan` and the derived row list,
// both faked in this harness -- see the report note.
await check("selectedFolderRoms drops a converter input, whatever the selection says", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(here, "../src/lib/romSelection.svelte.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  // Bound on the NEXT method, not on `return { planned, bytes }` -- the function has an early
  // return of exactly that shape above the loop, so slicing there cut the code under test out
  // and the check failed against correct source.
  const fn = src.slice(src.indexOf("private plannedInstallNames"));
  const body = fn.slice(0, fn.indexOf("selectedFolderRoms()"));
  ok(/role === "ingestable"/.test(body),
    "plannedInstallNames must consult Game.role -- selection alone let the input through");
  // The SKIP itself, not merely the set. Matching any `continue` passed with the guard deleted:
  // the loop has other continues, and the set alone gates nothing.
  ok(/if\s*\(\s*ingestable\.has\(\s*key\s*\)\s*\)\s*continue\s*;/.test(body),
    "an ingestable key is skipped, not just collected into a set nothing reads");
  const gate = body.search(/ingestable\.has\(/);
  ok(gate >= 0 && gate < body.indexOf("planned.push"),
    "the skip precedes the push, so an input is never planned in the first place");
});

// --- Report ---------------------------------------------------------------------------------------

rmSync(out, { recursive: true, force: true });
if (failures.length > 0) {
  console.error(`title size: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`title size: ${passed} checks passed`);
