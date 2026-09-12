/**
 * writeFilesToDeviceLfs() (apps/web/src/lib/engine/lfsWrite.ts) against a simulated extflash.
 *
 * The mechanism this suite exists for: `device.lfsBlockCache` is a process-lifetime Map that
 * nothing in the app ever clears, and the write path read from it. Browsing LittleFS fills it;
 * a firmware install then rewrites the whole partition; the next core install mounts the OLD
 * partition through that cache, computes its allocation and its dirty set against a layout the
 * device no longer has, and flashes those blocks over the fresh one. On a real device that
 * showed up as a Retro-Go install missing half the files it needs to boot.
 *
 * The fixture is the same shape: image A is what the browse saw, image B is what is on the
 * device now, and the cache still holds A. Everything B contains must still read back.
 *
 * Real @gnw/fs-builders, real block<->offset arithmetic; the device, the transport and the
 * flasher are fakes over one Uint8Array.
 */
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { gnwImport, gnwResolveFor } from "./gnwResolve.mjs";

const BS = 4096;
const BC = 512;
const PART_OFF = 0x100000;
const PART_SIZE = BS * BC;
const FLASH_SIZE = 0x400000;
const EXTBASE = 0x90000000;

const sha = (d) => createHash("sha256").update(d).digest("hex");
let passed = 0;
const failures = [];
const fail = (m) => failures.push(m);

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-lfsdev-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));

// The fake device. Declared before the bundle so the stub modules can close over it.
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

const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/engine/lfsWrite.ts")],
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
      name: "fake-device-layer",
      setup(b) {
        b.onResolve({ filter: /^\.\.\/device\.svelte\.js$/ }, () => ({ path: "dev", namespace: "st" }));
        b.onResolve({ filter: /^\.\/chunkedRead\.js$/ }, () => ({ path: "read", namespace: "st" }));
        b.onResolve({ filter: /^\.\/flasher\.js$/ }, () => ({ path: "flash", namespace: "st" }));
        b.onLoad({ filter: /^dev$/, namespace: "st" }, () => ({
          contents: `export const device = globalThis.__fakeDevice;`,
          loader: "js",
        }));
        b.onLoad({ filter: /^read$/, namespace: "st" }, () => ({
          // The device is read through its memory map, so an address is EXTBASE + flash offset.
          contents:
            `export async function readMemoryPaced(_t, addr, len){\n` +
            `  globalThis.__reads = (globalThis.__reads || 0) + 1;\n` +
            `  globalThis.__bytesRead = (globalThis.__bytesRead || 0) + len;\n` +
            `  return globalThis.__fakeFlash.slice(addr - 0x90000000, addr - 0x90000000 + len);\n` +
            `}`,
          loader: "js",
        }));
        b.onLoad({ filter: /^flash$/, namespace: "st" }, () => ({
          contents:
            `export async function flashImage(_g, _bank, offset, data){\n` +
            `  globalThis.__fakeFlash.set(data, offset);\n` +
            `}`,
          loader: "js",
        }));
      },
    },
  ],
});

const { writeFilesToDeviceLfs } = await import(pathToFileURL(join(out, "lfsWrite.js")).href);
const { LittleFsImage, readFileFromImage } = await gnwImport(import.meta.url, "fs-builders");

const build = async (files) => {
  const img = await LittleFsImage.create(BS, BC);
  const dirs = new Set();
  for (const p of Object.keys(files)) {
    const s = p.split("/").filter(Boolean);
    for (let k = 1; k < s.length; k++) dirs.add("/" + s.slice(0, k).join("/"));
  }
  for (const d of [...dirs].sort()) img.mkdir(d);
  for (const [p, d] of Object.entries(files)) img.writeFile(p, d);
  return img.finish();
};

// Block 0 sits at the TOP of the partition (gen_littlefs_image.py's reverse_blocks).
const offsetOf = (b) => PART_OFF + PART_SIZE - (b + 1) * BS;
const layDown = (image) => {
  for (let b = 0; b < BC; b++) flash.set(image.subarray(b * BS, (b + 1) * BS), offsetOf(b));
};
const readBack = () => {
  const img = new Uint8Array(PART_SIZE);
  for (let b = 0; b < BC; b++) img.set(flash.subarray(offsetOf(b), offsetOf(b) + BS), b * BS);
  return img;
};

// What the browse saw, before a firmware install replaced it.
const before = {
  "/cores/nes.bin": new Uint8Array(randomBytes(150 * 1024)),
  "/saves/nes/smb.sav": new Uint8Array(randomBytes(40 * 1024)),
};
// What the device holds now.
const onDevice = {
  "/cores/nes.bin": new Uint8Array(randomBytes(90 * 1024)),
  "/cores/gb.bin": new Uint8Array(randomBytes(70 * 1024)),
  "/data/favorites.txt": new TextEncoder().encode("/roms/nes/smb.nes\n"),
  "/saves/nes/smb.sav": new Uint8Array(randomBytes(40 * 1024)),
};
const imgBefore = await build(before);
layDown(await build(onDevice));

// The browse left every block it read in the cache, and nothing ever cleared it.
for (let b = 0; b < BC; b++) device.lfsBlockCache.set(b, imgBefore.slice(b * BS, (b + 1) * BS));

const added = { "/cores/gba.bin": new Uint8Array(randomBytes(200 * 1024)) };
let report = { blocksRead: 0 };
try {
  report = await writeFilesToDeviceLfs(
    // The flasher the write path asks for. `readHashes` is the device-side SHA-256 of each
    // 256 KiB chunk; returning none exercises the fallback, where nothing is trusted and the
    // partition is read. A suite that wants the fast path returns real digests instead.
    async () => ({ readHashes: async () => [] }),
    Object.entries(added).map(([path, data]) => ({ path, data })),
  );
} catch (e) {
  fail(`the write threw: ${(e && e.message) || e}`);
}

const image = readBack();
const lost = [];
for (const [p, want] of Object.entries({ ...onDevice, ...added })) {
  let got = null;
  try {
    got = await readFileFromImage(image, BS, BC, p);
  } catch {
    got = null;
  }
  if (!got || sha(got) !== sha(want)) lost.push(p);
}
if (lost.length) {
  fail(`a stale lfsBlockCache destroyed the partition: ${lost.join(", ")} no longer read back after the write`);
} else {
  passed++;
}

// The device is the only authority on its own blocks. A write that trusted the cache would
// have satisfied the check above only by accident, so state the rule directly too: every block
// littlefs mounted was covered by bytes read from the device in THIS run.
//
// BYTES, not read calls. What must hold is that nothing was served from a cache filled before
// this run, and byte coverage says that whatever granularity the fetch uses. Counting calls
// asserted "one USB round trip per block", which is a statement about the transport rather than
// about staleness, and it failed the moment the read granularity changed.
const bytesNeeded = report.blocksRead * BS;
if (report.blocksRead > 0 && !((globalThis.__bytesRead || 0) >= bytesNeeded)) {
  fail(`${report.blocksRead} blocks were mounted but only ${globalThis.__bytesRead || 0} bytes were read from the device (needed ${bytesNeeded})`);
} else {
  passed++;
}


// --- the device hash keeps a proven cache, and only a proven one -----------------------------
// The slow step was re-reading most of the partition on every write, because the cache was not
// keyed to anything and had to be assumed stale. `gnwmanager_action_hash` answers directly: one
// request, 32 bytes per 256 KiB. A chunk whose hash is unchanged since its blocks were read is
// still exactly what the device holds, so those blocks are kept.
{
  const CHUNK = 256 << 10;
  const nChunks = Math.ceil(PART_SIZE / CHUNK);
  const digest = (c) => sha(flash.subarray(PART_OFF + c * CHUNK, PART_OFF + Math.min((c + 1) * CHUNK, PART_SIZE)));
  const hashes = () => Array.from({ length: nChunks }, (_, c) => Buffer.from(digest(c), "hex"));
  const flasher = async () => ({ readHashes: async () => hashes() });

  // Fill the cache the way a read does, recording the hash each block was read against.
  device.lfsBlockCache.clear();
  device.lfsChunkHashes.clear();
  const imgNow = readBack();
  for (let b = 0; b < BC; b++) {
    device.lfsBlockCache.set(b, imgNow.slice(b * BS, (b + 1) * BS));
    // The chunk a block lives in is decided by its DEVICE offset, not its block number: the
    // partition is laid out downwards, so block 0 sits in the LAST chunk.
    const c = Math.floor((offsetOf(b) - PART_OFF) / CHUNK);
    device.lfsChunkHashes.set(c, digest(c));
  }
  const cachedBefore = device.lfsBlockCache.size;
  let reads = 0;
  globalThis.__reads = 0;
  const r = await writeFilesToDeviceLfs(flasher, [{ path: "cores/hashcheck.bin", data: new Uint8Array(3000).fill(7) }], undefined, () => {});
  reads = globalThis.__reads || 0;
  if (device.lfsBlockCache.size < cachedBefore / 2) {
    fail(`an unchanged partition dropped most of its cache (${cachedBefore} -> ${device.lfsBlockCache.size})`);
  } else if (r.blocksWritten === 0) {
    fail("the hash-verified path wrote nothing at all, so this proves nothing");
  } else {
    passed++;
  }

  // ARMED: change the partition under the cache. Every stale block must be dropped, or this is
  // the data-loss bug with extra steps.
  flash[PART_OFF + PART_SIZE - BS] ^= 0xff; // touch block 0, the top of the partition
  const before = device.lfsBlockCache.size;
  await writeFilesToDeviceLfs(flasher, [{ path: "cores/hashcheck2.bin", data: new Uint8Array(3000).fill(8) }], undefined, () => {});
  if (device.lfsBlockCache.size >= before) {
    fail(`a changed chunk kept its cached blocks (${before} -> ${device.lfsBlockCache.size})`);
  } else {
    passed++;
  }
}

if (failures.length) {
  for (const f of failures) console.error("FAIL:", f);
  process.exit(1);
}
console.log(`lfsdevicewrite: ${passed} checks passed`);
