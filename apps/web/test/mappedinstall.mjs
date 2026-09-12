#!/usr/bin/env node
/**
 * A MAPPED artifact reaches FrogFS and is relocated -- including after a reload.
 *
 *   docker exec gnw-web-builder-dev-1 sh -c 'cd /app/apps/web && node test/mappedinstall.mjs'
 *
 * THE SEAM NOTHING COVERED. `simflash.mjs` and `gba-e2e.mjs` start BELOW this: they hand
 * `buildFlashInstall` a `mappedArtifacts` map already built, and prove the packer places and
 * relocates it. Everything ABOVE it was source-read wiring checks (`corefetch.mjs`,
 * `coreinstallwiring.mjs`), which cannot see a value that is right in one state and empty in
 * another. The defect below lived exactly in that gap and every suite passed.
 *
 * THE DEFECT. `gba.xip` is the GBA core's cold half, executed in place out of memory-mapped
 * QSPI, so it must be ONE contiguous run at a known address -- which only FrogFS gives. Its
 * manifest role is `cores/`, and `cores/` routes to LittleFS, so `mapped` has to override the
 * role. That override is driven by `prepareState.mappedArtifacts`, and only `run()` and
 * `prepareCoreArtifacts()` ever recorded it. `restore()` -- the reload path -- put the BYTES
 * back and recorded `assets`, `assetSource` and `produced`, but not the mapped facts. So:
 *
 *   1. `produced` is populated, so `preparedBytesFor()` returns a number,
 *   2. so `ensureCoresPrepared` calls the core "already prepared" and skips the fetch,
 *   3. which was the only thing left that would have recorded `relocBase`,
 *   4. so the packer sees no mapped key, files `gba.xip` in LittleFS with the rest of `cores/`,
 *   5. and relocates nothing.
 *
 * Every byte is present and the install reports success. The core cannot run. It worked in the
 * session that prepared it and broke on the next reload, which is why it read as intermittent.
 *
 * WHAT IS REAL HERE. The REAL `prepareState` (runes stubbed), the REAL `selectedAssets.ts` and
 * `coreGate.ts`, the REAL `buildFrogfsImage` over the REAL FrogFS builder, read back with the
 * REAL parser. Only the network (`installArtifacts`), the converter and the locale table are
 * faked. Synthetic bytes throughout, so this runs in a fresh checkout with no assets.
 *
 * The two derivations that live in `views/RomManagementTab.svelte` (`selectedAssets`,
 * `mappedArtifacts`) cannot be imported out of a component instance script, so they are
 * restated in `deriveMapped()` below. That restatement is itself pinned: `derivation matches
 * the component` reads the component source and fails if either derivation's shape moves.
 */
import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { gnwResolve, gnwResolveFor } from "./gnwResolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const LITTLEFS_WASM = join(repoRoot, "packages/fs-builders/vendor/littlefs-wasm/littlefs.wasm");
const out = mkdtempSync(join(tmpdir(), "gnw-mappedinstall-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));

let passed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e && e.message ? e.message : e}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

// --- builds ------------------------------------------------------------------------------
const fake = {
  "homebrewConvert.js": "export async function convertHomebrewTitle(){ throw new Error('the converter must not run here'); }",
  "installArtifacts.js": "export async function fetchTargetArtifacts(t){ return globalThis.__mi.artifacts(t); }",
  "locale.svelte.js": "export const locale = { t: { roms: { selectGames: { convertFailed:(c)=>`CF|${c}`, convertUnrecognised:(f)=>`UR|${f}` } } } };",
};
const srcDir = join(here, "../src/lib/sources");
await esbuild.build({
  entryPoints: [join(srcDir, "prepareState.svelte.ts")],
  outdir: join(out, "store"), bundle: true, format: "esm", platform: "neutral", target: "es2022",
  define: { $state: "__rune" }, banner: { js: "const __rune=(v)=>v;" }, logLevel: "warning",
  plugins: [gnwResolve(join(here, ".")), {
    name: "mi-fakes", setup(b) {
      b.onResolve({ filter: /(homebrewConvert|installArtifacts|locale\.svelte)\.js$/ },
        (a) => ({ path: a.path.slice(a.path.lastIndexOf("/") + 1), namespace: "mi" }));
      b.onLoad({ filter: /.*/, namespace: "mi" }, (a) => ({ contents: fake[a.path], loader: "js" }));
    },
  }],
});
await esbuild.build({
  entryPoints: [join(srcDir, "selectedAssets.ts"), join(srcDir, "coreGate.ts")],
  outdir: join(out, "pure"), bundle: true, format: "esm", platform: "neutral", target: "es2022",
  logLevel: "warning", plugins: [gnwResolve(join(here, "."))],
});
await esbuild.build({
  entryPoints: [join(here, "../src/lib/engine/flashInstall.ts")],
  outdir: join(out, "eng"), bundle: true, format: "esm", platform: "neutral", target: "es2022",
  external: ["@gnw/*"], logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url), {
    name: "url-assets", setup(b) {
      b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: "ua" }));
      b.onLoad({ filter: /.*/, namespace: "ua" }, (a) => ({
        contents: `export default ${JSON.stringify(/littlefs\.wasm/.test(a.path) ? LITTLEFS_WASM : "asset:UNSTUBBED")};`, loader: "js" }));
    },
  }, {
    // compress:false everywhere on this path, so an invocation is a hard failure, not a stub.
    name: "stub-patch", setup(b) {
      b.onResolve({ filter: /^\.\/patch\.js$/ }, () => ({ path: "p", namespace: "s" }));
      b.onLoad({ filter: /^p$/, namespace: "s" }, () => ({
        contents: `export async function loadLiblzma(){ return () => { throw new Error("lzmaRaw was invoked"); }; }`, loader: "js" }));
    },
  }, {
    name: "stub-flasher", setup(b) {
      b.onResolve({ filter: /^\.\/flasher\.js$/ }, () => ({ path: "f", namespace: "s2" }));
      b.onLoad({ filter: /^f$/, namespace: "s2" }, () => ({
        contents: `export async function flashImage(){ throw new Error("no device write in this suite"); }`, loader: "js" }));
    },
  }],
});

const storeUrl = pathToFileURL(join(out, "store", "prepareState.svelte.js")).href;
const { selectedPreparedAssets } = await import(pathToFileURL(join(out, "pure", "selectedAssets.js")).href);
const { applyCorePolicy, unusedCores } = await import(pathToFileURL(join(out, "pure", "coreGate.js")).href);
const { buildFrogfsImage } = await import(pathToFileURL(join(out, "eng", "flashInstall.js")).href);
const { parseFrogfs } = await import(pathToFileURL(join(repoRoot, "packages/fs-builders/dist/frogfsParse.js")).href);

// --- fixtures ----------------------------------------------------------------------------
const bytes = (n, f) => new Uint8Array(n).fill(f);
const RELOC_BASE = 0xdec00000; // the GBA sentinel, docs/MAPPED_ARTIFACTS.md
const EXTBASE = 0x90000000;
const FROGFS_OFFSET = 0x100000;
const GBA_BIN = bytes(4096, 0xaa);
/** Four sentinel words, so "relocated" is a COUNT this suite can pin, not a boolean. */
const SENTINEL_WORDS = 4;
function xipBytes() {
  const b = bytes(8192, 0xbb);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < SENTINEL_WORDS; i++) dv.setUint32(i * 4, RELOC_BASE + i * 0x40, true);
  return b;
}
const GBA_XIP = xipBytes();
const SHA_BIN = "a".repeat(64), SHA_XIP = "b".repeat(64), SHA_TOOL = "c".repeat(64);

const TARGET = {
  id: "gnw-retro-go", kind: "core", platform: "game-and-watch", label: "Game & Watch (Retro-Go SD)",
  systems: [{ id: "gba", longName: "Game Boy Advance", folder: "gba", extensions: [".gba"] }],
  artifacts: [
    { filename: "gba.bin", bytes: GBA_BIN.length, sha256: SHA_BIN, url: "https://x/gba.bin" },
    // The whole point: role `cores/`, but addressable memory.
    { filename: "gba.xip", bytes: GBA_XIP.length, sha256: SHA_XIP, url: "https://x/gba.xip",
      mapped: true, relocBase: RELOC_BASE },
  ],
};
const REPO = "slash-proc/gba-retro-go-sd";
const TKEY = `${REPO}#${TARGET.id}`;
/** A core WITH a converter, which is what puts it in `homebrew.titles` and so in `restore()`. */
const TITLE = {
  key: TKEY, repo: REPO, targetId: TARGET.id, isCore: true, label: "gpSP", displayName: "gba",
  deviceFiles: ["gba.bin", "gba.xip"], derivedOutputs: 0, target: TARGET,
  tool: { id: "bios", binary: { sha256: SHA_TOOL }, inputs: [{ id: "bios", extensions: [".bin"] }] },
};

globalThis.__mi = { artifacts: async () => new Map([["gba.bin", GBA_BIN], ["gba.xip", GBA_XIP]]) };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const DEFAULT_CONTENT = new Map([["cores/nes.bin", bytes(64, 1)], ["roms/nes/game.nes", bytes(256, 2)]]);
const bundle = () => ({ manifest: { cores: [], dist: { paths: undefined } }, contentFor: () => new Map(DEFAULT_CONTENT) });

/** A fresh store per state, as a reload gives. */
let storeSeq = 0;
const freshStore = async () => (await import(`${storeUrl}?n=${storeSeq++}`)).prepareState;

/** The converted cache a reload reads, holding this title's artifacts. */
const restoreDeps = () => ({
  cache: { async get(k) { return new Map([[SHA_BIN, GBA_BIN], [SHA_XIP, GBA_XIP]]).get(k) ?? null; },
           async put() { return true; } },
  index: { entries: () => [[TKEY, { sig: "s", tool: SHA_TOOL, repo: REPO, inputs: ["bios"], files: {}, warnings: [] }]],
           set() {}, remove() {} },
});

/**
 * `views/RomManagementTab.svelte`'s `selectedAssets` and `mappedArtifacts`, restated.
 * Pinned against the component source by the last check in this file.
 */
function deriveMapped(ps) {
  const selectedSystems = new Set(["gba"]);
  const gate = unusedCores({
    titles: [{ key: TKEY, isCore: true }],
    systemsOf: (k) => (k === TKEY ? ["gba"] : []),
    selectedSystems,
    producedBy: (k) => ps.producedKeys(k),
    sourceOf: (k) => ps.assetSourceOf(k),
    medium: "flash",
  });
  const selectedAssets = applyCorePolicy(
    selectedPreparedAssets({
      assets: ps.assets,
      sourceOf: (k) => ps.assetSourceOf(k),
      producedBy: (k) => ps.producedKeys(k),
      rows: [{ key: "gba/Pokemon.gba", system: "gba" }],
      selectedRowKeys: new Set(["gba/Pokemon.gba"]),
      selectedTitleKeys: new Set(),
    }),
    new Set(gate.flatMap((c) => c.keys)),
  );
  const all = ps.mappedArtifactMap();
  let mappedArtifacts;
  if (all.size > 0) {
    const m = new Map();
    for (const [key, data] of selectedAssets) {
      const spec = all.get(key);
      if (!spec) continue;
      m.set(key, { ...(spec.relocBase === undefined ? {} : { relocBase: spec.relocBase }), bytes: data.length });
    }
    mappedArtifacts = m.size > 0 ? m : undefined;
  }
  return { selectedAssets, mappedArtifacts };
}

/** The whole seam: a prepared store -> a packed image, read back. */
async function packFrom(ps) {
  const { selectedAssets, mappedArtifacts } = deriveMapped(ps);
  const userRoms = new Map([["gba/Pokemon.gba", bytes(1024, 0x33)]]);
  for (const [k, v] of selectedAssets) userRoms.set(k, v);
  const built = await buildFrogfsImage(bundle(), 1, userRoms, {
    installAllCores: false, selectedHomebrew: new Set(), homebrewTitles: [TITLE],
    mappedArtifacts, frogfsOffset: FROGFS_OFFSET,
  });
  return {
    built,
    frogfsPaths: parseFrogfs(built.frogfs).files.map((f) => f.path).sort(),
    frogfsFiles: parseFrogfs(built.frogfs).files,
    lfsPaths: built.plan.coreFiles.map((f) => f.path).sort(),
  };
}

/** Every assertion the firmware actually depends on, over one packed image. */
function assertXipIsUsable(r, label) {
  assert(r.frogfsPaths.includes("cores/gba.xip"),
    `${label}: cores/gba.xip is NOT in FrogFS (it holds: ${r.frogfsPaths.join(", ")})`);
  assert(!r.lfsPaths.includes("cores/gba.xip"),
    `${label}: cores/gba.xip is in the LittleFS cores tree, which has no contiguous address`);
  assert(r.lfsPaths.includes("cores/gba.bin"),
    `${label}: cores/gba.bin left LittleFS, so the split core is no longer whole`);
  const e = r.frogfsFiles.find((f) => f.path === "cores/gba.xip");
  eq(e.dataSize, GBA_XIP.length, `${label}: the packed xip is the wrong size`);
  eq(e.dataOffs % 4, 0, `${label}: the xip data offset is not 4-byte aligned`);
  // Relocated to where it really lands, from the sentinel the manifest declares.
  const placed = r.built.mappedPlaced.find((m) => m.path === "cores/gba.xip");
  assert(placed, `${label}: nothing was relocated`);
  eq(placed.address >>> 0, (EXTBASE + FROGFS_OFFSET + e.dataOffs) >>> 0, `${label}: wrong address`);
  eq(placed.patched, SENTINEL_WORDS, `${label}: wrong number of words relocated`);
  // And the BYTES really changed: a patched count is a claim, the image is the fact.
  const dv = new DataView(r.built.frogfs.buffer, r.built.frogfs.byteOffset, r.built.frogfs.byteLength);
  for (let i = 0; i < SENTINEL_WORDS; i++) {
    eq(dv.getUint32(e.dataOffs + i * 4, true) >>> 0, (placed.address + i * 0x40) >>> 0,
      `${label}: word ${i} was not rebased in the packed image`);
  }
}

// --- 1. the state that always worked ------------------------------------------------------
await check("a freshly fetched core puts its mapped half in FrogFS, relocated", async () => {
  const ps = await freshStore();
  assert(await ps.prepareCoreArtifacts(TKEY, TARGET), "prepareCoreArtifacts refused the target");
  assertXipIsUsable(await packFrom(ps), "fresh fetch");
});

// --- 2. THE REGRESSION --------------------------------------------------------------------
await check("a core RESTORED after a reload still puts its mapped half in FrogFS", async () => {
  const ps = await freshStore();
  await ps.restore([TITLE], restoreDeps());
  // The precondition that makes this the real path: the install skips the fetch here.
  assert(ps.preparedBytesFor(TKEY) !== undefined,
    "the fixture does not reproduce a restored core: ensureCoresPrepared would still fetch");
  assertXipIsUsable(await packFrom(ps), "after a reload");
});

await check("restore records the mapped facts, not just the bytes", async () => {
  const ps = await freshStore();
  await ps.restore([TITLE], restoreDeps());
  const m = ps.mappedArtifactMap();
  eq(m.get("cores/gba.xip")?.relocBase, RELOC_BASE, "the restored xip lost its relocBase");
  eq(m.has("cores/gba.bin"), false, "gba.bin is not mapped and must not be recorded as such");
});

await check("a restored core is byte-identical to a fetched one, in every map", async () => {
  const fetched = await freshStore();
  await fetched.prepareCoreArtifacts(TKEY, TARGET);
  const restored = await freshStore();
  await restored.restore([TITLE], restoreDeps());
  for (const [label, get] of [
    ["assets", (p) => [...p.assets.keys()].sort()],
    ["produced", (p) => [...p.producedKeys(TKEY)].sort()],
    ["mapped", (p) => [...p.mappedArtifactMap().entries()].map(([k, v]) => `${k}=${v.relocBase}`).sort()],
  ]) {
    eq(JSON.stringify(get(restored)), JSON.stringify(get(fetched)), `${label} differs after a reload`);
  }
});

// --- 3. the negative case, so the assertions above are not always true ---------------------
await check("ANTI-VACUITY: with no mapped facts the xip really does fall into LittleFS", async () => {
  const ps = await freshStore();
  await ps.prepareCoreArtifacts(TKEY, TARGET);
  // Exactly the state the defect produced: bytes present, mapped facts absent.
  const stripped = {
    assets: ps.assets,
    producedKeys: (k) => ps.producedKeys(k),
    assetSourceOf: (k) => ps.assetSourceOf(k),
    mappedArtifactMap: () => new Map(),
  };
  const r = await packFrom(stripped);
  assert(!r.frogfsPaths.includes("cores/gba.xip"),
    "with no mapped facts the xip reached FrogFS anyway, so these checks prove nothing");
  assert(r.lfsPaths.includes("cores/gba.xip"), "the xip did not land in LittleFS either");
  eq(r.built.mappedPlaced.length, 0, "something was relocated with no mapped facts");
});

// --- 4. the restatement above is pinned to the component ----------------------------------
await check("derivation matches the component: mappedArtifacts is narrowed by selectedAssets", () => {
  const src = readFileSync(join(here, "../src/lib/views/RomManagementTab.svelte"), "utf8");
  const at = src.indexOf("const mappedArtifacts = $derived.by(");
  assert(at > 0, "RomManagementTab no longer derives mappedArtifacts; update deriveMapped() here");
  const body = src.slice(at, src.indexOf("});", at));
  for (const [needle, why] of [
    ["prepareState.mappedArtifactMap()", "the mapped facts no longer come from prepareState"],
    ["of selectedAssets", "the map is no longer narrowed to what this install writes"],
    ["relocBase", "relocBase is no longer carried to the packer"],
  ]) assert(body.includes(needle), `${why} -- deriveMapped() in this suite is now stale`);
  // And the packer is still told about it.
  assert(/mappedArtifacts,/.test(src), "buildFrogfsImage is no longer passed mappedArtifacts");
});

console.log(failures.map((f) => `  FAIL ${f}`).join("\n"));
console.log(`\nmappedinstall: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
