// Validation for the FrogFS staging transforms (no hardware):
//   1. byteswap16 vs an independent Python reference (incl. odd/empty lengths)
//   2. predicate assertions for skip-by-extension, PICO-8 carts, MD detection,
//      .DS_Store discard
//   3. an end-to-end stageFrogfsTree() check
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  byteswap16,
  isMdRom,
  isPico8Cartridge,
  isDsStore,
  shouldSkipRomsFile,
  stageFrogfsTree,
} from "../dist/index.js";

let fails = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "OK  " : "FAIL"} ${msg}`);
  if (!cond) fails++;
};

// ── 1. byteswap16 vs Python oracle ───────────────────────────────────────────
const dir = fileURLToPath(new URL("./ref-staging/", import.meta.url));
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const fill = (n, seed) => {
  const b = new Uint8Array(n);
  let s = (seed * 2654435761) >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    b[i] = (s >>> 16) & 0xff;
  }
  return b;
};

const vectors = [fill(0, 1), fill(1, 2), fill(2, 3), fill(7, 4), fill(4096, 5), fill(4097, 6)];
const jsOut = vectors.map(byteswap16);
vectors.forEach((v, i) => writeFileSync(`${dir}in_${i}.bin`, v));

const py = spawnSync("python3", [fileURLToPath(new URL("./byteswap_oracle.py", import.meta.url)), dir.replace(/\/$/, "")], { encoding: "utf8" });
if (py.status !== 0) {
  process.stderr.write(py.stderr || "");
  console.error("byteswap oracle failed to run");
  process.exit(1);
}
console.log("byteswap16 vs Python reference:");
vectors.forEach((v, i) => {
  const ref = readFileSync(`${dir}out_${i}.bin`);
  const same = jsOut[i].length === ref.length && jsOut[i].every((b, j) => b === ref[j]);
  ok(same, `len ${v.length}`);
});

// ── 2. predicate assertions ──────────────────────────────────────────────────
console.log("predicates:");
ok(isMdRom("roms/md/sonic.md"), "isMdRom roms/md/sonic.md");
ok(!isMdRom("roms/nes/smb.nes"), "!isMdRom roms/nes/smb.nes");
ok(!isMdRom("roms/md/.DS_Store"), "!isMdRom roms/md/.DS_Store");
ok(!isMdRom("bios/md/x.md"), "!isMdRom bios/md/x.md (not roms)");

ok(shouldSkipRomsFile("roms/nes/box.png"), "skip roms/nes/box.png");
ok(shouldSkipRomsFile("roms/gb/scan.JPG"), "skip roms/gb/scan.JPG (case-insensitive)");
ok(!shouldSkipRomsFile("roms/nes/smb.nes"), "!skip roms/nes/smb.nes");
ok(shouldSkipRomsFile("covers/nes/box.png"), "skip covers/nes/box.png (not .img)");
ok(!shouldSkipRomsFile("covers/nes/box.img"), "!skip covers/nes/box.img (.img kept)");
ok(!shouldSkipRomsFile("roms/pico8/celeste.p8.png"), "!skip pico8 .p8.png cart");
ok(!shouldSkipRomsFile("roms/pico8/jelpi.png"), "!skip pico8 .png cart");

ok(isPico8Cartridge("roms/pico8/celeste.p8"), "pico8 .p8");
ok(isPico8Cartridge("roms/pico8/celeste.p8.png"), "pico8 .p8.png");
ok(!isPico8Cartridge("roms/nes/smb.nes"), "!pico8 nes");

ok(isDsStore("roms/nes/.DS_Store"), "isDsStore");
ok(!isDsStore("roms/nes/smb.nes"), "!isDsStore");

// ── 3. stageFrogfsTree end-to-end ────────────────────────────────────────────
console.log("stageFrogfsTree:");
const md = fill(8, 7);
const staged = stageFrogfsTree([
  { path: "roms/md/sonic.md", data: md },
  { path: "roms/nes/box.png", data: fill(10, 8) }, // skipped
  { path: "roms/nes/.DS_Store", data: fill(4, 9) }, // discarded
  { path: "roms/nes/smb.nes", data: fill(16, 10) }, // kept as-is
  { path: "roms/pico8/celeste.p8.png", data: fill(20, 11) }, // kept (cart)
]);
const byPath = Object.fromEntries(staged.map((f) => [f.path, f.data]));
ok(staged.length === 3, `kept 3 of 5 (got ${staged.length})`);
ok(!("roms/nes/box.png" in byPath), "png dropped");
ok(!("roms/nes/.DS_Store" in byPath), ".DS_Store dropped");
ok("roms/pico8/celeste.p8.png" in byPath, "pico8 cart kept");
const sw = byPath["roms/md/sonic.md"];
ok(sw && sw[0] === md[1] && sw[1] === md[0], "md rom byteswapped");

if (fails) {
  console.error(`\nstaging validation FAILED (${fails})`);
  process.exit(1);
}
console.log("\nstaging validation OK ✓");
