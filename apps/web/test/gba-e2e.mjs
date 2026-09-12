#!/usr/bin/env node
/**
 * END-TO-END proof that a FLASH-ONLY install of the GBA core produces an image the firmware
 * can actually use, driven through the real planner (`buildFlashInstall` in
 * src/lib/engine/flashInstall.ts) over the OWNER'S REAL FILES, then read back with our own
 * independent FrogFS/LittleFS parsers.
 *
 *   docker compose exec dev sh -c 'cd /app && node apps/web/test/gba-e2e.mjs'
 *
 * WHY THIS EXISTS. Every other suite here builds its own fixture, so the divergence that
 * actually shipped -- a core packed at `roms/cores/doom.bin`, a split core whose XIP half was
 * deleted, a `cores/` tree missing from both partitions -- could not be expressed in any of
 * them. This one asserts against the artefact, not the intent: the six things the firmware
 * needs are read back out of the packed bytes.
 *
 * THE ASSETS ARE OUTSIDE THE REPO. They are the owner's own BIOS, ROM and core, which cannot
 * be committed. Point `GNW_GBA_ASSETS` at a directory holding them:
 *
 *     gba_bios.bin  gba.bin  gba.xip  <any single *.gba>
 *
 * Unset, this suite SKIPS -- loudly, naming what is missing, and never printing a pass line.
 * Set but unusable, it FAILS: an env var that names a directory carries intent, and a
 * silently-skipped run of a suite someone deliberately armed is the failure mode this repo
 * has paid for. (The doc guards exit non-zero rather than print green when they cannot run;
 * this is the same rule applied to the half that can carry intent. It cannot be the default,
 * because the assets are absent in every fresh checkout and `npm run check` must still pass
 * there.)
 *
 * Same seam as flashinstall.mjs: `@gnw/*` are the REAL built packages (the littlefs WASM
 * really runs), only `./patch.js` (must never be called -- compress:false) and `./flasher.js`
 * (the device write) are stubbed. NOTHING here touches a device.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

// --- Asset gate ---------------------------------------------------------------------------
/**
 * `GNW_GBA_ASSETS`, else the container's staging directory when it exists -- THE SAME FALLBACK
 * `simflash.mjs` has, and it is here because the difference was costing us the suite. The assets
 * have been sitting in `/tmp/gba-assets` in the dev container all along, so `simflash` ran and
 * this one, needing the env var spelled out, printed SKIPPED on every single `npm run check`.
 * The one suite written to catch a split core losing its XIP half was inert on the day one did.
 *
 * Absent entirely is still a skip: the owner's BIOS and ROM cannot be committed and a fresh
 * checkout must pass. Present-but-unusable is still a FAILURE -- see `requireAsset`.
 */
const DEFAULT_ASSETS = "/tmp/gba-assets";
const ASSET_DIR = process.env.GNW_GBA_ASSETS || (existsSync(DEFAULT_ASSETS) ? DEFAULT_ASSETS : "");
const armed = ASSET_DIR !== "";
if (!armed) {
  console.log("SKIPPED gba-e2e: no GBA assets.");
  console.log("  This suite needs the owner's real gba_bios.bin, gba.bin, gba.xip and a .gba ROM,");
  console.log(`  which are not in the repo. Put them in ${DEFAULT_ASSETS}, or set GNW_GBA_ASSETS=<dir>.`);
  process.exit(0);
}
/** Armed but unusable is a failure, not a skip. */
function requireAsset(name, pick) {
  if (!existsSync(ASSET_DIR)) die(`GNW_GBA_ASSETS=${ASSET_DIR} does not exist`);
  const file = pick ? pick() : join(ASSET_DIR, name);
  if (file === undefined || !existsSync(file)) die(`GNW_GBA_ASSETS=${ASSET_DIR} is missing ${name}`);
  const data = new Uint8Array(readFileSync(file));
  if (data.length === 0) die(`${file} is empty`);
  return { file, data };
}
function die(msg) {
  console.error(`FAIL gba-e2e: ${msg}`);
  process.exit(1);
}

const BIOS = requireAsset("gba_bios.bin");
const CORE = requireAsset("gba.bin");
const XIP = requireAsset("gba.xip");
const ROM = requireAsset("a *.gba ROM", () => {
  const hits = readdirSync(ASSET_DIR).filter((f) => f.toLowerCase().endsWith(".gba"));
  if (hits.length !== 1) return undefined; // 0 or ambiguous: both are "missing a ROM to use"
  return join(ASSET_DIR, hits[0]);
});
const ROM_NAME = ROM.file.slice(ROM.file.lastIndexOf("/") + 1);

// --- Tiny harness -------------------------------------------------------------------------
let passed = 0;
const failures = [];
const say = console.log.bind(console);
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function bytesEq(a, b, msg) {
  assert(a && b, `${msg}: missing buffer`);
  assert(a.length === b.length, `${msg}: length ${a && a.length} != ${b && b.length}`);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`${msg}: byte ${i} differs (${a[i]} != ${b[i]})`);
}
async function check(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failures.push(`${name}: ${e && e.message ? e.message : e}`); }
}

// --- Compile the module under test ---------------------------------------------------------
const LITTLEFS_WASM = join(repoRoot, "packages/fs-builders/vendor/littlefs-wasm/littlefs.wasm");
const out = mkdtempSync(join(tmpdir(), "gnw-gbae2e-"));
symlinkSync(join(repoRoot, "node_modules"), join(out, "node_modules"));

const esbuild = await import("esbuild");
import { gnwResolveFor, gnwImport } from "./gnwResolve.mjs";
await esbuild.build({
  entryPoints: [join(here, "../src/lib/engine/flashInstall.ts")],
  outdir: out,
  bundle: true,
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
      // compress:false is passed by both entry points, so the compressor must never run.
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
      // The device write. Never performed: this suite runs with no device by design.
      name: "stub-flasher",
      setup(b) {
        b.onResolve({ filter: /^\.\/flasher\.js$/ }, () => ({ path: "flasher-stub", namespace: "st" }));
        b.onLoad({ filter: /^flasher-stub$/, namespace: "st" }, () => ({
          contents: `export async function flashImage(){ throw new Error("gba-e2e must never write to a device"); }`,
          loader: "js",
        }));
      },
    },
  ],
});
const { buildFlashInstall } = await import(pathToFileURL(join(out, "flashInstall.js")).href);
const { parseFrogfs } = await gnwImport(import.meta.url, "fs-builders");
const { crc32 } = await import(pathToFileURL(join(repoRoot, "packages/fs-builders/dist/frogfs.js")).href);
const { relocateWords, EXTFLASH_BASE } = await import(
  pathToFileURL(join(repoRoot, "packages/fs-builders/dist/mappedReloc.js")).href
);
const { readFileFromImage, listDirFromImage } = await import(
  pathToFileURL(join(repoRoot, "packages/fs-builders/dist/littlefs.js")).href
);
const { reverseLfsBlocks } = await import(pathToFileURL(join(repoRoot, "packages/fs-builders/dist/flashImage.js")).href);

// The real littlefs WASM logs on every create/mkdir/write. Silence it; `say` keeps our output.
console.log = () => {};

// --- Fixtures -----------------------------------------------------------------------------
const KB = 1024, MB = 1024 * 1024;
const bytes = (len, seed) => Uint8Array.from({ length: len }, (_, i) => (i * 31 + seed * 97) & 0xff);

/** A 4 KiB intflash blob carrying one valid v2 GWLB layout superblock at 0x400. */
function blob(seed, len = 4096) {
  const b = bytes(len, seed);
  const off = 0x400;
  b.fill(0, off, off + 36);
  b.set([0x47, 0x57, 0x4c, 0x42], off);
  b[off + 4] = 2;
  b[off + 6] = 36;
  for (let i = 0; i + 4 <= b.length; i += 4) {
    if (i === off) continue;
    if (b[i] === 0x47 && b[i + 1] === 0x57 && b[i + 2] === 0x4c && b[i + 3] === 0x42) b[i] ^= 0xff;
  }
  return b;
}

/**
 * The FIXTURE MANIFEST, and exactly what it assumes. The GBA core's real manifest is not in
 * this repo, so the two artifact facts are declared here:
 *
 *  - `cores/gba.bin` -- role `cores`, NOT mapped. It is loaded into RAM, so it is an ordinary
 *    file and belongs in the writable partition.
 *  - `cores/gba.xip` -- role `cores`, `mapped: true`, `relocBase` 0xDEC00000.
 *
 * `relocBase` is NOT a guess and NOT derived from the bytes. It is `GBA_CODE_BASE`, declared by
 * the firmware itself in `Core/Src/porting/gba/main_gba.c` (upstream/main), the base gpSP's
 * renderer and bundled BIOS are linked at before the blob is placed. The owner's real `gba.xip`
 * holds 263 words in `[base, base + size)`, 246 of them distinct and 154 Thumb-tagged, so the
 * window is dense, unambiguous, and nothing like opcode aliasing.
 *
 * WHY THE INSTALLER RELOCATES AT ALL, given the firmware has its own `patch_gba_sentinels`:
 * `odroid_overlay_cache_file_in_flash_relocate` (`Core/Src/porting/odroid_overlay.c`) runs the
 * relocation callback only under `SD_CARD == 1`. The `SD_CARD == 0` arm maps the file straight
 * out of FrogFS, drops the callback with `(void)relocate_cb`, and says so: "FrogFS maps the file
 * where it already sits in the firmware image, so there is no copy to relocate. Callers that
 * need one must not use this build." So on flash-only the blob is executed exactly as we pack
 * it, and pre-relocating it is the whole job. On SD we must ship it UNRELOCATED at the sentinel,
 * because the firmware relocates each buffer on its way into the flash cache.
 */
const GBA_BIN_KEY = "cores/gba.bin";
const GBA_XIP_KEY = "cores/gba.xip";
/** `GBA_CODE_BASE`, `Core/Src/porting/gba/main_gba.c` (upstream/main). */
const GBA_CODE_BASE = 0xdec00000;
/** Measured over the owner's real gba.xip at that base. Pinned so a drift is a failure, not a
 *  quietly different number: 246 of these are distinct and 154 carry the Thumb bit. */
const SENTINEL_WORDS = 263;
const MAPPED = new Map([[GBA_XIP_KEY, { relocBase: GBA_CODE_BASE, bytes: XIP.data.length }]]);

/** The bundle's own content: a base firmware install, with no GBA anything in it. */
function defaultContent() {
  return new Map([
    ["cores/nes.bin", bytes(64, 1)],
    ["bios/gb/gb_bios.bin", bytes(96, 7)],
    ["fonts/f.bin", bytes(48, 12)],
  ]);
}

function bundle() {
  return {
    manifest: { cores: [], dist: { paths: undefined } },
    blobs: { 1: blob(101), 2: blob(102), sd_1: blob(103), sd_2: blob(104) },
    contentFor() { return new Map(defaultContent()); },
  };
}

/**
 * The user's side of a flash-only GBA install, keyed exactly as `prepareState`/`placement.ts`
 * produce it: a source's artifacts keep their role directory (`cores/`), a scanned ROM is
 * `<system>/<file>`, a scanned BIOS is `bios/<system>/<file>`.
 */
const userRoms = new Map([
  [GBA_BIN_KEY, CORE.data],
  [GBA_XIP_KEY, XIP.data],
  ["bios/gba/gba_bios.bin", BIOS.data],
  [`gba/${ROM_NAME}`, ROM.data],
]);

const EXT = 64 * MB, BLOCK = 4096;

const built = await buildFlashInstall({
  bundle: bundle(),
  bank: 1,
  extflashSize: EXT,
  blockSize: BLOCK,
  userRoms,
  littlefsLength: 8 * MB,
  mappedArtifacts: MAPPED,
});

// Read the packed FrogFS back with the independent parser, never the builder's bookkeeping.
const frogParsed = parseFrogfs(built.frogfs);
const frogByPath = new Map(frogParsed.files.map((f) => [f.path, f]));
const frogData = (p) => {
  const e = frogByPath.get(p);
  return e ? built.frogfs.subarray(e.dataOffs, e.dataOffs + e.dataSize) : undefined;
};

// Mount the LittleFS image back. The built image is block-REVERSED for the device's downward
// partition (`reverseLfsBlocks`), so reversing it again yields the linear image a mount wants.
const lfsBlockCount = built.layout.littlefsBlockCount;
const linear = reverseLfsBlocks(built.littlefs, BLOCK, lfsBlockCount);
const lfsOpts = { locateFile: () => LITTLEFS_WASM };
const lfsRead = async (path) => {
  try { return await readFileFromImage(linear, BLOCK, lfsBlockCount, path, lfsOpts); }
  catch { return undefined; }
};
const lfsList = async (path) => {
  try { return (await listDirFromImage(linear, BLOCK, lfsBlockCount, path, lfsOpts)).map((e) => e.name); }
  catch { return []; }
};

// --- 1. gba.bin is in LittleFS, byte-identical ---------------------------------------------
await check("1. gba.bin is delivered into LittleFS byte-identical", async () => {
  const got = await lfsRead("/" + GBA_BIN_KEY);
  assert(got, `gba.bin is not in the LittleFS image (/cores holds: ${(await lfsList("/cores")).join(", ") || "nothing, or no /cores at all"})`);
  bytesEq(got, CORE.data, "gba.bin in LittleFS");
});

// --- 2. gba.xip is in FrogFS, uncompressed, contiguous, byte-identical ----------------------
await check("2. gba.xip is in FrogFS, uncompressed and contiguous", () => {
  const e = frogByPath.get(GBA_XIP_KEY);
  assert(e, `gba.xip is not in the packed FrogFS image (image holds: ${[...frogByPath.keys()].join(", ")})`);
  // parseFrogfs REFUSES a compressed entry rather than returning one, so reaching here at all
  // is the uncompressed proof; the size equality is the contiguity proof (one run, no split).
  assert(e.dataSize === XIP.data.length, `gba.xip packed size ${e.dataSize} != ${XIP.data.length}`);
  assert(e.dataOffs % 4 === 0, `gba.xip data offset ${e.dataOffs} is not 4-byte aligned`);
  // The bytes are NOT identical any more, and must not be: the sentinel words were rebased.
  // Everything outside the window must still match the source exactly.
  const packed = frogData(GBA_XIP_KEY);
  const dvS = new DataView(XIP.data.buffer, XIP.data.byteOffset, XIP.data.byteLength);
  const dvP = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  let moved = 0;
  for (let i = 0; i + 4 <= XIP.data.length; i += 4) {
    const src = dvS.getUint32(i, true);
    const inWindow = ((src & ~1) >>> 0) >= GBA_CODE_BASE
      && ((src & ~1) >>> 0) < GBA_CODE_BASE + XIP.data.length;
    if (inWindow) moved++;
    else assert(dvP.getUint32(i, true) === src,
      `word at 0x${i.toString(16)} is outside the sentinel window but was rewritten`);
  }
  assert(moved === SENTINEL_WORDS,
    `expected ${SENTINEL_WORDS} sentinel words in the real gba.xip, found ${moved}`);
});

// --- 3. the ROM is under roms/gba/ with its name intact ------------------------------------
await check("3. the ROM is under roms/gba/ byte-identical, name intact", () => {
  const dest = `roms/gba/${ROM_NAME}`;
  assert(frogByPath.has(dest), `the ROM is not at ${dest} (FrogFS roms/: ${[...frogByPath.keys()].filter((p) => p.startsWith("roms/")).join(", ")})`);
  bytesEq(frogData(dest), ROM.data, "the ROM in FrogFS");
});

// --- 4. the BIOS is under the manifest's bios directory ------------------------------------
await check("4. the BIOS is under bios/gba/ byte-identical", () => {
  const dest = "bios/gba/gba_bios.bin";
  assert(frogByPath.has(dest), `the BIOS is not at ${dest} (FrogFS bios/: ${[...frogByPath.keys()].filter((p) => p.startsWith("bios/")).join(", ")})`);
  bytesEq(frogData(dest), BIOS.data, "the BIOS in FrogFS");
});

// --- 5a. the placement is reported with the address the firmware will use --------------------
await check("5a. gba.xip is placed at EXTBASE + frogfsOffset + dataOffs", () => {
  const placed = built.mappedPlaced.find((m) => m.path === GBA_XIP_KEY);
  assert(placed, `gba.xip was not reported as placed (mappedPlaced: ${JSON.stringify(built.mappedPlaced)})`);
  const want = EXTFLASH_BASE + built.layout.frogfsOffset + frogByPath.get(GBA_XIP_KEY).dataOffs;
  assert(placed.address === want,
    `placed address 0x${placed.address.toString(16)} != 0x${want.toString(16)}`);
  // docs/MAPPED_ARTIFACTS.md section 5: the patch count is the invariant. The same words are
  // relocated on every placement, so a count that drifts means the window caught something else.
  assert(placed.patched === SENTINEL_WORDS,
    `patched ${placed.patched} words, expected the invariant ${SENTINEL_WORDS}`);
});

// --- 5b. a real relocation runs through the real path, and the CRC32 is rewritten -----------
/**
 * The footer, over the SAME build the checks above read. `frogfs_pico8_ro.py:144` calls the CRC
 * rewrite the most overlookable step in the port, and it is: an image whose bytes moved but
 * whose footer did not is structurally invalid, and nothing else here would notice.
 *
 * This once ran against a fabricated relocBase because the suite believed gba.xip had no
 * sentinel and the main build therefore changed no bytes -- with nothing moved, the builder's
 * own footer was already correct and deleting the rewrite left the suite green. The real
 * sentinel makes that scaffolding unnecessary: the main build moves 263 words, so the footer is
 * load-bearing in the build the rest of the suite already inspects.
 */
await check("5b. the relocation rewrites the trailing CRC32", async () => {
  const reloc = built;
  const placed = reloc.mappedPlaced.find((m) => m.path === GBA_XIP_KEY);
  assert(placed, `gba.xip was not placed (mappedPlaced: ${JSON.stringify(reloc.mappedPlaced)})`);
  assert(placed.patched > 0, `a relocBase inside the blob's own values patched ${placed.patched} words`);

  const e = parseFrogfs(reloc.frogfs).files.find((f) => f.path === GBA_XIP_KEY);
  assert(e, "gba.xip is not in the relocated image");
  const packed = reloc.frogfs.subarray(e.dataOffs, e.dataOffs + e.dataSize);
  let changed = 0;
  for (let i = 0; i < packed.length; i++) if (packed[i] !== XIP.data[i]) changed++;
  assert(changed > 0, "the post-pass reported a relocation but no packed byte changed");

  const dv = new DataView(reloc.frogfs.buffer, reloc.frogfs.byteOffset, reloc.frogfs.byteLength);
  const stored = dv.getUint32(reloc.frogfs.length - 4, true);
  const want = crc32(reloc.frogfs.subarray(0, reloc.frogfs.length - 4)) >>> 0;
  assert(stored === want,
    `trailing CRC32 0x${stored.toString(16)} != computed 0x${want.toString(16)} after relocation`);
});

// The unrelocated image's footer must be right too -- it is the one that ships today.
await check("5b'. the unrelocated image's trailing CRC32 is valid", () => {
  const img = built.frogfs;
  const dv = new DataView(img.buffer, img.byteOffset, img.byteLength);
  const stored = dv.getUint32(img.length - 4, true);
  const want = crc32(img.subarray(0, img.length - 4)) >>> 0;
  assert(stored === want, `trailing CRC32 0x${stored.toString(16)} != computed 0x${want.toString(16)}`);
});

// --- 5c. relocation semantics, pinned against the REAL gba.xip bytes ------------------------
/**
 * The arithmetic that decides whether a relocated blob RUNS, pinned over the real bytes at the
 * real firmware base: exactly the words inside the window move, the Thumb bit survives, and
 * nothing outside the window is touched. Getting the mask backwards yields a blob that looks
 * patched and faults on the first indirect call, and no other check in this repo reads it off
 * real code. This mirrors `patch_gba_sentinels` in `main_gba.c` word for word, which is the
 * point: the firmware runs the same test on the same blob under SD_CARD == 1.
 */
await check("5c. relocateWords moves exactly the window, keeping the Thumb bit", () => {
  const n = XIP.data.length;
  const src = new DataView(XIP.data.buffer, XIP.data.byteOffset, XIP.data.byteLength);
  const base = GBA_CODE_BASE;
  // A Thumb-tagged word from the REAL sentinel window, so the bit-preservation assertion below
  // is made about a pointer the firmware itself will dereference.
  let thumbAt = -1;
  for (let i = 0; i + 4 <= n; i += 4) {
    const v = src.getUint32(i, true);
    if ((v & 1) === 1 && ((v & ~1) >>> 0) >= base && ((v & ~1) >>> 0) < base + n) { thumbAt = i; break; }
  }
  assert(thumbAt >= 0, "no Thumb-tagged word inside the sentinel window of gba.xip");

  const before = XIP.data.slice();
  const work = XIP.data.slice();
  const target = (base + 0x10000) >>> 0;
  const delta = target - base;
  const count = relocateWords(work, base, target);

  const wv = new DataView(work.buffer);
  const bv = new DataView(before.buffer);
  let inWindow = 0, moved = 0, strayed = 0;
  for (let i = 0; i + 4 <= n; i += 4) {
    const old = bv.getUint32(i, true);
    const now = wv.getUint32(i, true);
    const masked = (old & ~1) >>> 0;
    if (masked >= base && masked < base + n) {
      inWindow++;
      if (now === ((old + delta) >>> 0)) moved++;
    } else if (now !== old) strayed++;
  }
  assert(count === inWindow, `relocateWords reported ${count} words, ${inWindow} are in the window`);
  // The Thumb bit first, because it is the detail that decides whether the blob RUNS: adding
  // the delta to the MASKED value yields one that looks patched and faults on the first
  // indirect call. Asserted ahead of the counters so that failure names itself.
  assert((wv.getUint32(thumbAt, true) & 1) === 1,
    `the Thumb bit was stripped from the pointer at offset ${thumbAt}`);
  assert(moved === inWindow, `${inWindow - moved} in-window words were not rebased by the delta`);
  assert(strayed === 0, `${strayed} words OUTSIDE the window were modified`);
  assert(inWindow === SENTINEL_WORDS,
    `the sentinel window caught ${inWindow} words, expected ${SENTINEL_WORDS}`);
});

// --- 6. nothing lands in roms/cores/ -------------------------------------------------------
await check("6. no core is packed under roms/cores/", async () => {
  const stray = [...frogByPath.keys()].filter((p) => p.startsWith("roms/cores/"));
  assert(stray.length === 0, `cores packed under roms/: ${stray.join(", ")}`);
  // The same defect's other half: a core must not silently vanish from BOTH partitions.
  assert(frogByPath.has(GBA_XIP_KEY) || (await lfsRead("/" + GBA_XIP_KEY)),
    "gba.xip is in neither partition");
});

// --- Report --------------------------------------------------------------------------------
say(`gba-e2e: ${passed} passed, ${failures.length} failed`);
say(`  assets: ${ROM_NAME} (${ROM.data.length} B), gba.bin (${CORE.data.length} B), gba.xip (${XIP.data.length} B), bios (${BIOS.data.length} B)`);
if (failures.length) {
  for (const f of failures) say(`  FAIL ${f}`);
  process.exit(1);
}
