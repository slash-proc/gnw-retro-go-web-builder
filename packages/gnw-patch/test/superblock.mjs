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
  GNW_LAYOUT_MAGIC,
} from "../dist/index.js";

let fails = 0;
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
  dv.setUint32(off + 0x1c, 1, true); // flags
  dv.setUint32(off + 0x20, 0, true); // crc32 (unpatched)
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
}

// alignment guard
let threw = false;
try { patchSuperblock(input, { frogfsOffset: 0x1234 }); } catch { threw = true; }
ok(threw, "rejects non-4KiB-aligned frogfsOffset");

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
console.log("\nsuperblock byte-exact + integration OK ✓");
