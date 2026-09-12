#!/usr/bin/env node
/**
 * Build both flash partitions from the REAL published firmware release, then assert every file
 * landed in the partition the firmware actually reads it from.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/releaseimage.mjs'
 *
 * WHY THIS EXISTS. Every other suite here builds its own fixture, so a fixture can only ever
 * agree with the code that produced it. This one fetches `dist/versions.json`, takes the newest
 * release, downloads its real bundles through the real client (`listVersions`/`fetchBundle`),
 * runs the real planner (`buildFlashInstall`), and reads both images back with our own
 * independent parsers. What it asserts is not our intent, it is the artefact.
 *
 * THE RULE IT ENFORCES. `is_frogfs_path()` (retro-go-sd `Core/Src/syscalls.c`) routes exactly
 * `roms`, `covers`, `bios`, `fonts`, `font`, plus the single special case `cores/pico8.ro`, to
 * FrogFS. EVERY OTHER PATH OPENS FROM LITTLEFS. Upstream's own build agrees: `gen_frogfs_image.py`
 * has `DEFAULT_DIRS = ("bios", "covers", "fonts", "roms")` and `gen_littlefs_image.py` has
 * `DEFAULT_DIRS = ("cores",)`.
 *
 * So a file in the wrong partition is not slow or degraded, it is UNREACHABLE, and nothing on
 * the device reports it. That is the bug class this suite exists to catch, and it is asserted in
 * both directions: nothing firmware-readable-from-FrogFS may sit in LittleFS, and nothing
 * LittleFS-only may sit in FrogFS.
 *
 * TWO INSTALLS ARE BUILT, on purpose. Case A is the release alone, which is what a user gets
 * installing Retro-Go with no core source active. Case B adds one core, one `data` file, one ROM
 * and one BIOS. Case B is not decoration: "LittleFS holds only cores/ and data/" passes
 * trivially over the EMPTY filesystem case A produces, so without a populated case the
 * assertion would prove nothing. Case B is what makes it bite.
 *
 * THE NETWORK IS THE POINT. A run that cannot reach the release FAILS, loudly, with the reason.
 * It never skips green: a suite whose whole value is "what does the real release do" is worse
 * than absent if it silently passes when it could not look. Bundles are cached under
 * `apps/web/build/.releasecache/` (gitignored) so a re-run costs no download.
 *
 * Same seam as `gba-e2e.mjs`/`flashinstall.mjs`: `@gnw/*` are the REAL built packages (the
 * littlefs WASM really runs); only `./patch.js` (must never run, compress:false) and
 * `./flasher.js` (the device write) are stubbed. NOTHING here touches a device.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "../..");
const LITTLEFS_WASM = join(repoRoot, "packages/fs-builders/vendor/littlefs-wasm/littlefs.wasm");

const say = console.log.bind(console);
function die(msg) {
  console.error(`FAIL releaseimage: ${msg}`);
  process.exit(1);
}

// --- Tiny harness ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
function assert(cond, msg) { if (!cond) throw new Error(msg); }
async function check(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failures.push(`${name}: ${e && e.message ? e.message : e}`); }
}

// --- Compile the modules under test -----------------------------------------------------------
const out = mkdtempSync(join(tmpdir(), "gnw-relimage-"));
symlinkSync(join(repoRoot, "node_modules"), join(out, "node_modules"));

const esbuild = await import("esbuild");
import { gnwResolveFor, gnwImport } from "./gnwResolve.mjs";
await esbuild.build({
  // One build, `splitting: true`: `artifacts.ts` and `flashInstall.ts` must share a module
  // instance or they would not share the discovery memo, and the bundle fetched by one would
  // not be the object handed to the other.
  entryPoints: [
    join(webRoot, "src/lib/artifacts.ts"),
    join(webRoot, "src/lib/sources/blobCache.ts"),
    join(webRoot, "src/lib/engine/flashInstall.ts"),
  ],
  outdir: out,
  outbase: join(webRoot, "src/lib"),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@gnw/*"],
  logLevel: "warning",
  plugins: [
    gnwResolveFor(import.meta.url),
    {
      name: "url-assets",
      setup(b) {
        b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: "url-asset" }));
        b.onLoad({ filter: /.*/, namespace: "url-asset" }, (a) => ({
          contents: `export default ${JSON.stringify(
            /littlefs\.wasm/.test(a.path) ? LITTLEFS_WASM : "asset:UNSTUBBED:" + a.path,
          )};`,
          loader: "js",
        }));
      },
    },
    {
      // compress:false is passed below, so the compressor must never run.
      name: "stub-patch",
      setup(b) {
        b.onResolve({ filter: /^\.\/patch\.js$/ }, () => ({ path: "patch-stub", namespace: "st" }));
        b.onLoad({ filter: /^patch-stub$/, namespace: "st" }, () => ({
          contents:
            `export async function loadLiblzma(){ return () => { ` +
            `throw new Error("lzmaRaw was invoked -- compress:false was not honoured"); }; }`,
          loader: "js",
        }));
      },
    },
    {
      name: "stub-flasher",
      setup(b) {
        b.onResolve({ filter: /^\.\/flasher\.js$/ }, () => ({ path: "flasher-stub", namespace: "st" }));
        b.onLoad({ filter: /^flasher-stub$/, namespace: "st" }, () => ({
          contents: `export async function flashImage(){ throw new Error("releaseimage must never write to a device"); }`,
          loader: "js",
        }));
      },
    },
  ],
});

const { listVersions, fetchBundle } = await import(pathToFileURL(join(out, "artifacts.js")).href);
const { BlobCache } = await import(pathToFileURL(join(out, "sources/blobCache.js")).href);
const { buildFlashInstall } = await import(pathToFileURL(join(out, "engine/flashInstall.js")).href);
const { parseFrogfs } = await gnwImport(import.meta.url, "fs-builders");
const { readFileFromImage, listDirFromImage } = await import(
  pathToFileURL(join(repoRoot, "packages/fs-builders/dist/littlefs.js")).href
);
const { reverseLfsBlocks } = await import(pathToFileURL(join(repoRoot, "packages/fs-builders/dist/flashImage.js")).href);

// --- A disk-backed BlobCache, so a re-run costs no download ------------------------------------
const CACHE_DIR = join(webRoot, "build/.releasecache");
mkdirSync(CACHE_DIR, { recursive: true });
/** The cache keys blobs by published hash, so a name is safe to use as a file name verbatim. */
const safe = (n) => n.replace(/[^A-Za-z0-9._-]/g, "_");
const diskBackend = {
  available: true,
  async list() { try { return readdirSync(CACHE_DIR); } catch { return []; } },
  async stat(name) { try { return readFileSync(join(CACHE_DIR, safe(name))).length; } catch { return null; } },
  async read(name) { try { return new Uint8Array(readFileSync(join(CACHE_DIR, safe(name)))); } catch { return null; } },
  async write(name, bytes) { try { writeFileSync(join(CACHE_DIR, safe(name)), bytes); return true; } catch { return false; } },
  async remove(name) { try { rmSync(join(CACHE_DIR, safe(name))); } catch { /* absent is fine */ } },
};
const cache = new BlobCache({
  backend: diskBackend,
  quota: { estimate: async () => ({ usage: 0, quota: Number.MAX_SAFE_INTEGER }), persisted: async () => false, persist: async () => false },
});

// --- Fetch the newest published release --------------------------------------------------------
let versions;
try {
  versions = await listVersions();
} catch (e) {
  die(`could not read the published version index: ${e && e.message ? e.message : e}`);
}
if (!versions || versions.length === 0) die("the published version index lists no releases");
// `versions.json` publishes newest-first and has no `latest` pointer; artifacts.ts documents
// that `versions[0]` IS the newest and deliberately does not re-sort. Same rule here.
const TAG = versions[0].tag;

let bundle;
try {
  bundle = await fetchBundle(TAG, undefined, { cache });
} catch (e) {
  die(`could not fetch the bundles for ${TAG}: ${e && e.message ? e.message : e}`);
}

// --- The firmware's own routing rule ------------------------------------------------------------
/**
 * `is_frogfs_path()`, transcribed. `font` is in the firmware list and has no counterpart in
 * upstream's FrogFS default dirs; it is kept here because this mirrors the firmware, which is
 * the thing that decides at runtime.
 */
const FROGFS_DIRS = new Set(["roms", "covers", "bios", "fonts", "font"]);
const FROGFS_EXACT = new Set(["cores/pico8.ro"]);
const firmwareReadsFromFrogfs = (p) => FROGFS_DIRS.has(p.split("/")[0]) || FROGFS_EXACT.has(p);

/**
 * EMPTY, and it must stay that way. This pinned 11 `lang/*.bin` blobs that our planner routed
 * into FrogFS, where `is_frogfs_path()` does not look. It was paid off rather than tolerated:
 * `rg_i18n.c`'s `i18n_load_from_sd` opens them with a plain `fopen`, which resolves to
 * LittleFS, so that is where they go now.
 *
 * A new entry here means a directory shipped somewhere the firmware cannot read it. Add one
 * only with the firmware line that proves the routing, never to make a red run green.
 */
const KNOWN_UNREADABLE_IN_FROGFS = new Map([]);

const MB = 1048576;
const BLOCK = 4096;

/** Build one flash-only install for bank 1 and read both images back. */
async function buildAndParse(userRoms) {
  const built = await buildFlashInstall({
    bundle,
    bank: 1,
    extflashSize: 64 * MB,
    blockSize: BLOCK,
    userRoms,
    littlefsLength: 8 * MB,
  });
  const frogPaths = parseFrogfs(built.frogfs).files.map((f) => f.path);

  // The built LittleFS is block-REVERSED for the device's downward partition; reversing again
  // yields the linear image a mount wants.
  const bc = built.layout.littlefsBlockCount;
  const linear = reverseLfsBlocks(built.littlefs, BLOCK, bc);
  const opts = { locateFile: () => LITTLEFS_WASM };
  const lfsPaths = [];
  async function walk(dir) {
    let entries;
    try { entries = await listDirFromImage(linear, BLOCK, bc, dir, opts); }
    catch { return; }
    for (const e of entries) {
      const p = dir === "/" ? `/${e.name}` : `${dir}/${e.name}`;
      // `LittlefsDirEntry.type` is 1 = REG / 2 = DIR (packages/fs-builders/src/littlefs.ts).
      // There is no `isDirectory` on it: reading one recorded every directory as a file, and
      // check 4 is what caught that, which is the reason check 4 exists.
      if (e.type === 2) await walk(p);
      else lfsPaths.push(p.slice(1));
    }
  }
  await walk("/");
  return { built, frogPaths, lfsPaths, linear, bc, opts };
}

const byDir = (paths) => {
  const m = {};
  for (const p of paths) { const d = p.split("/")[0]; m[d] = (m[d] || 0) + 1; }
  return m;
};
const fmt = (m) => Object.entries(m).sort().map(([k, v]) => `${k}=${v}`).join(" ") || "(empty)";

// The real littlefs WASM logs on every mount. Silence it; `say` keeps our own output.
const realLog = console.log;
console.log = () => {};

// CASE A: the release alone, which is what a fresh Retro-Go install with no core source is.
const A = await buildAndParse(new Map());
// CASE B: one file for each destination the split has to distinguish.
const CORE_BYTES = Uint8Array.from({ length: 512 }, (_, i) => (i * 7) & 0xff);
const B = await buildAndParse(new Map([
  ["cores/demo.bin", CORE_BYTES],
  ["data/favorites.txt", new TextEncoder().encode("/roms/nes/demo.nes\n")],
  ["nes/demo.nes", new Uint8Array(64)],
  ["bios/gb/gb_bios.bin", new Uint8Array(32)],
]));
console.log = realLog;

// --- 1. Nothing in FrogFS that the firmware cannot open from FrogFS -----------------------------
await check("1. every file in FrogFS is on a path the firmware reads from FrogFS", () => {
  for (const { label, paths } of [{ label: "release only", paths: A.frogPaths }, { label: "with user content", paths: B.frogPaths }]) {
    const unreadable = paths.filter((p) => !firmwareReadsFromFrogfs(p));
    const counts = byDir(unreadable);
    for (const [dir, want] of KNOWN_UNREADABLE_IN_FROGFS) {
      const got = counts[dir] ?? 0;
      assert(got === want,
        `${label}: KNOWN_UNREADABLE_IN_FROGFS pins ${want} unreachable file(s) under ${dir}/, found ${got}. ` +
        `A pin that no longer matches is stale: fix the routing or the pin, do not adjust the number to pass.`);
      delete counts[dir];
    }
    const rest = Object.keys(counts);
    assert(rest.length === 0,
      `${label}: ${fmt(counts)} in FrogFS on paths is_frogfs_path() does not route there, ` +
      `so the firmware cannot open them: ${unreadable.filter((p) => rest.includes(p.split("/")[0])).slice(0, 8).join(", ")}`);
  }
});

// --- 2. LittleFS holds cores/ and data/ and nothing else ----------------------------------------
await check("2. LittleFS holds only cores/ and data/", () => {
  // cores/ (upstream's gen_littlefs_image.py DEFAULT_DIRS), data/ (writable firmware state,
  // EROFS if it lands in FrogFS) and lang/ (rg_i18n.c's i18n_load_from_sd uses fopen, which
  // is_frogfs_path does not route to FrogFS).
  const allowed = new Set(["cores", "data", "lang"]);
  for (const { label, paths } of [{ label: "release only", paths: A.lfsPaths }, { label: "with user content", paths: B.lfsPaths }]) {
    const stray = paths.filter((p) => !allowed.has(p.split("/")[0]));
    assert(stray.length === 0,
      `${label}: LittleFS holds ${fmt(byDir(stray))}, but upstream's gen_littlefs_image.py packs ` +
      `DEFAULT_DIRS = ("cores",) and our planner adds only data/: ${stray.slice(0, 8).join(", ")}`);
  }
});

// --- 3. The two partitions are disjoint, and together hold everything ----------------------------
await check("3. no file is packed into both partitions, and none is dropped", () => {
  const inBoth = B.frogPaths.filter((p) => B.lfsPaths.includes(p));
  assert(inBoth.length === 0, `packed into BOTH partitions: ${inBoth.join(", ")}`);

  // Every entry the release publishes for this build must be somewhere. A content file silently
  // dropped by the planner is exactly as invisible on the device as one in the wrong partition.
  const shipped = [...bundle.contentFor(1, false).keys()];
  const packed = new Set([...B.frogPaths, ...B.lfsPaths]);
  const lost = shipped.filter((p) => !packed.has(p));
  assert(lost.length === 0, `the release ships ${shipped.length} content files, ${lost.length} reached neither partition: ${lost.slice(0, 8).join(", ")}`);
});

// --- 4. The split routes a core to LittleFS and a ROM/BIOS to FrogFS -----------------------------
// This is what stops check 2 from being vacuous: on the empty filesystem case A produces, "holds
// only cores/ and data/" is true of nothing at all.
await check("4. a core lands in LittleFS byte-identical, a ROM and a BIOS land in FrogFS", async () => {
  assert(B.lfsPaths.includes("cores/demo.bin"),
    `the core is not in LittleFS (LittleFS holds: ${B.lfsPaths.join(", ") || "nothing"})`);
  assert(!B.frogPaths.includes("cores/demo.bin"), "the core was ALSO packed into FrogFS, where the firmware would not open it");

  const got = await readFileFromImage(B.linear, BLOCK, B.bc, "/cores/demo.bin", B.opts);
  assert(got && got.length === CORE_BYTES.length, `the core reads back as ${got ? got.length : "nothing"} bytes, not ${CORE_BYTES.length}`);
  for (let i = 0; i < CORE_BYTES.length; i++) {
    assert(got[i] === CORE_BYTES[i], `the core differs at byte ${i} (${got[i]} != ${CORE_BYTES[i]})`);
  }

  assert(B.lfsPaths.includes("data/favorites.txt"), "the data/ file is not in LittleFS, so the firmware could never rewrite it");
  assert(B.frogPaths.includes("roms/nes/demo.nes"), `the ROM is not at roms/nes/demo.nes in FrogFS (FrogFS roms/: ${B.frogPaths.filter((p) => p.startsWith("roms/")).join(", ") || "none"})`);
  assert(B.frogPaths.includes("bios/gb/gb_bios.bin"), "the BIOS is not in FrogFS");
});

// --- 5. What a fresh install with no core source actually produces --------------------------------
// Asserted, not merely printed: the owner saw an empty LittleFS after installing Retro-Go and it
// was not obvious whether that was correct. It is, for this input, and pinning it here means the
// day it changes is a reported change rather than a surprise on a device.
await check("5. the release alone puts no CORES in LittleFS, because it ships none", () => {
  const shipped = [...bundle.contentFor(1, false).keys()];
  assert(!shipped.some((p) => p.startsWith("cores/")),
    `the release now ships core files (${shipped.filter((p) => p.startsWith("cores/")).join(", ")}), so an empty cores tree is no longer expected`);
  // Cores, not "nothing". The release's own language blobs belong in this partition (check 2
  // says why), so asserting an empty LittleFS here would now be asserting the bug back.
  const cores = A.lfsPaths.filter((p) => p.startsWith("cores/"));
  assert(cores.length === 0,
    `the release alone produced cores in LittleFS (${cores.join(", ")}), expected none`);
  const lang = A.lfsPaths.filter((p) => p.startsWith("lang/"));
  assert(lang.length === 11,
    `expected the release's 11 language blobs in LittleFS, found ${lang.length}`);
});

// --- Report ---------------------------------------------------------------------------------------
say(`\nreleaseimage: ${passed} passed, ${failures.length} failed`);
say(`  release ${TAG} (${versions[0].gitTag})`);
say(`  release only:      FrogFS ${A.frogPaths.length} [${fmt(byDir(A.frogPaths))}]  LittleFS ${A.lfsPaths.length} [${fmt(byDir(A.lfsPaths))}]`);
say(`  with user content: FrogFS ${B.frogPaths.length} [${fmt(byDir(B.frogPaths))}]  LittleFS ${B.lfsPaths.length} [${fmt(byDir(B.lfsPaths))}]`);
for (const [dir, n] of KNOWN_UNREADABLE_IN_FROGFS) {
  say(`  known debt: ${n} ${dir}/ file(s) sit in FrogFS, which is_frogfs_path() does not route there`);
}
for (const f of failures) say(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
