#!/usr/bin/env node
/**
 * Offline coverage for `scanExtflashPartitions()` / `readFrogfsState()`
 * (src/lib/engine/fsscan.ts) — the parser that turns raw external-flash bytes into the
 * partition map the rest of the app reasons about (`frogfsOffset`, the LittleFS
 * `ceilingOffset`, `baseInstalled`, the OFW/asset regions).
 *
 *   docker compose exec dev sh -c 'cd /app && node apps/web/test/fsscan.mjs'
 *
 * Plain node, no framework (repo convention). NOTHING here touches a device: the seam is
 * the `ExtReadFn` read-closure the real code already takes as a parameter, backed by a
 * synthetic in-memory chip image. Everything above that closure is the real shipping
 * parser, unmodified.
 *
 * Why this file exists: a misparse here does not throw. It silently yields a
 * plausible-looking wrong map, and the first symptom on hardware is a bad write.
 *
 * Image realism: layouts are built from references/game-and-watch-retro-go-sd/
 * Makefile.common (READ ONLY) — EXTFLASH_OFFSET reserves the bottom of the chip for the
 * stock OFW image, the Retro-Go region starts there, LittleFS is carved off the TOP
 * (default FILESYSTEM_SIZE = EXTFLASH_SIZE / 10 rounded down to 4096) and FrogFS gets what
 * is left in between. `EXTFLASH_OFFSET + EXTFLASH_SIZE` must be a power of two, which is
 * why every chip size below is one.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// --- Tiny harness ----------------------------------------------------------------------
let passed = 0;
const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => void passed++,
    (e) => void failures.push(`${name}: ${e && e.message ? e.message : e}`),
  );
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
function deepEq(a, b, msg) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg || "not equal"}:\n  got  ${x}\n  want ${y}`);
}

// --- Compile the module under test ------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-fsscan-"));
const esbuild = await import("esbuild");
import { gnwResolveFor } from "./gnwResolve.mjs";
await esbuild.build({
  entryPoints: [join(here, "../src/lib/engine/fsscan.ts")],
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@gnw/*"],
  logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url)],
});
const { scanExtflashPartitions, readFrogfsState } =
  await import(pathToFileURL(join(out, "fsscan.js")).href);

// --- Synthetic chip images --------------------------------------------------------------
const KB = 1024, MB = 1024 * 1024;

/** A chip image + the read closure the real scanner takes. Every read is bounds-checked
 *  and recorded, so an out-of-range access is a test failure rather than a silent zero. */
function chip(size, fill = 0xff) {
  const buf = new Uint8Array(size).fill(fill);
  const reads = [];
  const read = async (off, len) => {
    reads.push([off, len]);
    if (off < 0 || len < 0 || off + len > size)
      throw new Error(`out-of-range read: off=${off} len=${len} size=${size}`);
    return buf.subarray(off, off + len);
  };
  return {
    size, buf, reads, read,
    put(off, bytes) { buf.set(Uint8Array.from(bytes), off); return this; },
    u32(off, v) {
      buf[off] = v & 0xff; buf[off + 1] = (v >>> 8) & 0xff;
      buf[off + 2] = (v >>> 16) & 0xff; buf[off + 3] = (v >>> 24) & 0xff;
      return this;
    },
    ascii(off, s) { for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i); return this; },
  };
}

// Signatures, copied from fsscan.ts. Deliberately duplicated rather than imported: if a
// constant in the source is corrupted, this suite must go red (see the mutation table in
// the report), which an import would silently prevent.
const MARIO_INT_SIG     = [0x30, 0x13, 0x01, 0x20];
const ZELDA_INT_SIG     = [0x20, 0xb6, 0x01, 0x20];
const ZELDA_STOCK_SIG   = [0x3c, 0x13, 0x96, 0xc5, 0x79, 0x38, 0x71, 0xd6];
const ZELDA_PATCHED_SIG = [0x22, 0x21, 0x23, 0x22, 0x22, 0x22, 0x22, 0x22];
const MARIO_STOCK_SIG   = [0xfe, 0x6e, 0xf8, 0x01, 0x30, 0x77, 0x2d, 0x3a];
const MARIO_PATCHED_SIG = [0x78, 0xd8, 0xa9, 0x10, 0x8d, 0x00, 0x20, 0xa2];

/** Write a 32-byte LittleFS v2 superblock. The scanner reads exactly these fields:
 *  "littlefs" @+8, u32 version @+20 (major = high half must be 2), block_size @+24,
 *  block_count @+28. */
function lfsSuperblock(c, off, blockSize, blockCount, version = 0x00020001) {
  for (let i = 0; i < 32; i++) c.buf[off + i] = 0;
  c.ascii(off + 8, "littlefs");
  c.u32(off + 20, version);
  c.u32(off + 24, blockSize);
  c.u32(off + 28, blockCount);
  return c;
}

/**
 * Place a Retro-Go LittleFS partition [start, start+size) the way the firmware does:
 * the partition grows DOWNWARD from its top, so the superblock anchor the scanner keys on
 * is the LAST block — anchor = start + size - blockSize. fsscan recovers the start with
 * `pStart = anchorOff + bsize - pSize`, which is only correct for that placement.
 */
function placeLfs(c, start, size, blockSize = 4096) {
  const anchor = start + size - blockSize;
  lfsSuperblock(c, anchor, blockSize, size / blockSize);
  return anchor;
}

/** FrogFS head: "FROG" magic, u32 image size @+8 (fsscan's `binSize`). */
function placeFrogfs(c, off, binSize, numFiles = 0) {
  c.ascii(off, "FROG");
  c.buf[off + 6] = numFiles & 0xff;
  c.buf[off + 7] = (numFiles >>> 8) & 0xff;
  c.u32(off + 8, binSize);
  return c;
}

/** A FAT16/32-ish boot sector, enough for the scanner's BPB checks. */
function placeFat(c, off, bytesPerSector, totalSectors) {
  c.buf[off] = 0xeb; c.buf[off + 1] = 0x3c; c.buf[off + 2] = 0x90;
  c.buf[off + 0x0b] = bytesPerSector & 0xff;
  c.buf[off + 0x0c] = (bytesPerSector >>> 8) & 0xff;
  if (totalSectors <= 0xffff) {
    c.buf[off + 0x13] = totalSectors & 0xff;
    c.buf[off + 0x14] = (totalSectors >>> 8) & 0xff;
  } else c.u32(off + 0x20, totalSectors);
  c.buf[off + 510] = 0x55; c.buf[off + 511] = 0xaa;
  return c;
}

/** Makefile.common's FILESYSTEM_SIZE heuristic: EXTFLASH_SIZE / 10, floored to 4096. */
const fsSizeFor = (extflashSize) => Math.floor(extflashSize / 10 / 4096) * 4096;

const scan = (c) => scanExtflashPartitions(c.read, c.size);
const find = (parts, type) => parts.filter((p) => p.type === type);
const one = (parts, type) => {
  const m = find(parts, type);
  eq(m.length, 1, `expected exactly one ${type} partition, got ${JSON.stringify(parts)}`);
  return m[0];
};

// ========================================================================================
// 1. Realistic whole-chip layouts
// ========================================================================================
// A wrong answer here is the worst case in the app: `frogfsOffset` is where an install
// WRITES, and the LittleFS start is the ceiling it must not cross. Off by one partition and
// a ROM install erases the save filesystem, or the OFW backup at the bottom of the chip.

await check("4 MB chip: Mario OFW at the bottom, FrogFS above it, LittleFS at the top", async () => {
  // EXTFLASH_OFFSET = 1 MB (Mario stock assets preserved), EXTFLASH_SIZE = 3 MB,
  // END = 4 MB (a power of two, as Makefile.common requires).
  const c = chip(4 * MB, 0x00);
  const EXT_OFF = 1 * MB, EXT_SIZE = 3 * MB;
  const FS_SIZE = fsSizeFor(EXT_SIZE);            // 311296 = 76 * 4096
  eq(FS_SIZE, 311296, "FILESYSTEM_SIZE heuristic");
  const FS_START = EXT_OFF + EXT_SIZE - FS_SIZE;  // 3883008
  const FROG_SIZE = 2 * MB;

  c.put(0, MARIO_STOCK_SIG);                      // stock Mario assets, 1 MB, at offset 0
  placeFrogfs(c, EXT_OFF, FROG_SIZE);
  const anchor = placeLfs(c, FS_START, FS_SIZE);
  eq(anchor, 4 * MB - 4096, "the LittleFS anchor is the chip's last 4 KiB block");

  const parts = await scan(c);
  deepEq(one(parts, "Mario OFW"), { offset: 0, size: 1 * MB, type: "Mario OFW" }, "Mario OFW");
  deepEq(one(parts, "FrogFS"),
    { offset: EXT_OFF, size: FROG_SIZE, type: "FrogFS", fs: "frogfs", meta: { binSize: FROG_SIZE } },
    "FrogFS");
  deepEq(one(parts, "LittleFS"),
    { offset: FS_START, size: FS_SIZE, type: "LittleFS", fs: "littlefs",
      meta: { blockSize: 4096, blockCount: FS_SIZE / 4096 } },
    "LittleFS");
  eq(parts.length, 3, `exactly three partitions expected, got ${JSON.stringify(parts)}`);
  // The three regions must not overlap — that is the invariant the install fit maths needs.
  const sorted = [...parts].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < sorted.length; i++)
    assert(sorted[i - 1].offset + sorted[i - 1].size <= sorted[i].offset,
      `partitions overlap: ${JSON.stringify(sorted)}`);
});

await check("64 MB chip: Zelda patched assets at the bottom, FrogFS above, LittleFS at the top", async () => {
  // EXTFLASH_OFFSET = 4 MB (Zelda's asset blob), EXTFLASH_SIZE = 60 MB, END = 64 MB.
  const c = chip(64 * MB, 0x00);
  const EXT_OFF = 4 * MB, EXT_SIZE = 60 * MB;
  const FS_SIZE = fsSizeFor(EXT_SIZE);            // 6291456 = 1536 * 4096
  eq(FS_SIZE, 6 * MB, "FILESYSTEM_SIZE heuristic");
  const FS_START = EXT_OFF + EXT_SIZE - FS_SIZE;  // 60817408
  const FROG_SIZE = 40 * MB;

  // The Zelda patched-asset signature sits 0x20000 INTO the blob, so the partition start is
  // recovered as (probe address - 0x20000).
  c.put(0x20000, ZELDA_PATCHED_SIG);
  placeFrogfs(c, EXT_OFF, FROG_SIZE);
  placeLfs(c, FS_START, FS_SIZE);

  const parts = await scan(c);
  deepEq(one(parts, "Zelda Assets"), { offset: 0, size: 4 * MB, type: "Zelda Assets" }, "Zelda Assets");
  deepEq(one(parts, "FrogFS"),
    { offset: EXT_OFF, size: FROG_SIZE, type: "FrogFS", fs: "frogfs", meta: { binSize: FROG_SIZE } },
    "FrogFS");
  deepEq(one(parts, "LittleFS"),
    { offset: FS_START, size: FS_SIZE, type: "LittleFS", fs: "littlefs",
      meta: { blockSize: 4096, blockCount: FS_SIZE / 4096 } },
    "LittleFS");
  eq(parts.length, 3, `exactly three partitions expected, got ${JSON.stringify(parts)}`);
});

await check("1 MB chip with no OFW reserve: FrogFS at 0, LittleFS at the top", async () => {
  const c = chip(1 * MB, 0x00);
  const FS_SIZE = fsSizeFor(1 * MB);              // 102400 = 25 * 4096
  eq(FS_SIZE, 102400, "FILESYSTEM_SIZE heuristic");
  const FS_START = 1 * MB - FS_SIZE;
  placeFrogfs(c, 0, 512 * KB);
  placeLfs(c, FS_START, FS_SIZE);
  const parts = await scan(c);
  deepEq(one(parts, "FrogFS"),
    { offset: 0, size: 512 * KB, type: "FrogFS", fs: "frogfs", meta: { binSize: 512 * KB } }, "FrogFS");
  deepEq(one(parts, "LittleFS"),
    { offset: FS_START, size: FS_SIZE, type: "LittleFS", fs: "littlefs",
      meta: { blockSize: 4096, blockCount: 25 } }, "LittleFS");
  eq(parts.length, 2, `two partitions expected, got ${JSON.stringify(parts)}`);
});

await check("256 MB chip parses, and no read ever leaves the chip", async () => {
  const c = chip(256 * MB, 0x00);
  const FS_SIZE = fsSizeFor(256 * MB);
  const FS_START = 256 * MB - FS_SIZE;
  placeFrogfs(c, 0, 128 * MB);
  placeLfs(c, FS_START, FS_SIZE);
  const parts = await scan(c);
  eq(one(parts, "LittleFS").offset, FS_START, "LittleFS start on a 256 MB chip");
  eq(one(parts, "FrogFS").size, 128 * MB, "FrogFS size on a 256 MB chip");
  // chip()'s read closure throws on any out-of-range access, so reaching here already
  // proves it; assert the recorded log too so the property is explicit.
  for (const [off, len] of c.reads)
    assert(off >= 0 && off + len <= c.size, `read out of range: ${off}+${len} > ${c.size}`);
  assert(c.reads.length > 0, "the scanner must actually have read something");
});

// ========================================================================================
// 2. Blank chips — this is what decides `baseInstalled`
// ========================================================================================
// If either of these produced a phantom partition, the app would claim Retro-Go is
// installed on a freshly erased chip and offer an incremental install against garbage.

await check("an erased chip (all 0xFF) yields no partitions at all", async () => {
  for (const size of [1 * MB, 4 * MB, 16 * MB, 64 * MB]) {
    const parts = await scan(chip(size, 0xff));
    deepEq(parts, [], `erased ${size / MB} MB chip must scan empty`);
  }
});

await check("an all-zero chip yields no partitions at all", async () => {
  for (const size of [1 * MB, 4 * MB, 16 * MB, 64 * MB]) {
    const parts = await scan(chip(size, 0x00));
    deepEq(parts, [], `zeroed ${size / MB} MB chip must scan empty`);
  }
});

await check("the blank-chip result is not vacuous: the same chips DO find a partition once seeded", async () => {
  // Arms the two checks above — proves an empty result means "nothing there", not "the
  // scanner never looked". Same size, same fill, one signature added.
  for (const fill of [0xff, 0x00]) {
    const c = chip(4 * MB, fill);
    c.put(1 * MB, MARIO_STOCK_SIG);
    const parts = await scan(c);
    deepEq(find(parts, "Mario OFW"), [{ offset: 1 * MB, size: 1 * MB, type: "Mario OFW" }],
      `a seeded 0x${fill.toString(16)} chip must find the Mario blob`);
  }
});

// ========================================================================================
// 3. Signature detection, and the near-misses that must NOT match
// ========================================================================================
// Every negative below is armed: the identical bytes at a legal address are asserted to
// produce the partition the negative denies.

await check("all four asset signatures are found at their proper probe addresses", async () => {
  const cases = [
    ["Mario OFW",    MARIO_STOCK_SIG,   2 * MB, { offset: 2 * MB, size: 1 * MB }],
    ["Mario Assets", MARIO_PATCHED_SIG, 2 * MB, { offset: 2 * MB, size: 1 * MB }],
    ["Zelda OFW",    ZELDA_STOCK_SIG,   2 * MB, { offset: 2 * MB, size: 4 * MB }],
    ["Zelda Assets", ZELDA_PATCHED_SIG, 2 * MB + 0x20000, { offset: 2 * MB, size: 4 * MB }],
  ];
  for (const [type, sig, at, want] of cases) {
    const c = chip(16 * MB, 0x00).put(at, sig);
    const parts = await scan(c);
    deepEq(one(parts, type), { ...want, type }, `${type} @ ${at}`);
    eq(parts.length, 1, `${type}: no other partition should appear`);
  }
});

await check("both internal-flash backup signatures are found, stock vs patched by the last byte", async () => {
  for (const [dev, sig] of [["Mario", MARIO_INT_SIG], ["Zelda", ZELDA_INT_SIG]]) {
    // Last byte of the 128 KiB image still erased (0xff) => a stock OFW backup.
    const stock = chip(16 * MB, 0x00).put(3 * MB, sig);
    stock.buf[3 * MB + 131071] = 0xff;
    deepEq(one(await scan(stock), `${dev} OFW (Int)`),
      { offset: 3 * MB, size: 131072, type: `${dev} OFW (Int)` }, `${dev} stock int backup`);
    // Anything else in that last byte => a patched image.
    const pat = chip(16 * MB, 0x00).put(3 * MB, sig);
    pat.buf[3 * MB + 131071] = 0x42;
    deepEq(one(await scan(pat), `${dev} Pat(Int)`),
      { offset: 3 * MB, size: 131072, type: `${dev} Pat(Int)` }, `${dev} patched int backup`);
  }
});

await check("a signature at a misaligned address is not found (and the aligned twin is)", async () => {
  // The scanner probes on a 128 KiB lattice. Bytes 16 into a probe point are invisible to
  // it; if it ever started sub-scanning, an arbitrary ROM payload could be mistaken for an
  // OFW blob and the whole map would shift.
  for (const [type, sig, base] of [
    ["Mario OFW", MARIO_STOCK_SIG, 2 * MB],
    ["Zelda OFW", ZELDA_STOCK_SIG, 2 * MB],
    ["Mario OFW (int)", MARIO_INT_SIG, 2 * MB],
  ]) {
    for (const skew of [16, 512, 4096, 64 * KB, 131072 - 8]) {
      const c = chip(16 * MB, 0x00).put(base + skew, sig);
      deepEq(await scan(c), [], `${type} at +${skew} must not be recognised`);
    }
    // Armed: the very same bytes at the aligned address DO produce a partition.
    const aligned = chip(16 * MB, 0x00).put(base, sig);
    eq((await scan(aligned)).length, 1, `${type}: aligned twin must be recognised`);
  }
});

await check("a signature straddling the end of the chip is not found", async () => {
  // Only the first half of the 8-byte signature exists; the rest is off the end of the
  // image. The scanner must not read past the chip (chip() throws if it tries) and must
  // not match on the truncated prefix.
  const size = 16 * MB;
  const c = chip(size, 0x00);
  c.put(size - 4, MARIO_STOCK_SIG.slice(0, 4));
  deepEq(await scan(c), [], "a truncated signature at the very end must not match");
  // Armed: the full signature one 128 KiB block earlier is recognised.
  const ok = chip(size, 0x00).put(size - 1 * MB, MARIO_STOCK_SIG);
  eq(one(await scan(ok), "Mario OFW").offset, size - 1 * MB, "the full signature is found");

  // The internal-backup branch has its OWN 128 KiB overrun guard
  // (`addr + 131072 <= flashSize`), and deleting it left this suite green — the straddle
  // fixtures above only exercise the 8-byte ASSET signatures, which are guarded separately.
  // A backup signature in the last 128 KiB describes a region running off the chip.
  // The probe grid is 128 KiB, so the guard can only ever bite on a chip whose size is NOT a
  // multiple of that stride — on a power-of-two chip the last probe point always has a full
  // 128 KiB above it. `odd` is sized so that the top probe point has only 64 KiB left.
  const odd = size + 64 * KB;
  for (const [why, sig] of [["Mario", MARIO_INT_SIG], ["Zelda", ZELDA_INT_SIG]]) {
    const over = chip(odd, 0x00).put(size, sig);
    deepEq(await scan(over), [], `a ${why} internal backup 64 KiB from the top must be refused`);
    // Armed: the same signature far enough down for the 128 KiB image to fit IS emitted.
    // (a 0x00-filled image makes the last byte non-0xFF, so this reads as "Pat(Int)")
    const fits = chip(size, 0x00).put(size - 128 * KB, sig);
    deepEq(one(await scan(fits), `${why} Pat(Int)`),
      { offset: size - 128 * KB, size: 128 * KB, type: `${why} Pat(Int)` },
      `${why} internal backup exactly fitting the top of the chip is emitted`);
  }
});

await check("a truncated FrogFS/LittleFS head at the end of the chip is not found", async () => {
  const size = 4 * MB;
  const trunc = chip(size, 0x00);
  trunc.ascii(size - 2, "FR");            // "FROG" cut in half by the end of the image
  deepEq(await scan(trunc), [], "a half-written FROG magic must not become a partition");
  const lfsTrunc = chip(size, 0x00);
  lfsTrunc.ascii(size - 4, "litt");       // superblock magic cut off
  deepEq(await scan(lfsTrunc), [], "a half-written littlefs magic must not become a partition");
  // Armed: complete heads at the same distance from the end are found.
  const okFrog = chip(size, 0x00);
  placeFrogfs(okFrog, size - 128 * KB, 128 * KB);
  eq(one(await scan(okFrog), "FrogFS").offset, size - 128 * KB, "a complete FROG head is found");
});

// ========================================================================================
// 4. Bounds and sanity checks — each must REFUSE, not emit a wrong partition
// ========================================================================================

await check("an asset blob that would overrun the chip is refused", async () => {
  // Zelda blobs are 4 MB and Mario blobs 1 MB; a signature too close to the top describes a
  // partition that does not fit. Emitting it anyway would hand the UI a region extending
  // past the end of the chip — and a restore/fit calculation built on it.
  const size = 8 * MB;
  const overruns = [
    ["Zelda OFW", ZELDA_STOCK_SIG, size - 2 * MB],
    ["Mario OFW", MARIO_STOCK_SIG, size - 128 * KB],
    ["Mario Assets", MARIO_PATCHED_SIG, size - 128 * KB],
  ];
  for (const [type, sig, at] of overruns) {
    const c = chip(size, 0x00).put(at, sig);
    deepEq(await scan(c), [], `${type} @ ${at} overruns the chip and must be refused`);
  }
  // Armed: shifted down so the blob fits exactly, each one IS emitted.
  const fits = [
    ["Zelda OFW", ZELDA_STOCK_SIG, size - 4 * MB, 4 * MB],
    ["Mario OFW", MARIO_STOCK_SIG, size - 1 * MB, 1 * MB],
    ["Mario Assets", MARIO_PATCHED_SIG, size - 1 * MB, 1 * MB],
  ];
  for (const [type, sig, at, len] of fits) {
    const c = chip(size, 0x00).put(at, sig);
    deepEq(one(await scan(c), type), { offset: at, size: len, type }, `${type} exact fit`);
  }
});

await check("a Zelda patched signature below 0x20000 is refused (it implies a negative start)", async () => {
  // partition start = probe address - 0x20000. Without the guard this yields offset < 0 and
  // every downstream fit calculation goes negative.
  for (const at of [0, 0x10000]) {
    const c = chip(8 * MB, 0x00).put(at, ZELDA_PATCHED_SIG);
    deepEq(await scan(c), [], `Zelda patched sig @ 0x${at.toString(16)} must be refused`);
  }
  // Armed: the identical bytes at exactly 0x20000 give a partition starting at 0.
  const ok = chip(8 * MB, 0x00).put(0x20000, ZELDA_PATCHED_SIG);
  deepEq(one(await scan(ok), "Zelda Assets"), { offset: 0, size: 4 * MB, type: "Zelda Assets" },
    "the boundary case 0x20000 must be accepted");
});

// NOTE (mutation audit): `addLfsPartition`'s `pSize <= flashSize` term is PROVABLY DEAD —
// any superblock that trips it also trips either the negative-start bound
// (`anchorOff + bsize >= pSize`) or the top-overrun bound (`pStart + pSize <= flashSize`),
// both of which have their own checks below. This check therefore pins the observable
// refusal, not that specific term; removing any single one of the three leaves it green.
await check("a LittleFS superblock claiming more than the chip holds is refused", async () => {
  const size = 4 * MB;
  const anchor = size - 4096;
  // 4096 * 2048 = 8 MB on a 4 MB chip.
  const c = chip(size, 0x00);
  lfsSuperblock(c, anchor, 4096, 2048);
  deepEq(await scan(c), [], "an oversized LittleFS superblock must be refused");
  // Armed: the same superblock with a block count that fits IS emitted, from the same anchor.
  const ok = chip(size, 0x00);
  lfsSuperblock(ok, anchor, 4096, 256);
  deepEq(one(await scan(ok), "LittleFS"),
    { offset: size - 256 * 4096, size: 256 * 4096, type: "LittleFS", fs: "littlefs",
      meta: { blockSize: 4096, blockCount: 256 } }, "a fitting superblock at the same anchor");
});

await check("a LittleFS partition that would start before the chip is refused", async () => {
  // anchorOff + bsize >= pSize. Anchor low on the chip, partition larger than the space
  // beneath it: pStart would be negative. Without the guard the app gets a negative
  // `ceilingOffset` and every install-fit comparison silently inverts.
  const size = 16 * MB;
  const c = chip(size, 0x00);
  lfsSuperblock(c, 128 * KB, 4096, 256);          // pSize 1 MB, only 132 KiB below the anchor
  deepEq(await scan(c), [], "a LittleFS partition extending below 0 must be refused");
  // Armed: identical superblock, anchor moved up so the partition fits beneath it.
  const ok = chip(size, 0x00);
  lfsSuperblock(ok, 1 * MB + 128 * KB, 4096, 256);
  eq(one(await scan(ok), "LittleFS").offset, 1 * MB + 128 * KB + 4096 - 1 * MB,
    "the same superblock higher up is accepted");
});

await check("a LittleFS partition whose start is not 4 KiB aligned is refused", async () => {
  // A flash erase block is 4 KiB; a partition that does not start on one cannot be erased
  // without destroying its neighbour. blockSize 512 with an odd block count puts pStart at
  // a 512-byte boundary that is NOT a 4096 boundary.
  const size = 16 * MB;
  const anchor = 8 * MB;
  const c = chip(size, 0x00);
  lfsSuperblock(c, anchor, 512, 2048);            // pSize = 1 MiB, pStart lands on a 1 KiB boundary
  const pStart = anchor + 512 - 512 * 2048;
  assert(pStart % 4096 !== 0, "the fixture must really be misaligned (otherwise it proves nothing)");
  assert(pStart > 0 && pStart + 512 * 2048 <= size, "the fixture must pass every OTHER guard");
  deepEq(await scan(c), [], "a misaligned LittleFS start must be refused");
  // Armed: from the same anchor, a 4096-aligned start IS accepted.
  const aligned = chip(size, 0x00);
  lfsSuperblock(aligned, anchor, 4096, 256);
  eq(one(await scan(aligned), "LittleFS").offset, anchor + 4096 - 1 * MB, "aligned twin accepted");
});

await check("a LittleFS partition that would run off the TOP of the chip is refused", async () => {
  // pStart + pSize == anchorOff + bsize, which can exceed the chip when the anchor sits in
  // the last erase block and the block size is larger than 4096. Emitting it would give the
  // UI a `ceilingOffset` region ending past the chip — the install fit maths would then
  // believe there is room where there is none.
  const size = 4 * MB;
  const anchor = size - 4096;
  const c = chip(size, 0x00);
  lfsSuperblock(c, anchor, 8192, 256);            // pSize 2 MiB; end = size + 4096
  const pStart = anchor + 8192 - 8192 * 256;
  eq(pStart % 4096, 0, "the fixture must be 4 KiB aligned (so alignment is not what rejects it)");
  assert(pStart > 0, "the fixture must pass the start-below-zero guard");
  assert(pStart + 8192 * 256 > size, "the fixture must genuinely overrun the top of the chip");
  deepEq(await scan(c), [], "a LittleFS partition ending past the chip must be refused");
  // Armed: the identical superblock (same block size, same block count) anchored one
  // erase block below a lower probe point ends inside the chip and IS accepted.
  const ok = chip(size, 0x00);
  const lower = 2 * MB - 4096;
  lfsSuperblock(ok, lower, 8192, 256);
  assert(lower + 8192 <= size, "the arming twin must end inside the chip");
  eq(one(await scan(ok), "LittleFS").offset, lower + 8192 - 8192 * 256, "the fitting twin is accepted");
});

await check("a 32-byte block with a plausible v2 header but no \"littlefs\" magic is not a superblock", async () => {
  // Mutation audit: deleting the `ascii(b, 8, "littlefs")` term from isLfsSuperblock left
  // every other check in this file green. The blank-chip fixtures could not catch it (0x00
  // and 0xFF both fail the version test on their own), so the magic — the ONE field that
  // distinguishes a real superblock from arbitrary flash content that happens to have a 2
  // in the right halfword — was entirely unpinned.
  const size = 16 * MB, anchor = 8 * MB;
  const c = chip(size, 0x00);
  lfsSuperblock(c, anchor, 4096, 256);
  for (let i = 0; i < 8; i++) c.buf[anchor + 8 + i] = "notalfs!".charCodeAt(i);
  deepEq(await scan(c), [], "a block without the littlefs magic must not become a partition");
  // Armed: the identical block WITH the magic is found, so nothing else is doing the work.
  const ok = chip(size, 0x00);
  lfsSuperblock(ok, anchor, 4096, 256);
  eq(one(await scan(ok), "LittleFS").offset, anchor + 4096 - 1 * MB, "the magic-bearing twin is found");
});

await check("a LittleFS superblock with an out-of-range block size or a v1 disk version is refused", async () => {
  const size = 4 * MB, anchor = size - 4096;
  // Each geometry below is chosen so that the ONLY guard it trips is the block-size /
  // block-count / version one: every case lands 4 KiB aligned, above 0 and inside the chip,
  // so a green result here cannot be another check doing the work by accident.
  const bad = [
    ["blockSize 64 (below the 128 floor)", anchor, 64, 65, 0x00020001],
    ["blockSize 16384 (above the 8192 ceiling)", 2 * MB, 16384, 16, 0x00020001],
    ["blockCount 0", anchor, 4096, 0, 0x00020001],
    ["disk version 1", anchor, 4096, 256, 0x00010001],
    ["disk version 3", anchor, 4096, 256, 0x00030000],
  ];
  for (const [why, at, bsize, bcount, version] of bad) {
    const pStart = at + bsize - bsize * bcount;
    if (bcount > 0) {
      eq(pStart % 4096, 0, `${why}: fixture must be 4 KiB aligned`);
      assert(pStart >= 0 && pStart + bsize * bcount <= size, `${why}: fixture must fit the chip`);
    }
    const c = chip(size, 0x00);
    lfsSuperblock(c, at, bsize, bcount, version);
    deepEq(await scan(c), [], `${why} must be refused`);
  }
  // Armed: only the rejected field changed back to a legal value.
  const ok = chip(size, 0x00);
  lfsSuperblock(ok, anchor, 4096, 256, 0x00020001);
  eq(find(await scan(ok), "LittleFS").length, 1, "the legal twin is accepted");
});

await check("a FAT boot sector with an implausible BPB is refused", async () => {
  const size = 16 * MB;
  const badBps = chip(size, 0x00);
  placeFat(badBps, 1 * MB, 256, 1024);            // bytesPerSector below 512
  deepEq(await scan(badBps), [], "bytesPerSector 256 must be refused");
  const noSectors = chip(size, 0x00);
  placeFat(noSectors, 1 * MB, 512, 0);            // no sector count at all
  deepEq(await scan(noSectors), [], "a zero sector count must be refused");
  const noSig = chip(size, 0x00);
  placeFat(noSig, 1 * MB, 512, 1024);
  noSig.buf[1 * MB + 511] = 0x00;                 // 0x55AA boot signature broken
  deepEq(await scan(noSig), [], "a missing 0x55AA must be refused");
  // Armed: a plausible BPB at the same address IS emitted, with the size the BPB describes.
  const ok = chip(size, 0x00);
  placeFat(ok, 1 * MB, 512, 8192);
  deepEq(one(await scan(ok), "FAT"),
    { offset: 1 * MB, size: 8192 * 512, type: "FAT", fs: "fat",
      meta: { bytesPerSector: 512, totalSectors: 8192 } }, "a plausible FAT is accepted");
});

// ========================================================================================
// 5. Walk behaviour — anchors, dedup, discovery order
// ========================================================================================

await check("a superblock pair promotes the anchor to the +4096 copy", async () => {
  // Real LittleFS writes the superblock into blocks 0 and 1. When both are present at a
  // probe point, fsscan anchors on the SECOND — a different anchor means a different
  // derived start, so this is load-bearing, not cosmetic.
  const size = 16 * MB, addr = 8 * MB;
  const c = chip(size, 0x00);
  lfsSuperblock(c, addr, 4096, 256);
  lfsSuperblock(c, addr + 4096, 4096, 256);
  const both = one(await scan(c), "LittleFS");
  eq(both.offset, addr + 4096 + 4096 - 1 * MB, "the +4096 copy must be the anchor");
  // Armed: with only the first copy present the anchor (and thus the start) is 4096 lower.
  const single = chip(size, 0x00);
  lfsSuperblock(single, addr, 4096, 256);
  const alone = one(await scan(single), "LittleFS");
  eq(alone.offset, addr + 4096 - 1 * MB, "single-copy anchor");
  assert(both.offset !== alone.offset, "the two cases must differ");
});

// NOTE (mutation audit): the "exactly once" property below is over-determined — `add()`'s
// dedup and the walk's coverage skip each suffice alone, so removing either one on its own
// leaves this green. It is kept because the OBSERVABLE property is what callers depend on;
// no fixture can separate the two mechanisms without removing both at once.
await check("a partition visible from several strides is emitted exactly once", async () => {
  const c = chip(16 * MB, 0x00);
  c.put(4 * MB, MARIO_STOCK_SIG);                 // 4 MB is a probe point on every stride
  placeFrogfs(c, 8 * MB, 4 * MB);
  const parts = await scan(c);
  eq(find(parts, "Mario OFW").length, 1, "no duplicate Mario OFW");
  eq(find(parts, "FrogFS").length, 1, "no duplicate FrogFS");
  eq(parts.length, 2, `exactly two partitions, got ${JSON.stringify(parts)}`);
});

await check("progress is reported monotonically and never exceeds its total", async () => {
  // Mutation audit: `done <= total` ALONE is unfalsifiable, because the source reports
  // `Math.min(++done, total)` — the clamp guarantees it whatever `total` is. Shrinking the
  // estimate to a value the walk overshoots left this check green while the real bar would
  // sit pinned at 100% for the rest of the scan. So the assertion that matters is that the
  // clamp never ENGAGES: one increment per report, and the final count within one probe grid
  // of the estimate. Non-power-of-two sizes are included because that is where the estimate
  // (floor(flashSize / 128 KiB) + 4) is likeliest to drift.
  const strides = 4; // the source's stride list length — its estimate's slack
  const sizes = [4 * MB, 4 * MB + 64 * KB, 1 * MB + 4096];
  for (const size of sizes) {
    const c = chip(size, 0x00);
    placeFrogfs(c, 0, 512 * KB);
    const seen = [];
    await scanExtflashPartitions(c.read, c.size, (done, total) => seen.push([done, total]));
    assert(seen.length > 0, `the scan must report progress (size ${size})`);
    let prev = 0;
    for (const [done, total] of seen) {
      assert(done >= prev, `progress went backwards: ${prev} -> ${done} (size ${size})`);
      assert(done <= total, `progress exceeded its total: ${done} > ${total} (size ${size})`);
      prev = done;
    }
    // The clamp must never engage: every report advances by exactly one, so the last report's
    // `done` equals the number of reports. If it does not, `total` was too small and the bar
    // was frozen at 100% for the remainder of the scan.
    const [lastDone, total] = seen[seen.length - 1];
    eq(lastDone, seen.length, `the progress clamp engaged (size ${size}): estimate is too small`);
    assert(total - lastDone <= strides,
      `the estimate overshoots by ${total - lastDone} probes (size ${size}); the bar would stop short`);
  }
});

// ========================================================================================
// 6. readFrogfsState — the incremental-flash `dataStart`
// ========================================================================================
// CLAUDE.md: a shifted `dataStart` invalidates every 256 KiB hash block, so an incremental
// install stops skipping and rewrites the whole image. A wrong value here is not a crash,
// it is a silently slow (and needlessly wearing) flash.

/** Build a minimal FrogFS head: magic, file count, hash table, one header per file. */
function frogfsImage(files, imageSize = 64 * KB) {
  const buf = new Uint8Array(imageSize);
  const put32 = (o, v) => { buf[o] = v & 0xff; buf[o + 1] = (v >>> 8) & 0xff; buf[o + 2] = (v >>> 16) & 0xff; buf[o + 3] = (v >>> 24) & 0xff; };
  const put16 = (o, v) => { buf[o] = v & 0xff; buf[o + 1] = (v >>> 8) & 0xff; };
  "FROG".split("").forEach((ch, i) => (buf[i] = ch.charCodeAt(0)));
  put16(6, files.length);
  let hdr = 12 + files.length * 8;
  const offs = [];
  for (const f of files) {           // header: parent@0, childCount@4, nameLen@6, data@8, name@16
    offs.push(hdr);
    put16(hdr + 4, f.dir ? 0 : 0xffff);
    buf[hdr + 6] = f.name.length;
    put32(hdr + 8, f.dataOffs || 0);
    for (let i = 0; i < f.name.length; i++) buf[hdr + 16 + i] = f.name.charCodeAt(i);
    hdr += 16 + f.name.length;
  }
  files.forEach((f, i) => {
    put32(12 + i * 8 + 4, offs[i]);                       // hash table -> header offsets
    if (f.parent !== undefined) put32(offs[i], offs[f.parent]);
  });
  return { buf, offs, read: async (off, len) => buf.subarray(off, off + Math.min(len, buf.length - off)) };
}

await check("readFrogfsState returns files ordered by data offset and the smallest data offset", async () => {
  // Fixture shape matters twice over, and the original got the second half wrong by luck:
  //  - traversal order (a, c, b) must differ from data order (a, b, c), or the sort is a
  //    no-op and deleting it passes;
  //  - the SMALLEST offset must not be the LAST one visited, or `dataStart = min(...)` and
  //    `dataStart = last seen` are indistinguishable (they were, before this fixture).
  const img = frogfsImage([
    { name: "roms", dir: true },
    { name: "a.gb", parent: 0, dataOffs: 0x3000 },
    { name: "c.gb", parent: 0, dataOffs: 0x7000 },
    { name: "b.gb", parent: 0, dataOffs: 0x5000 },
  ]);
  const st = await readFrogfsState(img.read, 0, 64 * KB);
  deepEq(st.order, ["roms/a.gb", "roms/b.gb", "roms/c.gb"], "files must come back in data-offset order");
  eq(st.dataStart, 0x3000, "dataStart is the LOWEST file data offset, not the last one seen");
});

await check("readFrogfsState refuses a non-FrogFS, an empty image and an absurd file count", async () => {
  const empty = { order: [], dataStart: 0 };
  // The magic check needs a fixture that ONLY the magic can reject: an all-zero buffer (the
  // original fixture) is rejected by the zero-file-count guard first, so deleting the magic
  // test left this green. This one is a fully well-formed image with four bytes changed.
  const wrongMagic = frogfsImage([{ name: "a", dataOffs: 0x100 }]);
  "BLOG".split("").forEach((ch, i) => (wrongMagic.buf[i] = ch.charCodeAt(0)));
  deepEq(await readFrogfsState(wrongMagic.read, 0, 64 * KB), empty,
    "an otherwise-valid image with the wrong magic must be refused");
  deepEq(await readFrogfsState(frogfsImage([]).read, 0, 64 * KB), empty, "zero files must be empty");
  // NOTE (mutation audit): both file-count guards are PROVABLY DEAD and are pinned here only
  // as observable behaviour, not as those specific terms.
  //  - `numFiles > 10000`: the read is capped at 64 KiB, so a hash table for >8190 files
  //    always overruns the buffer and the NEXT guard refuses it first.
  //  - `numFiles === 0`: a zero count walks zero files and returns the same empty result
  //    anyway.
  const huge = frogfsImage([{ name: "a", dataOffs: 0x100 }]);
  huge.buf[6] = 0xff; huge.buf[7] = 0xff;                          // 65535 files
  deepEq(await readFrogfsState(huge.read, 0, 64 * KB), empty, "an absurd file count must be refused");
  const overrun = frogfsImage([{ name: "a", dataOffs: 0x100 }]);
  overrun.buf[6] = 0x00; overrun.buf[7] = 0x20;                    // 8192 files -> hash table overruns
  deepEq(await readFrogfsState(overrun.read, 0, 64 * KB), empty, "an overrunning hash table must be refused");
  // Armed: the untouched image these were derived from DOES parse.
  deepEq(await readFrogfsState(frogfsImage([{ name: "a", dataOffs: 0x100 }]).read, 0, 64 * KB),
    { order: ["a"], dataStart: 0x100 }, "the unmodified twin parses");
});

// --- Report -----------------------------------------------------------------------------
console.log(`\nfsscan: ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.error(`  FAIL  ${f}`);
process.exit(failures.length ? 1 : 0);
