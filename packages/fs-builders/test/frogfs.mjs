// Byte-exact validation for the FrogFS image builder (no hardware):
//   1. write a deterministic staging tree to test/ref/tree/
//   2. build out.bin with FrogFsImage
//   3. run frogfs_oracle.py → ref.bin via retro-go's own mkfrogfs.py
//   4. assert out.bin is byte-identical to ref.bin
//
// Deterministic content (no randomness) so the image — and its crc32 footer —
// are reproducible across runs.
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { FrogFsImage } from "../dist/index.js";

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

// 4. byte-diff
const ref = readFileSync(refPath);
let ok = out.length === ref.length;
if (!ok) {
  console.error(`SIZE MISMATCH: out=${out.length} ref=${ref.length}`);
} else {
  for (let i = 0; i < ref.length; i++) {
    if (out[i] !== ref[i]) {
      ok = false;
      console.error(
        `BYTE MISMATCH at 0x${i.toString(16)}: out=0x${out[i].toString(16)} ref=0x${ref[i].toString(16)}`,
      );
      break;
    }
  }
}

if (!ok) {
  console.error("FrogFS byte-exact validation FAILED");
  process.exit(1);
}
console.log(`byte-exact vs mkfrogfs.py ✓ (${out.length} bytes identical)`);
