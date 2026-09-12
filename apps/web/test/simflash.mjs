#!/usr/bin/env node
/**
 * SIMULATED FLASH: build a flash-only GBA install from the owner's real files, write it to a
 * simulated extflash through the real `flashInstallToDevice`, then read the result back OUT OF
 * THE FLASH ARRAY the way the firmware resolves each path.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/simflash.mjs'
 *
 * WHY THIS EXISTS, and how it differs from its two neighbours. `gba-e2e.mjs` proves the images
 * we BUILD are correct and stops there. `lfspreserve.mjs` drives the ROM-install path (an
 * oversized FrogFS write, then `writeFilesToDeviceLfs` into a live partition). Neither one ever
 * performs a firmware install, which is the operation that writes all three regions -- and the
 * defects the owner actually hit lived in the step after the build: a core in the wrong
 * partition is unreachable, a region written at the wrong offset erases its neighbour, and
 * every one of those is invisible to a suite that inspects `install.frogfs` directly.
 *
 * So nothing here reads `install.*` for its verdict. The images go into a byte array and every
 * assertion reads them back out of it.
 *
 * THE DEVICE MODEL has to be right about two things or an overrun is invisible:
 *
 *  1. ERASE GRANULARITY. `GnwFlasher.flash` pads the payload up to the erase block and programs
 *     the padded length with `erase: true` (`packages/gnw-flasher/src/index.ts`, `padBytes`), so
 *     the erased extent is `ceil(len / eraseSize) * eraseSize`. Not an assumption:
 *     `packages/gnw-flasher/test/protocol.mjs:518` flashes 5000 bytes and asserts the device is
 *     handed 8192. A stub writing only `data.length` models a flasher this repo does not ship.
 *  2. THE LITTLEFS PARTITION RUNS DOWNWARD. `gw_littlefs.c` addresses block b at
 *     `context - (b+1) * block_size`, so block 0 is the sector at the TOP of flash and the
 *     highest-numbered block sits at the partition's base. An image growing up from below
 *     therefore reaches the HIGHEST block indices first, never the superblock pair, and those
 *     are the last blocks littlefs allocates. A lightly-filled partition absorbs an overrun with
 *     nothing to show for it, which is why the erase-extent assertions below are primary and the
 *     content assertions are corroborating.
 *
 * Both points and the `flashImage` stub shape are taken from `lfspreserve.mjs`, deliberately.
 *
 * BANKS. `flashRegion` writes intflash with `bank = install.bank` and both filesystems with
 * `bank = 0`. Only bank 0 is extflash. A stub that ignored the bank would let an intflash write
 * silently corrupt the FrogFS image, so the banks are modelled apart and the intflash writes are
 * asserted never to touch the extflash array.
 *
 * Same seam as `gba-e2e.mjs`: `@gnw/*` are the REAL built packages (the littlefs WASM really
 * runs), only `./patch.js` (must never be called) and `./flasher.js` (replaced by the device
 * model) are stubbed. NOTHING here touches a device.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

// --- Asset gate ---------------------------------------------------------------------------
/**
 * `GNW_GBA_ASSETS`, else the container's staging directory when it exists. Present-but-unusable
 * is a FAILURE, never a skip: a directory that is there carries intent, and a silently-skipped
 * run of an armed suite is the failure mode this repo has already paid for. Absent entirely is a
 * skip, because the owner's BIOS and ROM cannot be committed and `npm run check` must still pass
 * in a fresh checkout. Same rule as `gba-e2e.mjs`.
 */
const DEFAULT_ASSETS = "/tmp/gba-assets";
const ASSET_DIR = process.env.GNW_GBA_ASSETS || (existsSync(DEFAULT_ASSETS) ? DEFAULT_ASSETS : "");
if (!ASSET_DIR) {
  console.log("SKIPPED simflash: no GBA assets.");
  console.log(`  This suite needs the owner's real gba_bios.bin, gba.bin, gba.xip and a .gba ROM.`);
  console.log(`  Put them in ${DEFAULT_ASSETS}, or set GNW_GBA_ASSETS=<dir>, to run it.`);
  process.exit(0);
}
function die(msg) {
  console.error(`FAIL simflash: ${msg}`);
  process.exit(1);
}
function requireAsset(name, pick) {
  if (!existsSync(ASSET_DIR)) die(`assets directory ${ASSET_DIR} does not exist`);
  const file = pick ? pick() : join(ASSET_DIR, name);
  if (file === undefined || !existsSync(file)) die(`${ASSET_DIR} is missing ${name}`);
  const data = new Uint8Array(readFileSync(file));
  if (data.length === 0) die(`${file} is empty`);
  return { file, data };
}
const BIOS = requireAsset("gba_bios.bin");
const CORE = requireAsset("gba.bin");
const XIP = requireAsset("gba.xip");
const ROM = requireAsset("a *.gba ROM", () => {
  const hits = readdirSync(ASSET_DIR).filter((f) => f.toLowerCase().endsWith(".gba"));
  if (hits.length !== 1) return undefined;
  return join(ASSET_DIR, hits[0]);
});
const ROM_NAME = ROM.file.slice(ROM.file.lastIndexOf("/") + 1);

// --- Tiny harness -------------------------------------------------------------------------
let passed = 0;
const failures = [];
const say = console.log.bind(console);
const sha = (d) => createHash("sha256").update(d).digest("hex");
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function bytesEq(a, b, msg) {
  assert(a && b, `${msg}: missing buffer`);
  assert(a.length === b.length, `${msg}: length ${a && a.length} != ${b && b.length}`);
  if (sha(a) === sha(b)) return;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`${msg}: byte ${i} differs (${a[i]} != ${b[i]})`);
}
async function check(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failures.push(`${name}: ${e && e.message ? e.message : e}`); }
}

// --- The simulated device -------------------------------------------------------------------
const KB = 1024, MB = 1024 * 1024;
/**
 * 64 MiB, not 16. Pokemon Sapphire alone is 16 MiB, so the payload under test cannot fit a
 * 16 MiB chip beside an 8 MiB LittleFS: the arithmetic, not a preference. `gba-e2e.mjs` uses
 * the same figure for the same reason.
 */
const EXT = 64 * MB;
const BLOCK = 4096;
const LFS_LEN = 8 * MB;

globalThis.__ext = new Uint8Array(EXT).fill(0xff);
globalThis.__intflash = new Map();
globalThis.__writes = [];

/**
 * The `engine/flasher.ts` stub: what `GnwFlasher.flash()` does to the chip, not what the caller
 * passed. Bank 0 is extflash; any other bank is internal flash and must never reach the
 * extflash array.
 */
const FLASH_STUB =
  `export async function flashImage(_g, bank, offset, data){\n` +
  `  const es = ${BLOCK};\n` +
  `  const padded = Math.ceil(data.length / es) * es;\n` +
  `  globalThis.__writes.push({ bank, start: offset, end: offset + padded, len: data.length });\n` +
  `  if (bank === 0) {\n` +
  `    globalThis.__ext.fill(0xff, offset, offset + padded);\n` +
  `    globalThis.__ext.set(data, offset);\n` +
  `  } else {\n` +
  `    const b = globalThis.__intflash.get(bank) ?? new Uint8Array(${1024 * KB}).fill(0xff);\n` +
  `    b.fill(0xff, offset, offset + padded);\n` +
  `    b.set(data, offset);\n` +
  `    globalThis.__intflash.set(bank, b);\n` +
  `  }\n` +
  `}`;

// --- Compile the modules under test ----------------------------------------------------------
const LITTLEFS_WASM = join(repoRoot, "packages/fs-builders/vendor/littlefs-wasm/littlefs.wasm");
const out = mkdtempSync(join(tmpdir(), "gnw-simflash-"));
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
      name: "stub-patch",
      setup(b) {
        b.onResolve({ filter: /^\.\/patch\.js$/ }, () => ({ path: "patch-stub", namespace: "st" }));
        b.onLoad({ filter: /^patch-stub$/, namespace: "st" }, () => ({
          contents:
            `export async function loadLiblzma(){ return () => { ` +
            `throw new Error("lzmaRaw was invoked -- nothing in this suite compresses"); }; }`,
          loader: "js",
        }));
      },
    },
    {
      name: "device-model",
      setup(b) {
        b.onResolve({ filter: /^\.\/flasher\.js$/ }, () => ({ path: "flash", namespace: "st" }));
        b.onLoad({ filter: /^flash$/, namespace: "st" }, () => ({ contents: FLASH_STUB, loader: "js" }));
      },
    },
  ],
});

const { buildFlashInstall, flashInstallToDevice } = await import(
  pathToFileURL(join(out, "flashInstall.js")).href
);
const { parseFrogfs } = await gnwImport(import.meta.url, "fs-builders");
const { crc32 } = await import(pathToFileURL(join(repoRoot, "packages/fs-builders/dist/frogfs.js")).href);
const { readFileFromImage, listDirFromImage } = await import(
  pathToFileURL(join(repoRoot, "packages/fs-builders/dist/littlefs.js")).href
);
const { EXTFLASH_BASE: EXTFLASH_BASE_ADDR } = await import(
  pathToFileURL(join(repoRoot, "packages/fs-builders/dist/mappedReloc.js")).href
);

// The real littlefs WASM logs on every create/mkdir/write. Silence it; `say` keeps our output.
console.log = () => {};

// --- Fixtures (same manifest facts as gba-e2e.mjs) --------------------------------------------
const bytes = (len, seed) => Uint8Array.from({ length: len }, (_, i) => (i * 31 + seed * 97) & 0xff);
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
const GBA_BIN_KEY = "cores/gba.bin";
const GBA_XIP_KEY = "cores/gba.xip";
/** `GBA_CODE_BASE`, `Core/Src/porting/gba/main_gba.c`; the manifest declares it as `relocBase`. */
const GBA_CODE_BASE = 0xdec00000;
/** Measured over the owner's real gba.xip at that base; pinned so a drift fails rather than passes. */
const SENTINEL_WORDS = 263;

const bundle = () => ({
  manifest: { cores: [], dist: { paths: undefined } },
  blobs: { 1: blob(101), 2: blob(102), sd_1: blob(103), sd_2: blob(104) },
  contentFor: () => new Map([
    ["cores/nes.bin", bytes(64, 1)],
    ["bios/gb/gb_bios.bin", bytes(96, 7)],
    ["fonts/f.bin", bytes(48, 12)],
  ]),
});

const userRoms = new Map([
  [GBA_BIN_KEY, CORE.data],
  [GBA_XIP_KEY, XIP.data],
  ["bios/gba/gba_bios.bin", BIOS.data],
  [`gba/${ROM_NAME}`, ROM.data],
]);

const install = await buildFlashInstall({
  bundle: bundle(),
  bank: 1,
  extflashSize: EXT,
  blockSize: BLOCK,
  userRoms,
  littlefsLength: LFS_LEN,
  mappedArtifacts: new Map([[GBA_XIP_KEY, { relocBase: GBA_CODE_BASE, bytes: XIP.data.length }]]),
});

// --- THE FLASH ------------------------------------------------------------------------------
await flashInstallToDevice(/* flasher unused by the stub */ {}, install);

const L = install.layout;
const ext = globalThis.__ext;
const writes = globalThis.__writes;
const hex = (n) => `0x${n.toString(16)}`;
const span = (w) => `${hex(w.start)}..${hex(w.end)}`;

// --- Read the filesystems back OUT OF THE FLASH ARRAY ----------------------------------------
/** FrogFS, as it now sits on the chip. */
const frogOnChip = ext.subarray(L.frogfsOffset, L.frogfsOffset + install.frogfs.length);
let frogByPath = new Map();
let frogParseError;
try {
  frogByPath = new Map(parseFrogfs(frogOnChip).files.map((f) => [f.path, f]));
} catch (e) {
  frogParseError = (e && e.message) || String(e);
}
const frogData = (p) => {
  const e = frogByPath.get(p);
  return e ? frogOnChip.subarray(e.dataOffs, e.dataOffs + e.dataSize) : undefined;
};

/**
 * LittleFS, read off the chip and put back into logical block order. Block b lives at
 * `partitionTop - (b+1) * blockSize`, so the linear image a mount wants is the on-chip bytes
 * with their block order reversed.
 */
const BC = L.littlefsBlockCount;
const lfsLinear = (() => {
  const img = new Uint8Array(BC * BLOCK);
  const top = L.littlefsOffset + BC * BLOCK;
  for (let b = 0; b < BC; b++) {
    const off = top - (b + 1) * BLOCK;
    img.set(ext.subarray(off, off + BLOCK), b * BLOCK);
  }
  return img;
})();
const lfsOpts = { locateFile: () => LITTLEFS_WASM };
const lfsRead = async (path) => {
  try { return await readFileFromImage(lfsLinear, BLOCK, BC, path, lfsOpts); }
  catch { return undefined; }
};
const lfsList = async (path) => {
  try { return (await listDirFromImage(lfsLinear, BLOCK, BC, path, lfsOpts)).map((e) => e.name); }
  catch { return []; }
};

// --- 1. gba.bin is in the LittleFS partition ON THE CHIP --------------------------------------
await check("1. gba.bin reads back from the flashed LittleFS partition", async () => {
  const got = await lfsRead("/" + GBA_BIN_KEY);
  assert(got, `gba.bin is not in the LittleFS partition on the chip (/cores holds: ${(await lfsList("/cores")).join(", ") || "nothing, or no /cores at all"})`);
  bytesEq(got, CORE.data, "gba.bin read back off the chip");
});

// --- 2. gba.xip is in FrogFS ON THE CHIP, contiguous and relocated -----------------------------
await check("2. gba.xip reads back from the flashed FrogFS, relocated and contiguous", () => {
  assert(!frogParseError, `the FrogFS image on the chip does not parse: ${frogParseError}`);
  const e = frogByPath.get(GBA_XIP_KEY);
  assert(e, `gba.xip is not in the FrogFS image on the chip (it holds: ${[...frogByPath.keys()].join(", ")})`);
  assert(e.dataSize === XIP.data.length, `gba.xip on chip is ${e.dataSize} bytes, source is ${XIP.data.length}`);
  assert(e.dataOffs % 4 === 0, `gba.xip data offset ${e.dataOffs} is not 4-byte aligned`);

  // Relocated to where it actually landed, and only in the sentinel window.
  const packed = frogData(GBA_XIP_KEY);
  const want = (EXTFLASH_BASE_ADDR + L.frogfsOffset + e.dataOffs) >>> 0;
  const delta = (want - GBA_CODE_BASE) | 0;
  const dvS = new DataView(XIP.data.buffer, XIP.data.byteOffset, XIP.data.byteLength);
  const dvP = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  let inWindow = 0, moved = 0, strayed = 0, thumbAt = -1;
  for (let i = 0; i + 4 <= XIP.data.length; i += 4) {
    const src = dvS.getUint32(i, true);
    const now = dvP.getUint32(i, true);
    const masked = (src & ~1) >>> 0;
    if (masked >= GBA_CODE_BASE && masked < GBA_CODE_BASE + XIP.data.length) {
      inWindow++;
      if (now === ((src + delta) >>> 0)) moved++;
      if ((src & 1) === 1 && thumbAt < 0) thumbAt = i;
    } else if (now !== src) strayed++;
  }
  assert(inWindow === SENTINEL_WORDS, `the sentinel window caught ${inWindow} words on the chip, expected ${SENTINEL_WORDS}`);
  assert(thumbAt >= 0, "no Thumb-tagged word inside the sentinel window");
  // The Thumb bit first: adding the delta to the MASKED value yields a blob that looks patched
  // and faults on the first indirect call, which no size or count assertion can see.
  assert((dvP.getUint32(thumbAt, true) & 1) === 1, `the Thumb bit was stripped from the pointer at offset ${thumbAt}`);
  assert(moved === inWindow, `${inWindow - moved} in-window words on the chip were not rebased to ${hex(want)}`);
  assert(strayed === 0, `${strayed} words OUTSIDE the sentinel window were modified on the chip`);
});

// --- 3. the trailing CRC32 of the image ON THE CHIP is valid ------------------------------------
await check("3. the flashed FrogFS image's trailing CRC32 is valid", () => {
  assert(!frogParseError, `the FrogFS image on the chip does not parse: ${frogParseError}`);
  const dv = new DataView(frogOnChip.buffer, frogOnChip.byteOffset, frogOnChip.byteLength);
  const stored = dv.getUint32(frogOnChip.length - 4, true);
  const want = crc32(frogOnChip.subarray(0, frogOnChip.length - 4)) >>> 0;
  assert(stored === want, `trailing CRC32 ${hex(stored)} != computed ${hex(want)} on the chip`);
});

// --- 4. the ROM and the BIOS read back off the chip ---------------------------------------------
await check("4. the ROM and the BIOS read back from the chip byte-identical", () => {
  assert(!frogParseError, `the FrogFS image on the chip does not parse: ${frogParseError}`);
  const romDest = `roms/gba/${ROM_NAME}`;
  assert(frogByPath.has(romDest), `the ROM is not at ${romDest} on the chip (roms/: ${[...frogByPath.keys()].filter((p) => p.startsWith("roms/")).join(", ")})`);
  bytesEq(frogData(romDest), ROM.data, "the ROM read back off the chip");
  const biosDest = "bios/gba/gba_bios.bin";
  assert(frogByPath.has(biosDest), `the BIOS is not at ${biosDest} on the chip (bios/: ${[...frogByPath.keys()].filter((p) => p.startsWith("bios/")).join(", ")})`);
  bytesEq(frogData(biosDest), BIOS.data, "the BIOS read back off the chip");
});

// --- 5. no region wrote outside itself ------------------------------------------------------------
/**
 * The primary guard. Content assertions can pass while a neighbour is being erased, because the
 * blocks an overrun reaches first are the ones littlefs allocates last. This one holds either way.
 */
await check("5. no region erased or wrote outside its own extent", () => {
  const lfsTop = L.littlefsOffset + BC * BLOCK;
  const strays = [];
  for (const w of writes) {
    if (w.bank !== 0) {
      // Internal flash. Modelled apart; if this ever reached the extflash array the FrogFS
      // image would be silently corrupted by a firmware write.
      continue;
    }
    const isFrogfs = w.start === L.frogfsOffset;
    const isLfs = w.start === L.littlefsOffset;
    if (!isFrogfs && !isLfs) { strays.push(`a bank-0 write at ${span(w)} matches neither region start`); continue; }
    if (isFrogfs && w.end > L.littlefsOffset) {
      strays.push(`the FrogFS write ${span(w)} erased into the LittleFS partition at ${hex(L.littlefsOffset)}`);
    }
    if (isLfs && (w.end > lfsTop || w.start < L.littlefsOffset)) {
      strays.push(`the LittleFS write ${span(w)} left its partition ${hex(L.littlefsOffset)}..${hex(lfsTop)}`);
    }
    if (w.end > EXT) strays.push(`a write ran past the end of flash: ${span(w)} > ${hex(EXT)}`);
  }
  assert(strays.length === 0, strays.join("; "));
});

// --- 6. the intflash write went to its bank, and its bytes arrived intact ---------------------------
/**
 * An intflash offset is bank-relative and starts at 0. This fixture puts FrogFS at offset 0 of
 * extflash too, so the two overlap numerically: a write that ignored the bank would land on the
 * FrogFS header and checks 2 and 3 would fail with a parse or CRC error. That overlap is what
 * makes the separation testable here, so it is asserted rather than left to chance.
 */
await check("6. the intflash write went to its bank, with its bytes intact", () => {
  const banks = [...new Set(writes.filter((w) => w.bank !== 0).map((w) => w.bank))];
  assert(banks.length === 1 && banks[0] === 1, `intflash writes went to banks [${banks.join(", ")}], expected [1]`);
  const bank1 = globalThis.__intflash.get(1);
  assert(bank1, "nothing was written to intflash bank 1 at all");
  bytesEq(bank1.subarray(0, install.intflash.length), install.intflash, "intflash bank 1 content");
  assert(L.frogfsOffset < install.intflash.length,
    `this check relies on the intflash and FrogFS extents overlapping numerically, but FrogFS starts at ${hex(L.frogfsOffset)} and intflash is only ${install.intflash.length} bytes`);
});

// --- 7. nothing under roms/cores/, and the core is in exactly one partition -------------------------
await check("7. the core is in the right partition and only there", async () => {
  assert(!frogParseError, `the FrogFS image on the chip does not parse: ${frogParseError}`);
  const stray = [...frogByPath.keys()].filter((p) => p.startsWith("roms/cores/"));
  assert(stray.length === 0, `cores packed under roms/ on the chip: ${stray.join(", ")}`);
  // gba.bin belongs to LittleFS: `is_frogfs_path` (syscalls.c) routes roms/covers/bios/fonts/font
  // and cores/pico8.ro to FrogFS and EVERYTHING else to LittleFS, so a copy in FrogFS is dead
  // weight the firmware will never open.
  assert(!frogByPath.has(GBA_BIN_KEY), "gba.bin is in FrogFS, where the firmware never opens it");
  // gba.xip is the exception: read with rg_frogfs_get_file_data(), not fopen(), so FrogFS is
  // correct for it and a LittleFS copy would be the dead one.
  assert(!(await lfsRead("/" + GBA_XIP_KEY)), "gba.xip is in LittleFS, which cannot give it a contiguous address");
});

let bareRoot = [];

// --- 8. A BARE FIRMWARE INSTALL still lands a usable filesystem ------------------------------
/**
 * The owner's rule for Flash: no cores by default, but the partition is created WITH its
 * directory structure. On Flash content can only arrive through this tool, so a core follows a
 * ROM selection and a firmware install has none; that is why nothing here selects one.
 *
 * A LittleFS holding no directories is what he has now watched three fresh installs produce,
 * with the file browser reporting `No files found in LittleFS`. That reads as a failed install,
 * and `/data` has to exist regardless of cores: it is where the firmware writes its own state,
 * and `userDest` routes it to LittleFS precisely because a `/data` file in FrogFS opens EROFS
 * (syscalls.c) and could never be written back.
 *
 * The assertion is made on a SECOND chip, flashed from a build that carries no user content at
 * all, and read back through a mount. `type` is the field that decides it: 2 is a directory,
 * 1 is a regular file, and `lfs_mkdir` versus a zero-byte file are not interchangeable to the
 * firmware, whose `opendir` fails on a file. `releaseimage.mjs` read a non-existent
 * `isDirectory` field on this same struct and had every directory register as a file while its
 * check stayed green, so this reads `type` and nothing else.
 */
await check("8. a bare firmware install creates cores/ and data/ as directories", async () => {
  globalThis.__ext = new Uint8Array(EXT).fill(0xff);
  globalThis.__writes = [];
  // A RELEASE-SHAPED bundle: fonts, a language blob and the boot logo, and no cores. That is
  // what the published release actually carries (`releaseimage.mjs` measures it: bios=1,
  // fonts=25, lang=11, cores=0), and it matters here. This suite's usual fixture invents a
  // `cores/nes.bin` in the bundle, so asserting an empty `cores/` against it would be a claim
  // about the fixture rather than about our code.
  const releaseBundle = {
    manifest: { cores: [], dist: { paths: undefined } },
    blobs: { 1: blob(101), 2: blob(102), sd_1: blob(103), sd_2: blob(104) },
    contentFor: () => new Map([
      ["bios/logo.bin", bytes(96, 7)],
      ["fonts/f.bin", bytes(48, 12)],
      ["lang/de_de.bin", bytes(32, 3)],
    ]),
  };
  const bare = await buildFlashInstall({
    bundle: releaseBundle,
    bank: 1,
    extflashSize: EXT,
    blockSize: BLOCK,
    userRoms: new Map(),
    littlefsLength: LFS_LEN,
  });
  await flashInstallToDevice({}, bare);

  const bareExt = globalThis.__ext;
  const bareL = bare.layout;
  const bareBC = bareL.littlefsBlockCount;
  const linear = new Uint8Array(bareBC * BLOCK);
  const top = bareL.littlefsOffset + bareBC * BLOCK;
  for (let b = 0; b < bareBC; b++) {
    const off = top - (b + 1) * BLOCK;
    linear.set(bareExt.subarray(off, off + BLOCK), b * BLOCK);
  }

  let root;
  try {
    root = await listDirFromImage(linear, BLOCK, bareBC, "/", lfsOpts);
  } catch (e) {
    throw new Error(`the LittleFS of a bare install does not even mount: ${(e && e.message) || e}`);
  }
  const named = new Map(root.filter((e) => e.name !== "." && e.name !== "..").map((e) => [e.name, e]));
  for (const want of ["cores", "data"]) {
    const e = named.get(want);
    assert(e, `a bare install left no /${want} in LittleFS (root holds: ${[...named.keys()].join(", ") || "nothing at all"})`);
    assert(e.type === 2, `/${want} is type ${e.type} (1 = regular file), not a directory: opendir would fail on it`);
  }
  // No cores by default is the other half of the rule, and the half that put the Doom core on
  // his device. `userRoms` is empty and the bundle ships none, so anything here came from the
  // source auto-install this change removed.
  const cores = (await listDirFromImage(linear, BLOCK, bareBC, "/cores", lfsOpts))
    .filter((e) => e.name !== "." && e.name !== "..");
  assert(cores.length === 0, `a bare install wrote ${cores.length} core file(s): ${cores.map((e) => e.name).join(", ")}`);
  bareRoot = [...named.keys()];
});

// --- Report ------------------------------------------------------------------------------------
const lfsFiles = await lfsList("/cores");
say(`simflash: ${passed} passed, ${failures.length} failed`);
say(`  assets: ${ROM_NAME} (${ROM.data.length} B), gba.bin (${CORE.data.length} B), gba.xip (${XIP.data.length} B), bios (${BIOS.data.length} B)`);
say(`  chip:   ${EXT / MB} MiB, FrogFS ${hex(L.frogfsOffset)}..${hex(L.frogfsOffset + install.frogfs.length)}, LittleFS ${hex(L.littlefsOffset)}..${hex(EXT)} (${BC} blocks)`);
say(`  writes: ${writes.map((w) => `bank${w.bank}@${span(w)}`).join(", ")}`);
say(`  /cores on chip: ${lfsFiles.join(", ") || "(empty)"}`);
say(`  FrogFS on chip: ${[...frogByPath.keys()].length} files`);
say(`  bare install LittleFS root: ${bareRoot.join(", ") || "(nothing)"}`);
if (failures.length) {
  for (const f of failures) say(`  FAIL ${f}`);
  process.exit(1);
}
