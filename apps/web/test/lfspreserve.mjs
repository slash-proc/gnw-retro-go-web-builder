/**
 * A ROM install must not destroy the LittleFS partition.
 *
 * A device lost its LittleFS twice while `packages/fs-builders/test/lfsWrite.mjs` and
 * `apps/web/test/lfsdevicewrite.mjs` were both green, and the reason they could not see it is
 * that only ONE of the two writes a ROM install performs was ever under test. The install
 * flashes FrogFS at the bottom of the gap and then adds files to the live LittleFS at the top.
 * Both write to extflash; either can reach the other's region.
 *
 * So this suite drives BOTH against one simulated extflash and asks the same question after
 * each: does every file that was on the device still read back?
 *
 * Which end gets hit is worth stating, because it is the reverse of the intuition. The partition
 * grows DOWNWARD: `gw_littlefs.c` addresses block b at `context - (b+1) * block_size`, so block 0
 * is the sector at the TOP of flash and the HIGHEST-numbered block sits at the partition's base.
 * A FrogFS image growing up from below therefore reaches the highest block indices first, not the
 * superblock pair. Those blocks are the last littlefs allocates, so a lightly-filled partition
 * can absorb an overrun with nothing to show for it -- which is why the fixture below fills the
 * partition before testing the overrun, and why the erase-extent assertion is the primary guard:
 * it holds whether or not the damaged blocks happened to be occupied.
 */
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { gnwImport, gnwResolveFor } from "./gnwResolve.mjs";

// A real device: 4096-byte erase sector, a 2 MiB filesystem at the TOP of a 4 MiB flash.
// The partition ending exactly at the top of extflash is what the firmware assumes
// (`lfs_cfg.context = gw_layout_littlefs_top()`), so the fixture must not fake it.
const BS = 4096;
const BC = 512;
const FLASH_SIZE = 0x400000;
const PART_SIZE = BS * BC;
const PART_OFF = FLASH_SIZE - PART_SIZE;
const FROGFS_OFF = 0x10000;

const sha = (d) => createHash("sha256").update(d).digest("hex");
let passed = 0;
const failures = [];
const fail = (m) => failures.push(m);
const check = (cond, m) => (cond ? passed++ : fail(m));

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-lfspreserve-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));

const flash = new Uint8Array(FLASH_SIZE).fill(0xff);
const device = {
  partitions: [{ fs: "littlefs", offset: PART_OFF, size: PART_SIZE, meta: { blockSize: BS, blockCount: BC } }],
  info: { minEraseSizeBytes: BS },
  transport: {},
  lfsBlockCache: new Map(),
  // Mirrors the store: the write path records which device chunk hash each cached block was
  // read against, so a later write can keep proven blocks instead of re-reading the partition.
  lfsChunkHashes: new Map(),
  installedLfsTree: null,
};
globalThis.__fakeDevice = device;
globalThis.__fakeFlash = flash;
globalThis.__erases = [];

/**
 * The stub for `engine/flasher.ts`'s `flashImage`, modelling what `GnwFlasher.flash()` really
 * does to the chip rather than what the caller passed it:
 *
 *   `flash()` pads the payload UP to a multiple of the erase block size with 0xFF
 *   (`packages/gnw-flasher/src/index.ts:857`, `padBytes`) and programs the padded length with
 *   `erase: true`, so the erased extent is `ceil(len / eraseSize) * eraseSize`, not `len`.
 *
 * That padding is not an assumption made here: `packages/gnw-flasher/test/protocol.mjs:518`
 * flashes a 5000-byte payload and asserts the device is handed 8192 bytes. A stub that wrote
 * only `data.length` would model a flasher this repo does not ship, and would report this
 * suite green while the device was being erased past the end of the image.
 */
const FLASH_STUB =
  `export async function flashImage(_g, _bank, offset, data){\n` +
  `  const es = ${BS};\n` +
  `  const padded = Math.ceil(data.length / es) * es;\n` +
  `  globalThis.__erases.push([offset, offset + padded]);\n` +
  `  globalThis.__fakeFlash.fill(0xff, offset, offset + padded);\n` +
  `  globalThis.__fakeFlash.set(data, offset);\n` +
  `}`;

const esbuild = await import("esbuild");
const repoRoot = join(here, "../../..");
const LITTLEFS_WASM = join(repoRoot, "packages/fs-builders/vendor/littlefs-wasm/littlefs.wasm");

// Vite `?url` assets. The littlefs one is rewritten to the REAL wasm on disk so the builder
// actually runs; anything else resolves to a poison string emscripten would fail on loudly,
// rather than a silent stub. Same arrangement as `flashinstall.mjs`.
const urlAssets = {
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
};

// engine/patch.ts pulls the gnw-patch WASM liblzma over fetch(). Nothing here compresses, so
// invoking it is a hard failure rather than a silently different code path.
const stubPatch = {
  name: "stub-patch",
  setup(b) {
    b.onResolve({ filter: /^\.\/patch\.js$/ }, () => ({ path: "patch-stub", namespace: "st" }));
    b.onLoad({ filter: /^patch-stub$/, namespace: "st" }, () => ({
      contents:
        `export async function loadLiblzma(){ ` +
        `return () => { throw new Error("lzmaRaw was invoked — nothing in this suite compresses"); }; }`,
      loader: "js",
    }));
  },
};

const fakeLayer = {
  name: "fake-device-layer",
  setup(b) {
    b.onResolve({ filter: /device\.svelte\.js$/ }, () => ({ path: "dev", namespace: "st" }));
    b.onResolve({ filter: /chunkedRead\.js$/ }, () => ({ path: "read", namespace: "st" }));
    b.onResolve({ filter: /flasher\.js$/ }, () => ({ path: "flash", namespace: "st" }));
    b.onLoad({ filter: /^dev$/, namespace: "st" }, () => ({
      contents: `export const device = globalThis.__fakeDevice;`,
      loader: "js",
    }));
    b.onLoad({ filter: /^read$/, namespace: "st" }, () => ({
      contents:
        `export async function readMemoryPaced(_t, addr, len){\n` +
        `  return globalThis.__fakeFlash.slice(addr - 0x90000000, addr - 0x90000000 + len);\n` +
        `}`,
      loader: "js",
    }));
    b.onLoad({ filter: /^flash$/, namespace: "st" }, () => ({ contents: FLASH_STUB, loader: "js" }));
  },
};

await esbuild.build({
  entryPoints: [join(here, "../src/lib/engine/lfsWrite.ts"), join(here, "../src/lib/engine/flashInstall.ts")],
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@gnw/*"],
  logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url), urlAssets, stubPatch, fakeLayer],
});

const { writeFilesToDeviceLfs } = await import(pathToFileURL(join(out, "lfsWrite.js")).href);
const { flashFrogfsRegion } = await import(pathToFileURL(join(out, "flashInstall.js")).href);
const { buildCoresLittlefs, readFileFromImage } = await gnwImport(import.meta.url, "fs-builders");

/** Lay the partition down the way the installer does: reversed by buildCoresLittlefs, flashed flat. */
const install = async (files) => {
  const image = await buildCoresLittlefs(
    Object.entries(files).map(([path, data]) => ({ path: path.replace(/^\//, ""), data })),
    { blockSize: BS, blockCount: BC },
  );
  if (image.length !== PART_SIZE) fail(`installer image is ${image.length} bytes, expected ${PART_SIZE}`);
  flash.fill(0xff, PART_OFF, PART_OFF + PART_SIZE);
  flash.set(image, PART_OFF);
};

/** Read the partition back into logical block order, undoing the device's downward layout. */
const readBack = () => {
  const img = new Uint8Array(PART_SIZE);
  for (let b = 0; b < BC; b++) {
    const off = PART_OFF + PART_SIZE - (b + 1) * BS;
    img.set(flash.subarray(off, off + BS), b * BS);
  }
  return img;
};

const survivors = async (expected) => {
  const image = readBack();
  const lost = [];
  for (const [p, want] of Object.entries(expected)) {
    let got = null;
    try {
      got = await readFileFromImage(image, BS, BC, p);
    } catch {
      got = null;
    }
    if (!got) lost.push(`${p} (gone)`);
    else if (sha(got) !== sha(want)) lost.push(`${p} (${got.length} bytes, wanted ${want.length})`);
  }
  return lost;
};

const verify = async (expected, label) => {
  const lost = await survivors(expected);
  check(
    lost.length === 0,
    `${label}: ${lost.length} of ${Object.keys(expected).length} files did not survive: ${lost.join(", ")}`,
  );
};

// A throw is a failure with a name, not a crashed suite: a broken block<->offset mapping makes
// the mount fail with LFS_ERR_CORRUPT, and that should read as this suite's finding rather than
// as an unhandled rejection with a bare error code.
const write = async (files, label) => {
  try {
    return await writeFilesToDeviceLfs(
      // The flasher the write path asks for. `readHashes` is the device-side SHA-256 of each
    // 256 KiB chunk; returning none exercises the fallback, where nothing is trusted and the
    // partition is read. A suite that wants the fast path returns real digests instead.
    async () => ({ readHashes: async () => [] }),
      Object.entries(files).map(([path, data]) => ({ path: path.replace(/^\//, ""), data })),
    );
  } catch (e) {
    fail(`${label}: the LittleFS write threw: ${(e && e.message) || e}`);
    return null;
  }
};

// What a Retro-Go firmware install leaves behind: the cores it boots with, and the user's saves.
const onDevice = {
  "/cores/nes_fceu.bin": new Uint8Array(randomBytes(150 * 1024)),
  "/cores/tgb.bin": new Uint8Array(randomBytes(90 * 1024)),
  "/cores/sms.bin": new Uint8Array(randomBytes(80 * 1024)),
  "/cores/mappers/mappers.pak": new Uint8Array(randomBytes(60 * 1024)),
  "/saves/nes/smb.sav": new Uint8Array(randomBytes(40 * 1024)),
  "/data/favorites.txt": new TextEncoder().encode("/roms/nes/smb.nes\n"),
};
const gba = { "/cores/gba.bin": new Uint8Array(randomBytes(149339)) };
// Enough to push allocation into the highest block indices, which is where an image growing up
// from the FrogFS side lands. Without this the overrun below damages only free blocks and the
// survival check passes while the partition is being erased.
const bulk = {};
for (let i = 0; i < 12; i++) bulk[`/roms/filler/pad${i}.bin`] = new Uint8Array(randomBytes(110 * 1024));
const lynx = { "/cores/lynx.bin": new Uint8Array(randomBytes(70 * 1024)) };

// --- 1. the LittleFS write, run repeatedly -------------------------------------------------
// The second install is the one that emptied his device, so the write runs more than once and
// is checked after each. Nothing is reset between them: same flash, same module-level `device`,
// same process-lifetime block cache.
await install(onDevice);
await write(gba, "first write");
await verify({ ...onDevice, ...gba }, "after the first LittleFS write");
await write(lynx, "second write");
await verify({ ...onDevice, ...gba, ...lynx }, "after a second LittleFS write");
await write(gba, "rewrite of an existing file");
await verify({ ...onDevice, ...gba, ...lynx }, "after rewriting a file that already existed");

const strayed = globalThis.__erases.filter(([s, e]) => s < PART_OFF || e > PART_OFF + PART_SIZE);
check(
  strayed.length === 0,
  `the LittleFS write erased outside its own partition: ${strayed
    .slice(0, 4)
    .map(([s, e]) => `0x${s.toString(16)}..0x${e.toString(16)}`)
    .join(", ")}`,
);

// --- 2. the FrogFS write must not reach the partition above it ------------------------------
/**
 * `flashFrogfsRegion`'s fits-check is the only thing standing between a ROM install and the
 * user's saves, because a ROM install does NOT rebuild the LittleFS partition. If an oversized
 * image reached `flashImage`, the erase would run straight through LittleFS block 0, which is
 * the TOP sector of the partition and half of the superblock pair. That does not lose one file;
 * it stops the partition mounting at all, which on screen is a file browser reporting LittleFS
 * as empty.
 *
 * PADDING WAS RULED OUT HERE, and the fixture records why rather than leaving it to be
 * rediscovered. `flash()` pads up to the erase block size and erases the padded extent, so an
 * image ending just below the ceiling looks like it should erase the sector above it. It cannot:
 * `frogfsOffset` and `ceilingOffset` are both erase-aligned (the LittleFS base is a whole number
 * of erase blocks below the top of flash), so the gap is a whole multiple of the erase size and
 * `ceil(len / eraseSize) * eraseSize > gap` implies `len > gap`, which the existing check already
 * refuses. An image is therefore either refused or fits with its padding.
 */
const GAP = PART_OFF - FROGFS_OFF;
if (GAP % BS !== 0) fail(`fixture is wrong: the gap ${GAP} is not a multiple of the erase size`);

const filled = { ...onDevice, ...bulk };
await install(filled);
globalThis.__erases.length = 0;
const tooBig = new Uint8Array(GAP + 1).fill(0x5a);
let refused = null;
try {
  await flashFrogfsRegion(async () => ({}), tooBig, { frogfsOffset: FROGFS_OFF, ceilingOffset: PART_OFF });
} catch (e) {
  refused = e;
}

check(
  refused !== null,
  `flashFrogfsRegion accepted a ${tooBig.length}-byte image into a ${GAP}-byte gap`,
);
const intoPartition = globalThis.__erases.filter(([, e]) => e > PART_OFF);
check(
  intoPartition.length === 0,
  `the FrogFS write erased into the LittleFS partition: ${intoPartition
    .slice(0, 4)
    .map(([s, e]) => `0x${s.toString(16)}..0x${e.toString(16)}`)
    .join(", ")}`,
);
// The refusal is only worth anything if the partition is still there afterwards. This is the
// assertion that fails when the fits-check is removed, and it fails by naming lost files
// rather than by counting erases, which is the thing the owner actually experienced.
await verify(filled, "after an oversized FrogFS image was refused");

// --- 3. an image that genuinely fits must still be accepted ---------------------------------
// The refusal above is only correct if it is not simply refusing everything. An image whose
// padded extent lands exactly on the ceiling is the largest legal one and must go through.
await install(filled);
globalThis.__erases.length = 0;
const exact = new Uint8Array(GAP - BS + 1).fill(0x5a); // pads to exactly GAP
let rejectedGood = null;
try {
  await flashFrogfsRegion(async () => ({}), exact, { frogfsOffset: FROGFS_OFF, ceilingOffset: PART_OFF });
} catch (e) {
  rejectedGood = e;
}
check(rejectedGood === null, `an image that fits once padded was refused: ${rejectedGood && rejectedGood.message}`);
check(
  globalThis.__erases.every(([, e]) => e <= PART_OFF),
  "a legal FrogFS write still erased past the ceiling",
);
await verify(filled, "after a FrogFS write that exactly fills the gap");

if (failures.length) {
  for (const f of failures) console.error("FAIL:", f);
  process.exit(1);
}
console.log(`lfspreserve: ${passed} checks passed`);
