#!/usr/bin/env node
/**
 * ZIPPED ROMS: one archive, one ROM, and the inner name is the identity.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/ziproms.mjs'
 *
 * The owner's library is 375 archives that each hold exactly one `.gb`, all deflate, and the
 * archive name is NOT the ROM name: `Aladdin.zip` holds `Disney's Aladdin (USA) (SGB
 * Enhanced).gb`. The inner name is the No-Intro one that cover art and cheat databases key on,
 * so that is what the library takes -- which makes a zipped ROM behave exactly like a loose one
 * of the same name for dedup, sizing, classification and the install-name refusal.
 *
 * Every archive here is BUILT IN THIS FILE from real deflate streams (node's zlib), not
 * committed as a fixture, so the bytes under test are a zip in the same sense his are. The
 * refusal cases are the ones his library does not contain, which is precisely why they need
 * coverage: an untested path that silently picks entry 0 installs the wrong file.
 *
 * The scan runs for real -- `scanRomDirectory` from `romScan.ts` over a node-backed directory
 * handle (`lib/fsNode.ts`), the same pairing `test/fsnode.mjs` uses. Only the reactive store
 * imports are faked.
 */
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";
import { gnwResolveFor } from "./gnwResolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
let checks = 0;
const fail = (label, detail) => {
  failures++;
  console.log(`  FAIL ${label}${detail ? `: ${detail}` : ""}`);
};
function ok(cond, label, detail) {
  checks++;
  if (!cond) fail(label, detail);
}
function eq(actual, expected, label) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(label, `got ${a}, want ${e}`);
}
async function throws(fn, re, label) {
  checks++;
  try {
    await fn();
  } catch (e) {
    if (!re.test(String(e && e.message))) fail(label, `wrong error "${e && e.message}"`);
    return;
  }
  fail(label, "expected a throw, got none");
}

// --- A real zip builder ------------------------------------------------------------------------
// Deliberately hand-rolled rather than shelling out: the refusal cases need fields a normal
// writer will not produce (encrypted flag, method 12, a zip64 marker), and patching a finished
// archive is how those get made.
function makeZip(entries, opts = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, method = 8, flags = 0 } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const body = method === 8 ? deflateRawSync(data, { level: 6 }) : Buffer.from(data);
    const crc = crc32(Buffer.from(data));
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(flags, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(body.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    const local = Buffer.concat([lfh, nameBuf, body]);
    locals.push(local);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(flags, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(body.length, 20);
    cdh.writeUInt32LE(opts.zip64Size ? 0xffffffff : data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([cdh, nameBuf]));
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const localAll = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(localAll.length, 16);
  return new Uint8Array(Buffer.concat([localAll, cd, eocd]));
}

/** ROM-ish bytes: compressible, but nothing like a run of zeros. */
const romData = (n, seed = 1) => {
  const b = Buffer.alloc(n);
  let x = 0x2545f491 ^ (seed * 2654435761);
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x |= 0;
    b[i] = i % 96 < 8 ? 0 : x & 0xff;
  }
  return b;
};

// --- Build the modules under test --------------------------------------------------------------
const out = await mkdtemp(join(tmpdir(), "ziproms-build-"));
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/romScan.ts")],
  outfile: join(out, "romScan.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
  plugins: [gnwResolveFor(import.meta.url), {
    name: "romscan-fakes",
    setup(build) {
      const fakes = {
        "homebrewTitles.svelte.js":
          "export const homebrew = { deviceFiles: new Set() };" +
          "export const isHomebrewSourceFile = () => false;",
        "coreRegistry.svelte.js":
          "export const coreRegistry = { current: { systems: [], byFolder: new Map(), declaredFolders: new Set(), hasCoreSources: false } };",
        // The skip reasons go through dbg(). Captured, so the refusals can be asserted on their
        // message rather than only on the absence of a key.
        "debug.js": "globalThis.__dbg = []; export const dbg = (...a) => globalThis.__dbg.push(a.join(' ')); export const setDbgSink = () => {};",
        "util.js": "export const download = () => {};",
        "device.svelte.js": "export const device = { sdHandle: null, scanSdCardGames: async () => {} };",
        "sdFolderPick.svelte.js": "export const runSdCardFolderPick = async () => {};",
      };
      build.onResolve(
        { filter: /(homebrewTitles\.svelte|coreRegistry\.svelte|device\.svelte|sdFolderPick\.svelte|debug|util)\.js$/ },
        (a) => ({ path: a.path.slice(a.path.lastIndexOf("/") + 1), namespace: "rs-fake" }),
      );
      build.onLoad({ filter: /.*/, namespace: "rs-fake" }, (a) => ({ contents: fakes[a.path], loader: "js" }));
    },
  }],
});
const { scanRomDirectory, resolveZipRom, romBytes, materialize, LazyRom } = await import(pathToFileURL(join(out, "romScan.js")).href);

await esbuild.build({
  entryPoints: [join(here, "../src/lib/unzip.ts")],
  outfile: join(out, "unzip.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "warning",
});
const { zipList, zipExtractOne, unzip } = await import(pathToFileURL(join(out, "unzip.js")).href);

await esbuild.build({
  entryPoints: [join(here, "../src/lib/fsNode.ts")],
  outfile: join(out, "fsNode.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: ["node:*"],
  logLevel: "warning",
});
const { nodeDirHandle } = await import(pathToFileURL(join(out, "fsNode.js")).href);

// --- zipList: the central directory, and the UNCOMPRESSED size --------------------------------
{
  const rom = romData(262144, 3);
  const zip = makeZip([{ name: "Disney's Aladdin (USA) (SGB Enhanced).gb", data: rom }]);
  const list = zipList(zip);
  eq(list.length, 1, "zipList: one entry");
  eq(list[0].name, "Disney's Aladdin (USA) (SGB Enhanced).gb", "zipList: the stored name");
  // The whole point of reading the central directory: the size the UI budgets with is the
  // uncompressed one, and it is known without inflating anything.
  eq(list[0].size, rom.length, "zipList: size is the UNCOMPRESSED length");
  ok(list[0].compressedSize < rom.length, "zipList: the archive really is compressed",
     `compressed ${list[0].compressedSize} vs raw ${rom.length}`);
  eq(list[0].method, 8, "zipList: deflate");
  eq(list[0].encrypted, false, "zipList: not encrypted");

  const got = await zipExtractOne(zip, list[0]);
  ok(Buffer.from(got).equals(rom), "zipExtractOne: round-trips the ROM bytes");
  const all = await unzip(zip);
  ok(Buffer.from(all.get("Disney's Aladdin (USA) (SGB Enhanced).gb")).equals(rom),
     "unzip: still works through the shared parser");
}

// --- resolveZipRom: every verdict ------------------------------------------------------------
{
  const one = zipList(makeZip([{ name: "Alleyway (USA).gb", data: romData(32768, 4) }]));
  const v = resolveZipRom(one);
  ok(v.ok, "resolve: a single deflate entry is accepted");
  eq(v.ok && v.name, "Alleyway (USA).gb", "resolve: the INNER name is the identity");

  const none = resolveZipRom([]);
  ok(!none.ok && /holds no files/.test(none.reason), "resolve: an empty archive is refused", none.reason);

  const many = zipList(makeZip([
    { name: "a.gb", data: romData(64, 5) },
    { name: "b.gb", data: romData(64, 6) },
  ]));
  const vMany = resolveZipRom(many);
  ok(!vMany.ok && /holds 2 files \(a\.gb, b\.gb\); a ROM archive must hold exactly one/.test(vMany.reason),
     "resolve: a multi-entry archive is refused and names what it found", vMany.reason);

  const enc = zipList(makeZip([{ name: "secret.gb", data: romData(64, 7), flags: 0x1 }]));
  const vEnc = resolveZipRom(enc);
  ok(!vEnc.ok && /which is encrypted/.test(vEnc.reason), "resolve: an encrypted entry is refused", vEnc.reason);

  const bz = zipList(makeZip([{ name: "odd.gb", data: romData(64, 8), method: 12 }]));
  const vBz = resolveZipRom(bz);
  ok(!vBz.ok && /compressed with method 12/.test(vBz.reason),
     "resolve: an unsupported method is refused by number", vBz.reason);

  // A single entry may still carry a directory component; the destination is <system>/<name>.
  const nested = zipList(makeZip([{ name: "roms/gb/Tetris (World).gb", data: romData(64, 9) }]));
  const vNested = resolveZipRom(nested);
  eq(vNested.ok && vNested.name, "Tetris (World).gb", "resolve: a nested entry keeps its basename");

  const dirOnly = resolveZipRom([{ name: "sub/", size: 0, compressedSize: 0, method: 0, encrypted: false, isDirectory: true, localOffset: 0 }]);
  ok(!dirOnly.ok, "resolve: directory records are not files");
}

// --- zip64 is refused by name, never read as a truncated 32-bit size --------------------------
await throws(
  async () => zipList(makeZip([{ name: "big.gb", data: romData(64, 10) }], { zip64Size: true })),
  /zip64 archives are not supported/,
  "zipList: zip64 is refused",
);
await throws(
  async () => zipList(new Uint8Array(8)),
  /no end-of-central-directory/,
  "zipList: a non-zip is refused",
);

// --- The real scan over a real directory ------------------------------------------------------
const root = await mkdtemp(join(tmpdir(), "ziproms-"));
await mkdir(join(root, "gb"), { recursive: true });

const aladdin = romData(262144, 11);
const alleyway = romData(32768, 12);
const tetris = romData(131072, 13);

// His shape: the archive name is not the ROM name.
await writeFile(join(root, "gb/Aladdin.zip"),
  makeZip([{ name: "Disney's Aladdin (USA) (SGB Enhanced).gb", data: aladdin }]));
// A loose ROM alongside, to prove zipped and unzipped land in the same namespace.
await writeFile(join(root, "gb/Alleyway (USA).gb"), alleyway);
// Refusals, which must not stop the scan.
await writeFile(join(root, "gb/Pack.zip"),
  makeZip([{ name: "x.gb", data: romData(64, 14) }, { name: "y.gb", data: romData(64, 15) }]));
await writeFile(join(root, "gb/Broken.zip"), new Uint8Array([1, 2, 3, 4]));
// Two archives holding the SAME inner name: first wins, loser named.
const tetrisAlt = romData(131072, 16);
await writeFile(join(root, "gb/Tetris.zip"), makeZip([{ name: "Tetris (World).gb", data: tetris }]));
await writeFile(join(root, "gb/Tetris (Alt).zip"), makeZip([{ name: "Tetris (World).gb", data: tetrisAlt }]));

/**
 * A directory handle that counts every byte actually read off disk.
 *
 * The whole point of the lazy design is that a scan reads central directories, not ROMs, and a
 * type signature cannot prove that. This can: it wraps the real node handle and totals what each
 * `arrayBuffer()` hands back, whether the caller sliced first or not.
 */
function countingDir(dir, meter) {
  return {
    kind: "directory",
    name: dir.name,
    async *entries() {
      for await (const [name, h] of dir.entries()) {
        if (h.kind === "directory") yield [name, countingDir(h, meter)];
        else
          yield [name, {
            kind: "file",
            name: h.name,
            async getFile() {
              const f = await h.getFile();
              const wrap = (blob) => ({
                size: blob.size,
                slice: (...a) => wrap(blob.slice(...a)),
                async arrayBuffer() {
                  const b = await blob.arrayBuffer();
                  meter.bytes += b.byteLength;
                  meter.reads += 1;
                  return b;
                },
              });
              return wrap(f);
            },
          }];
      }
    },
  };
}

globalThis.__dbg = [];
const meter = { bytes: 0, reads: 0 };
const res = await scanRomDirectory(countingDir(nodeDirHandle(root), meter));
const scanBytes = meter.bytes;
const keys = [...res.userRoms.keys()].sort();

ok(keys.includes("gb/Disney's Aladdin (USA) (SGB Enhanced).gb"),
   "scan: the zipped ROM is keyed by its INNER name", keys.join(", "));
ok(!keys.some((k) => k.endsWith(".zip")),
   "scan: no archive name survives into the library", keys.join(", "));
// LAZY: the entry knows its uncompressed size and has not been inflated.
const aladdinEntry = res.userRoms.get("gb/Disney's Aladdin (USA) (SGB Enhanced).gb");
ok(aladdinEntry instanceof LazyRom, "scan: a zipped ROM is left un-inflated");
eq(aladdinEntry.length, aladdin.length, "scan: the size is the UNCOMPRESSED size, from the directory alone");
ok(Buffer.from(await romBytes(aladdinEntry)).equals(aladdin),
   "romBytes: inflating the entry yields the ROM");
ok(Buffer.from(res.userRoms.get("gb/Alleyway (USA).gb")).equals(alleyway),
   "scan: a loose ROM beside an archive is read as bytes, unchanged");

// THE MEASUREMENT THE DESIGN EXISTS FOR. The archives total far more than the scan read.
const archiveTotal = [
  "gb/Aladdin.zip", "gb/Pack.zip", "gb/Broken.zip", "gb/Tetris.zip", "gb/Tetris (Alt).zip",
].reduce((n, f) => n + statSync(join(root, f)).size, 0);
const romTotal = aladdin.length + tetris.length + tetrisAlt.length;
ok(scanBytes < archiveTotal, "scan: reads less than the archives themselves",
   `read ${scanBytes} of ${archiveTotal} archive bytes`);
ok(scanBytes < romTotal / 4, "scan: reads a small fraction of what inflating would produce",
   `read ${scanBytes}, inflating would produce ${romTotal}`);
console.log(`  scan read ${scanBytes} B across ${meter.reads} reads; archives are ${archiveTotal} B, inflated ROMs ${romTotal} B`);
ok(!keys.includes("gb/x.gb") && !keys.includes("gb/y.gb"),
   "scan: nothing from a multi-entry archive is installed", keys.join(", "));

const dbgText = globalThis.__dbg.join("\n");
ok(/gb\/Pack\.zip skipped: holds 2 files/.test(dbgText), "scan: the multi-entry refusal is reported", dbgText);
ok(/gb\/Broken\.zip skipped: .*end-of-central-directory/.test(dbgText), "scan: the corrupt archive is reported", dbgText);
ok(/already came from another archive/.test(dbgText), "scan: the duplicate inner name is reported", dbgText);
eq(keys.filter((k) => k === "gb/Tetris (World).gb").length, 1,
   "scan: a duplicated inner name appears exactly once");
// CONTENT, not just the key count: a Map holds one key whether the loser was refused or
// silently overwrote the winner, so counting keys cannot tell those apart. The surviving bytes
// must belong to the archive that was NOT reported as skipped.
{
  const skippedTetris = /gb\/(Tetris \(Alt\)\.zip|Tetris\.zip) skipped: gb\/Tetris \(World\)\.gb already came/.exec(dbgText);
  if (!skippedTetris) {
    // No fallback. Guessing which archive "should" have won would let this pass whenever the
    // guess happened to match the overwrite, which is exactly the vacuous shape being avoided.
    fail("scan: exactly one Tetris archive is reported as the loser", dbgText);
    fail("scan: the surviving bytes are the winner's, not the loser's", "no loser was reported");
    checks += 2;
  } else {
    const survived = await romBytes(res.userRoms.get("gb/Tetris (World).gb"));
    const loserBytes = skippedTetris[1] === "Tetris.zip" ? tetris : tetrisAlt;
    const winnerBytes = loserBytes === tetris ? tetrisAlt : tetris;
    ok(Buffer.from(survived).equals(winnerBytes),
       "scan: the surviving bytes are the winner's, not the loser's");
    ok(!Buffer.from(survived).equals(loserBytes),
       "scan: the loser did not overwrite the winner");
  }
}

// The summary the UI reads must agree with the inflated sizes, not the archive sizes.
const gb = res.summary.systems.find((s) => s.system === "gb");
eq(gb.bytes, aladdin.length + alleyway.length + tetris.length,
   "summary: bytes are the sum of INFLATED sizes");

await rm(root, { recursive: true, force: true });
await rm(out, { recursive: true, force: true });

// --- dedup does not inflate, except for a genuine collision -----------------------------------
// `libraryScan`'s tiers are identity, then path+size, then hash. The first two are answered from
// the central directory, so a zipped ROM is deduped without being read; only a path that really
// collided reaches the hash, which is the rare case the ordering already exists to protect.
{
  await esbuild.build({
    entryPoints: [join(here, "../src/lib/sources/libraryScan.ts")],
    outfile: join(out, "libraryScan.js"),
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "warning",
    plugins: [gnwResolveFor(import.meta.url), {
      name: "ls-fakes",
      setup(build) {
        const fakes = {
          "homebrewTitles.svelte.js":
            "export const homebrew = { deviceFiles: new Set() }; export const isHomebrewSourceFile = () => false;",
          "coreRegistry.svelte.js":
            "export const coreRegistry = { current: { systems: [], byFolder: new Map(), declaredFolders: new Set(), hasCoreSources: false } };",
          "debug.js": "export const dbg = () => {}; export const setDbgSink = () => {};",
          "util.js": "export const download = () => {};",
          "device.svelte.js": "export const device = { sdHandle: null, scanSdCardGames: async () => {} };",
          "sdFolderPick.svelte.js": "export const runSdCardFolderPick = async () => {};",
        };
        build.onResolve(
          { filter: /(homebrewTitles\.svelte|coreRegistry\.svelte|device\.svelte|sdFolderPick\.svelte|debug|util)\.js$/ },
          (a) => ({ path: a.path.slice(a.path.lastIndexOf("/") + 1), namespace: "ls-fake" }),
        );
        build.onLoad({ filter: /.*/, namespace: "ls-fake" }, (a) => ({ contents: fakes[a.path], loader: "js" }));
      },
    }],
  });
  const { mergeFolderScans } = await import(pathToFileURL(join(out, "libraryScan.js")).href);

  let inflations = 0;
  const lazy = (bytes, archive) =>
    new LazyRom(bytes.length, async () => { inflations++; return new Uint8Array(bytes); }, archive);

  const a = romData(4096, 21);
  const b = romData(4096, 22);

  // No collision: two different paths, both zipped. The hash tier must never run.
  inflations = 0;
  const clean = await mergeFolderScans(
    [
      { id: "f1", files: new Map([["gb/One.gb", lazy(a, "One.zip")]]), hasRomsPrefix: false },
      { id: "f2", files: new Map([["gb/Two.gb", lazy(b, "Two.zip")]]), hasRomsPrefix: false },
    ],
    { hash: async (bytes) => Buffer.from(bytes).toString("hex").slice(0, 40) },
  );
  eq(clean.hashed, 0, "dedup: no collision hashes nothing");
  eq(inflations, 0, "dedup: no collision inflates nothing");
  eq([...clean.files.keys()].sort(), ["gb/One.gb", "gb/Two.gb"], "dedup: both entries survive");

  // Same path, DIFFERENT sizes: decided on metadata, still no inflation.
  inflations = 0;
  const bySize = await mergeFolderScans(
    [
      { id: "f1", files: new Map([["gb/Same.gb", lazy(a, "A.zip")]]), hasRomsPrefix: false },
      { id: "f2", files: new Map([["gb/Same.gb", lazy(romData(8192, 23), "B.zip")]]), hasRomsPrefix: false },
    ],
    { hash: async (bytes) => Buffer.from(bytes).toString("hex").slice(0, 40) },
  );
  // The newcomer is hashed for its duplicate id, but the INCUMBENT is never read: the size
  // disagreement settled it. That is the tier ordering doing its job.
  eq(inflations, 1, "dedup: a size disagreement reads only the newcomer");
  eq(bySize.files.size, 2, "dedup: different sizes keep both variants");

  // Same path, same size, different bytes: this is the case that must hash, and it reads both.
  inflations = 0;
  const byHash = await mergeFolderScans(
    [
      { id: "f1", files: new Map([["gb/Same.gb", lazy(a, "A.zip")]]), hasRomsPrefix: false },
      { id: "f2", files: new Map([["gb/Same.gb", lazy(b, "B.zip")]]), hasRomsPrefix: false },
    ],
    { hash: async (bytes) => Buffer.from(bytes).toString("hex").slice(0, 40) },
  );
  eq(byHash.hashed, 2, "dedup: a real collision hashes both");
  eq(inflations, 2, "dedup: a real collision inflates both, and only then");
  eq(byHash.files.size, 2, "dedup: different bytes under one name keep both");
}

// --- materialize: the install seam ------------------------------------------------------------
{
  const rom = romData(2048, 31);
  let inflations = 0;
  const plan = new Map([
    ["gb/Lazy.gb", new LazyRom(rom.length, async () => { inflations++; return new Uint8Array(rom); }, "Lazy.zip")],
    ["gb/Plain.gb", new Uint8Array(rom)],
  ]);
  eq(inflations, 0, "materialize: building the plan inflates nothing");
  const real = await materialize(plan);
  eq(inflations, 1, "materialize: exactly the lazy entry is inflated");
  ok(real.get("gb/Lazy.gb") instanceof Uint8Array, "materialize: the result is real bytes");
  ok(Buffer.from(real.get("gb/Lazy.gb")).equals(rom), "materialize: the bytes are the ROM");
}

console.log(`\nziproms: ${checks - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
