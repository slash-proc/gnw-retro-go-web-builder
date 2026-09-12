// Validation for the layout-superblock host patcher (no hardware):
//   A. byte-exact vs superblock_oracle.py (Python zlib.crc32) across field combos
//   B. integration: locate + patch the REAL flash blob (build with the firmware
//      change), assert a single superblock + a valid CRC after patching.
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  patchSuperblock,
  locateSuperblock,
  readSuperblock,
  superblockCrcValid,
  superblockCrc32,
  assertSuperblockDeclaration,
  SUPPORTED_DECLARATION,
  GNW_LAYOUT_MAGIC,
  FLAG_FROGFS_OFFSET,
  FLAG_EXTFLASH_SIZE,
  FLAG_RESERVED_OFFSET,
  FLAG_LITTLEFS_LENGTH,
} from "../dist/index.js";

let fails = 0;
let skipped = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "OK  " : "FAIL"} ${msg}`);
  if (!cond) fails++;
};
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const dir = fileURLToPath(new URL("./ref/superblock/", import.meta.url));
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const oracle = fileURLToPath(new URL("./superblock_oracle.py", import.meta.url));

// ── build a synthetic image with one unpatched superblock embedded in noise ──
const MAGIC_BYTES = Uint8Array.of(0x47, 0x57, 0x4c, 0x42); // "GWLB"

function buildSynthetic() {
  const img = new Uint8Array(8192);
  let s = 0x12345678 >>> 0;
  for (let i = 0; i < img.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    img[i] = (s >>> 16) & 0xff;
  }
  const off = 0x800; // 4-aligned
  const dv = new DataView(img.buffer);
  dv.setUint32(off + 0x00, GNW_LAYOUT_MAGIC, true);
  dv.setUint16(off + 0x04, 2, true); // version
  dv.setUint16(off + 0x06, 36, true); // struct_size
  dv.setUint32(off + 0x08, 0, true); // frogfs_offset
  dv.setUint32(off + 0x0c, 0, true); // frogfs_length
  dv.setUint32(off + 0x10, 0, true); // extflash_size
  dv.setUint32(off + 0x14, 0, true); // reserved_offset
  dv.setUint32(off + 0x18, 0, true); // littlefs_length
  // flags: a bit the patcher never sets, so "existing flags are preserved" is a
  // real check. Seeding this with FLAG_FROGFS_OFFSET (as it once was) made the
  // fixture already satisfy what the patch does — dropping every `flags |=` for
  // that bit, or discarding the pre-existing flags word, both went unnoticed.
  dv.setUint32(off + 0x1c, 1 << 5, true); // flags
  dv.setUint32(off + 0x20, 0, true); // crc32 (unpatched)

  // Decoys the locator must ignore. Without them the 4-byte scan stride and the
  // version/struct_size validation are both unpinned.
  //   (a) magic on a NON-4-aligned boundary, otherwise a perfectly valid header
  const bad1 = 0x402 + 1; // 0x403: not 4-aligned
  img.set(MAGIC_BYTES, bad1);
  dv.setUint16(bad1 + 0x04, 2, true);
  dv.setUint16(bad1 + 0x06, 36, true);
  //   (b) 4-aligned magic with an out-of-range version
  img.set(MAGIC_BYTES, 0x1000);
  dv.setUint16(0x1000 + 0x04, 99, true);
  dv.setUint16(0x1000 + 0x06, 36, true);
  //   (c) 4-aligned magic with a too-small struct_size
  img.set(MAGIC_BYTES, 0x1400);
  dv.setUint16(0x1400 + 0x04, 2, true);
  dv.setUint16(0x1400 + 0x06, 4, true);
  return img;
}

const input = buildSynthetic();
writeFileSync(`${dir}in.bin`, input);

// ── A. byte-exact across field combinations ─────────────────────────────────
const cases = [
  { name: "offset_only", patch: { frogfsOffset: 0x100000 }, cli: ["--frogfs-offset", "0x100000"] },
  { name: "offset_len", patch: { frogfsOffset: 0x100000, frogfsLength: 231568 }, cli: ["--frogfs-offset", "0x100000", "--frogfs-length", "231568"] },
  { name: "all_fields", patch: { frogfsOffset: 0x400000, frogfsLength: 12345, extflashSize: 16 * 1024 * 1024, reservedOffset: 0x100000, littlefsLength: 8 * 1024 * 1024 },
    cli: ["--frogfs-offset", "0x400000", "--frogfs-length", "12345", "--extflash-size", String(16 * 1024 * 1024), "--reserved-offset", "0x100000", "--littlefs-length", String(8 * 1024 * 1024)] },
  { name: "zero_offset", patch: { frogfsOffset: 0 }, cli: ["--frogfs-offset", "0"] },
];

console.log("byte-exact vs superblock_oracle.py:");
for (const c of cases) {
  const tsOut = patchSuperblock(input, c.patch);
  const pyOutPath = `${dir}${c.name}_py.bin`;
  const py = spawnSync("python3", [oracle, `${dir}in.bin`, pyOutPath, ...c.cli], { encoding: "utf8" });
  if (py.status !== 0) {
    process.stderr.write(py.stderr || "");
    console.error(`oracle failed for ${c.name}`);
    process.exit(1);
  }
  const pyOut = new Uint8Array(readFileSync(pyOutPath));
  ok(eq(tsOut, pyOut), `${c.name} (TS == Python, ${tsOut.length} B)`);
  // round-trip decode + crc
  const f = readSuperblock(tsOut);
  ok(f.frogfsOffset === c.patch.frogfsOffset, `${c.name} frogfsOffset decoded`);
  ok(superblockCrcValid(tsOut), `${c.name} crc valid after patch`);
  // Every override flag the patch implies must be set, unrelated ones untouched,
  // and the pre-existing bit (1 << 5) preserved.
  let want = (1 << 5) | FLAG_FROGFS_OFFSET;
  if (c.patch.extflashSize !== undefined) want |= FLAG_EXTFLASH_SIZE;
  if (c.patch.reservedOffset !== undefined) want |= FLAG_RESERVED_OFFSET;
  if (c.patch.littlefsLength !== undefined) want |= FLAG_LITTLEFS_LENGTH;
  ok(f.flags === want, `${c.name} flags 0x${f.flags.toString(16)} == 0x${want.toString(16)}`);
  ok(f.frogfsLength === (c.patch.frogfsLength ?? 0), `${c.name} frogfsLength decoded`);
  ok(f.extflashSize === (c.patch.extflashSize ?? 0), `${c.name} extflashSize decoded`);
  ok(f.reservedOffset === (c.patch.reservedOffset ?? 0), `${c.name} reservedOffset decoded`);
  ok(f.littlefsLength === (c.patch.littlefsLength ?? 0), `${c.name} littlefsLength decoded`);
}

// the locator must find exactly the aligned, valid header — not the decoys
ok(locateSuperblock(input) === 0x800, "locates the real superblock, ignoring decoys");

// two valid superblocks must be rejected outright (it means a build bug), not
// silently resolved to the first hit
const twin = Uint8Array.from(input);
{
  const dv2 = new DataView(twin.buffer);
  twin.set(MAGIC_BYTES, 0x1800);
  dv2.setUint16(0x1800 + 0x04, 2, true);
  dv2.setUint16(0x1800 + 0x06, 36, true);
}
let twinThrew = false;
try { locateSuperblock(twin); } catch { twinThrew = true; }
ok(twinThrew, "rejects an image containing two valid superblocks");
// ...and the Python reference agrees (SystemExit -> non-zero exit)
writeFileSync(`${dir}twin.bin`, twin);
const pyTwin = spawnSync("python3", [oracle, `${dir}twin.bin`, `${dir}twin_out.bin`, "--frogfs-offset", "0x100000"], { encoding: "utf8" });
ok(pyTwin.status !== 0, "oracle also rejects the two-superblock image");

// alignment guard
let threw = false;
try { patchSuperblock(input, { frogfsOffset: 0x1234 }); } catch { threw = true; }
ok(threw, "rejects non-4KiB-aligned frogfsOffset");

// purity: patchSuperblock returns a copy and never edits its input
const before = Uint8Array.from(input);
patchSuperblock(input, { frogfsOffset: 0x100000 });
ok(eq(input, before), "patchSuperblock does not mutate its input");

// ── A2. manifest declaration assertion (firmware.superblock) ────────────────
// The manifest states {magic, version, structSize}. A mismatch with what THIS
// patcher writes is a refusal, never a best-effort patch: the field offsets would
// be wrong and the firmware would be silently corrupted.
console.log("manifest declaration assertion:");
const DECLARED = { magic: "GWLB", version: 2, structSize: 36 };

const threwWith = (fn) => {
  try { fn(); } catch (e) { return e; }
  return null;
};

// the declaration the real manifest publishes is exactly what we support
ok(
  SUPPORTED_DECLARATION.magic === DECLARED.magic &&
    SUPPORTED_DECLARATION.version === DECLARED.version &&
    SUPPORTED_DECLARATION.structSize === DECLARED.structSize,
  "SUPPORTED_DECLARATION matches the published firmware.superblock",
);
ok(threwWith(() => assertSuperblockDeclaration(DECLARED)) === null, "matching declaration is accepted");

// a matching declaration patches successfully AND byte-exactly — passing `declared`
// must not change a single output byte vs the same patch without it.
{
  const withDecl = patchSuperblock(input, { frogfsOffset: 0x100000, declared: DECLARED });
  const without = patchSuperblock(input, { frogfsOffset: 0x100000 });
  ok(eq(withDecl, without), "declared:{...} patches byte-identically to the undeclared patch");
  ok(superblockCrcValid(withDecl), "declared patch stays CRC-valid");
  ok(readSuperblock(withDecl).frogfsOffset === 0x100000, "declared patch wrote frogfsOffset");
}

for (const [name, decl] of [
  ["a bumped version", { ...DECLARED, version: 3 }],
  ["a differing structSize", { ...DECLARED, structSize: 40 }],
  ["a differing magic", { ...DECLARED, magic: "GWLC" }],
]) {
  const e = threwWith(() => patchSuperblock(input, { frogfsOffset: 0x100000, declared: decl }));
  ok(e !== null && e.name === "SuperblockError", `${name} refuses to patch (SuperblockError)`);
  const e2 = threwWith(() => assertSuperblockDeclaration(decl));
  ok(e2 !== null && e2.name === "SuperblockError", `${name} fails assertSuperblockDeclaration`);
}
// the refusal must name the offending field, not just "mismatch"
ok(
  /version/.test(String(threwWith(() => assertSuperblockDeclaration({ ...DECLARED, version: 3 })))),
  "version refusal names the version field",
);
ok(
  /structSize/.test(String(threwWith(() => assertSuperblockDeclaration({ ...DECLARED, structSize: 40 })))),
  "structSize refusal names the structSize field",
);
ok(
  /magic/.test(String(threwWith(() => assertSuperblockDeclaration({ ...DECLARED, magic: "GWLC" })))),
  "magic refusal names the magic field",
);

// zero candidates is an error, not a silent no-op
{
  const empty = new Uint8Array(4096); // no GWLB magic anywhere
  const e = threwWith(() => locateSuperblock(empty, DECLARED));
  ok(e !== null && e.name === "SuperblockError", "zero candidates is an error");
  const e2 = threwWith(() => patchSuperblock(empty, { frogfsOffset: 0, declared: DECLARED }));
  ok(e2 !== null && e2.name === "SuperblockError", "zero candidates refuses to patch");
}

// two plausible candidates (a decoy that survives the version/struct_size filter)
// is an error — never "take the first" or "take the last".
{
  const decoy = Uint8Array.from(input);
  const dv3 = new DataView(decoy.buffer);
  decoy.set(MAGIC_BYTES, 0x1c00);
  dv3.setUint16(0x1c00 + 0x04, 2, true);  // plausible version
  dv3.setUint16(0x1c00 + 0x06, 36, true); // plausible struct_size
  const e = threwWith(() => locateSuperblock(decoy, DECLARED));
  ok(e !== null && e.name === "SuperblockError", "two plausible candidates is an error");
  ok(/0x800/.test(String(e)) && /0x1c00/.test(String(e)), "the ambiguity error lists both offsets");
  const e2 = threwWith(() => patchSuperblock(decoy, { frogfsOffset: 0, declared: DECLARED }));
  ok(e2 !== null && e2.name === "SuperblockError", "two plausible candidates refuses to patch");
}

// the declaration also tightens the candidate filter: the version-99 and
// struct_size-4 decoys stay excluded, and the real one is still found.
ok(locateSuperblock(input, DECLARED) === 0x800, "declared locate still finds the real superblock");

// ── B. integration against the real built flash blob ────────────────────────
const realBlob = fileURLToPath(new URL("../../../blobs/gw_retro_go_intflash_flash_superblock.bin", import.meta.url));
console.log("real flash blob integration:");
if (existsSync(realBlob)) {
  const img = new Uint8Array(readFileSync(realBlob));
  const off = locateSuperblock(img); // throws if 0 or >1
  ok(true, `single superblock located @ 0x${off.toString(16)}`);
  const before = readSuperblock(img, off);
  ok(before.version === 2 && before.structSize === 36 && before.flags === 1, "unpatched fields (ver2/size36/flags1)");
  ok(!superblockCrcValid(img, off), "unpatched crc is invalid (firmware falls back to defaults)");
  const patched = patchSuperblock(img, { frogfsOffset: 0x100000, frogfsLength: 231568, extflashSize: 16 * 1024 * 1024, littlefsLength: 8 * 1024 * 1024 });
  ok(superblockCrcValid(patched), "crc valid after patching real blob");
  ok(readSuperblock(patched).frogfsOffset === 0x100000, "patched frogfsOffset reads back");
  ok(readSuperblock(patched).littlefsLength === 8 * 1024 * 1024, "patched littlefsLength reads back");
  // patching must touch only the 36-byte struct
  let diff = 0;
  for (let i = 0; i < img.length; i++) if (img[i] !== patched[i]) diff++;
  ok(diff > 0 && diff <= 36, `only the superblock changed (${diff} bytes differ)`);
} else {
  skipped++;
  console.log("  SKIP (no built blob at blobs/gw_retro_go_intflash_flash_superblock.bin)");
}

// sanity: our crc32 matches Python zlib on a sample
const sample = input.subarray(0x800, 0x800 + 0x1c);
const pz = spawnSync("python3", ["-c", `import sys,zlib;sys.stdout.write(str(zlib.crc32(sys.stdin.buffer.read())&0xffffffff))`], { input: Buffer.from(sample), encoding: "utf8" });
ok(superblockCrc32(sample) === Number(pz.stdout.trim()), "crc32 == Python zlib.crc32");

if (fails) {
  console.error(`\nsuperblock validation FAILED (${fails})`);
  process.exit(1);
}
console.log(
  skipped
    ? `\nsuperblock byte-exact OK ✓ — but ${skipped} section(s) SKIPPED, this is NOT full coverage`
    : "\nsuperblock byte-exact + integration OK ✓",
);
