// Validation for the FrogFS image builder against retro-go's own mkfrogfs.py:
//   1. write a deterministic staging tree to test/ref/tree/
//   2. build out.bin with FrogFsImage
//   3. run frogfs_oracle.py → ref.bin via retro-go's own mkfrogfs.py
//   4. assert out.bin matches ref.bin everywhere the two tools must agree, and
//      differs ONLY in the two places our builder deliberately diverges.
//
// Our builder is NOT a whole-image byte-clone of mkfrogfs.py and cannot be: it
// (a) pads the data section up to a 4 KiB boundary and (b) orders file data by a
// system/basename key, both so that adding a ROM does not shift the offset of
// every existing payload and invalidate every 256 KiB flash hash block (see
// CLAUDE.md, "Incremental Flashing"). This suite used to demand whole-image
// byte-identity, which those two features made permanently unsatisfiable.
//
// So the diff below is exact rather than whole-image: the head (minus binSize),
// the hash table, and every entry header (minus the file dataOffs fixups) must be
// byte-identical, every file's bytes must be byte-identical, and the ONLY bytes
// allowed to differ in the metadata region are file dataOffs words. Nothing else
// may drift, and the two deliberate divergences are pinned explicitly.
//
// Deterministic content (no randomness) so the image — and its crc32 footer —
// are reproducible across runs.
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { FrogFsImage, FrogFsError, parseFrogfs } from "../dist/index.js";

const refDir = fileURLToPath(new URL("./ref/", import.meta.url));
const treeDir = fileURLToPath(new URL("./ref/tree/", import.meta.url));
const oracle = fileURLToPath(new URL("./frogfs_oracle.py", import.meta.url));

// deterministic byte fill
const fill = (n, seed) => {
  const b = new Uint8Array(n);
  let s = (seed * 2654435761) >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    b[i] = (s >>> 16) & 0xff;
  }
  return b;
};

// Exercise: root file, multi-level dirs, shared dirs, an empty file, a dotted
// name, varying name lengths (→ seg_sz + alignment padding edge cases).
const files = {
  "readme.txt": fill(19, 1),
  "a.b.c": fill(33, 2),
  "empty.dat": new Uint8Array(0),
  "bios/gb_bios.bin": fill(256, 3),
  "roms/nes/smb.nes": fill(5000, 4),
  "roms/nes/zelda.nes": fill(4096, 5),
  "roms/gb/tetris.gb": fill(32 * 1024, 6),
  "covers/nes/super_mario_bros.png": fill(1234, 7),
  // adversarial: names of length 1..5 (seg_sz + alignment), deep nesting,
  // a one-byte file, a UTF-8 (multi-byte) name, dirs holding files+subdirs.
  "x": fill(1, 8),
  "ab": fill(2, 9),
  "abc": fill(3, 10),
  "abcd": fill(7, 11),
  "roms/gb/zz": fill(15, 12),
  "deep/a/b/c/d/e/leaf.bin": fill(63, 13),
  "fonts/café_ñ.fnt": fill(99, 14),
};

// 1. write tree to disk
rmSync(refDir, { recursive: true, force: true });
mkdirSync(treeDir, { recursive: true });
for (const [rel, data] of Object.entries(files)) {
  const abs = treeDir + rel;
  mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
  writeFileSync(abs, data);
}

// 2. build with FrogFsImage
const img = new FrogFsImage();
for (const [rel, data] of Object.entries(files)) img.addFile(rel, data);
const out = img.build();
const outPath = refDir + "out.bin";
writeFileSync(outPath, out);
console.log(`built FrogFS image: ${out.length} bytes (${Object.keys(files).length} files)`);

// 3. oracle → ref.bin
const refPath = refDir + "ref.bin";
const py = spawnSync("python3", [oracle, treeDir.replace(/\/$/, ""), refPath], {
  encoding: "utf8",
});
if (py.stdout) process.stdout.write(py.stdout);
if (py.status !== 0) {
  if (py.stderr) process.stderr.write(py.stderr);
  console.error("oracle failed");
  process.exit(1);
}

// 4. structural diff against the oracle
const ref = new Uint8Array(readFileSync(refPath));

let fails = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "OK  " : "FAIL"} ${msg}`);
  if (!cond) fails++;
};

const pOut = parseFrogfs(out);
const pRef = parseFrogfs(ref);
const dvOut = new DataView(out.buffer, out.byteOffset, out.byteLength);
const dvRef = new DataView(ref.buffer, ref.byteOffset, ref.byteLength);

// -- head: magic/version/entry count identical; only binSize may differ --------
ok(pOut.head.magic === pRef.head.magic, `magic 0x${pOut.head.magic.toString(16)}`);
ok(pOut.head.verMajor === pRef.head.verMajor && pOut.head.verMinor === pRef.head.verMinor,
   `version ${pOut.head.verMajor}.${pOut.head.verMinor}`);
ok(pOut.head.numEntries === pRef.head.numEntries,
   `numEntries ${pOut.head.numEntries} == ${pRef.head.numEntries}`);
ok(out.subarray(0, 8).every((b, i) => b === ref[i]), "head[0,8) byte-identical");
ok(pOut.head.binSize === out.length, `binSize ${pOut.head.binSize} == image length`);
ok(pRef.head.binSize === ref.length, "oracle binSize == oracle image length");

// -- hash table: identical, entry for entry --------------------------------
const n = pOut.head.numEntries;
const HT = 12; // head is 12 bytes: magic(4) ver(2) numEntries(2) binSize(4)
let htSame = n === pRef.head.numEntries;
for (let i = 0; htSame && i < n * 8; i++) htSame = out[HT + i] === ref[HT + i];
ok(htSame, `hash table identical (${n} entries, ${n * 8} bytes)`);
ok(n === 29, `entry count is the expected 29 (15 files + 14 dirs), got ${n}`);

// -- file list: same paths, same sizes ---------------------------------------
const key = (p) => p.files.map((f) => `${f.path}:${f.dataSize}`).sort().join("|");
ok(key(pOut) === key(pRef), `same ${pOut.files.length} files with the same sizes`);

// -- entry headers: byte-identical except the file dataOffs fixups ------------
// The oracle packs data immediately after the headers, so its first data offset
// marks the end of the shared metadata region.
const headersEnd = Math.min(...pRef.files.filter((f) => f.dataSize > 0).map((f) => f.dataOffs));
ok(headersEnd > HT + n * 8, `headers region is non-empty (ends at ${headersEnd}, past the ${HT + n * 8}-byte head+hashtable)`);
const offOut = new Map(pOut.files.map((f) => [f.path, f.dataOffs]));
const offRef = new Map(pRef.files.map((f) => [f.path, f.dataOffs]));
const diffWords = new Set();
let strayDiff = 0;
for (let i = 8; i < headersEnd; i++) {
  if (out[i] === ref[i]) continue;
  if (i < 12) continue; // binSize, already accounted for
  diffWords.add(i & ~3);
}
for (const w of diffWords) {
  const va = dvOut.getUint32(w, true);
  const vb = dvRef.getUint32(w, true);
  const explained = [...offOut.entries()].some(([path, o]) => o === va && offRef.get(path) === vb);
  if (!explained) {
    strayDiff++;
    console.error(`  stray metadata difference at 0x${w.toString(16)}: out=${va} ref=${vb}`);
  }
}
ok(strayDiff === 0, `metadata differs only in file dataOffs words (${diffWords.size} words)`);
ok(diffWords.size === pOut.files.length,
   `exactly one dataOffs fixup per file (${diffWords.size}/${pOut.files.length})`);

// -- file contents: byte-identical -------------------------------------------
let contentBad = [];
for (const f of pOut.files) {
  const g = pRef.files.find((x) => x.path === f.path);
  if (!g || g.dataSize !== f.dataSize) { contentBad.push(f.path); continue; }
  for (let i = 0; i < f.dataSize; i++) {
    if (out[f.dataOffs + i] !== ref[g.dataOffs + i]) { contentBad.push(f.path); break; }
  }
  // and the bytes really are the ones we staged
  const want = files[f.path];
  if (want && (want.length !== f.dataSize || want.some((b, i) => b !== out[f.dataOffs + i]))) {
    contentBad.push(f.path + " (vs staged input)");
  }
}
ok(contentBad.length === 0, `every file's bytes identical to the oracle's (${pOut.files.length} files)${contentBad.length ? ": " + contentBad.join(", ") : ""}`);

// -- the two deliberate divergences, pinned ----------------------------------
const dataStartOut = Math.min(...pOut.files.filter((f) => f.dataSize > 0).map((f) => f.dataOffs));
ok(dataStartOut % 4096 === 0, `our data section starts 4 KiB-aligned (0x${dataStartOut.toString(16)})`);
ok(dataStartOut >= headersEnd, "our data section starts at or after the headers");
ok(out.slice(headersEnd, dataStartOut).every((b) => b === 0), "the alignment gap is zero-filled");
// ordering: strip the top-level bucket and the extension, then sort
const stripKey = (p) => p.replace(/^(?:roms|cheats|saves|covers)\//, "").replace(/\.[^.]+$/, "");
const placed = pOut.files.filter((f) => f.dataSize > 0).sort((a, b) => a.dataOffs - b.dataOffs).map((f) => f.path);
const expected = [...placed].sort((a, b) => {
  const ka = stripKey(a), kb = stripKey(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
});
ok(JSON.stringify(placed) === JSON.stringify(expected), "file data laid out in system/basename order");
// the oracle, by contrast, packs in plain dest order — proving the two really differ
const refPlaced = pRef.files.filter((f) => f.dataSize > 0).sort((a, b) => a.dataOffs - b.dataOffs).map((f) => f.path);
ok(JSON.stringify(refPlaced) !== JSON.stringify(placed),
   "the layouts genuinely differ (so this suite is not silently comparing identical orders)");

// -- footer crc32 over everything before it ----------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
})();
const crc32 = (d) => {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = crcTable[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
ok(crc32(out.subarray(0, out.length - 4)) === dvOut.getUint32(out.length - 4, true),
   "footer crc32 covers the whole image");
ok(crc32(ref.subarray(0, ref.length - 4)) === dvRef.getUint32(ref.length - 4, true),
   "the oracle's footer crc32 checks out the same way (same algorithm)");

// -- incremental stability: dataStart + previousOrder -------------------------
// The whole point of the two divergences above is that adding a ROM must not
// shift the payloads already on the device, or every 256 KiB flash hash block is
// invalidated and nothing can be skipped (CLAUDE.md, "Incremental Flashing").
// Neither build option was exercised anywhere, so both could be ignored outright
// with every suite still green.
{
  const mk = (extra) => {
    const im = new FrogFsImage();
    for (const [rel, data] of Object.entries(files)) im.addFile(rel, data);
    if (extra) im.addFile(extra[0], extra[1]);
    return im;
  };
  const a = mk(null).build();
  const pa = parseFrogfs(a);
  const placedA = pa.files.filter((f) => f.dataSize > 0).sort((x, y) => x.dataOffs - y.dataOffs);
  const dataStartA = placedA[0].dataOffs;
  const orderA = placedA.map((f) => f.path);

  const added = ["roms/nes/newgame.nes", fill(9001, 42)];
  const b = mk(added).build({ dataStart: dataStartA, previousOrder: orderA });
  const pb = parseFrogfs(b);
  const offB = new Map(pb.files.map((f) => [f.path, f.dataOffs]));

  let shifted = [];
  for (const f of placedA) if (offB.get(f.path) !== f.dataOffs) shifted.push(f.path);
  ok(shifted.length === 0, `adding a ROM shifts no existing payload${shifted.length ? ": " + shifted.join(", ") : ""}`);
  ok(offB.get(added[0]) !== undefined && offB.get(added[0]) > placedA[placedA.length - 1].dataOffs,
     "the new ROM is appended after the existing payloads");
  // and the bytes really are unchanged where the offsets are
  let moved = 0;
  for (const f of placedA) {
    for (let i = 0; i < f.dataSize; i++) if (a[f.dataOffs + i] !== b[f.dataOffs + i]) { moved++; break; }
  }
  ok(moved === 0, "existing payload bytes are identical at the same offsets");

  // Control: WITHOUT the options the layout does move, so the check above is not
  // passing merely because nothing ever shifts.
  const c = mk(added).build();
  const offC = new Map(parseFrogfs(c).files.map((f) => [f.path, f.dataOffs]));
  ok(placedA.some((f) => offC.get(f.path) !== f.dataOffs),
     "without dataStart/previousOrder the payloads do move (control)");
}

// -- builder guards the oracle diff cannot reach -----------------------------
// A djb2 collision makes the on-device hashtable lookup return the wrong file,
// so the builder must refuse to emit such an image. "aaaa_" and "aaaf8" both
// hash to 0x0a1e6fba.
{
  const img2 = new FrogFsImage();
  img2.addFile("aaaa_", new Uint8Array([1]));
  img2.addFile("aaaf8", new Uint8Array([2]));
  let threw = null;
  try { img2.build(); } catch (e) { threw = e; }
  ok(threw instanceof FrogFsError, `rejects a djb2 hash collision (${threw ? threw.constructor.name : "no throw"})`);
}
// Dest normalization: leading slashes stripped, backslashes folded to '/'.
{
  const img3 = new FrogFsImage();
  img3.addFile("/lead.txt", new Uint8Array([1]));
  img3.addFile("dir\\sub\\deep.bin", new Uint8Array([2, 3]));
  const paths = parseFrogfs(img3.build()).files.map((f) => f.path).sort();
  ok(JSON.stringify(paths) === JSON.stringify(["dir/sub/deep.bin", "lead.txt"]),
     `dest normalization: ${JSON.stringify(paths)}`);
}

if (fails) {
  console.error(`\nFrogFS validation FAILED (${fails})`);
  process.exit(1);
}
console.log(`\nFrogFS matches mkfrogfs.py everywhere it must \u2713 (${out.length} vs ${ref.length} bytes; differences are exactly the documented layout policy)`);
