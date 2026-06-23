// Byte-exact validation for the ROM .lzma sidecar builder (no hardware):
//   A. payload bytes vs rom_lzma_oracle.py (Python liblzma) across every mode
//   B. packStagedRoms behavior (dedupe / skip / rename / md-byteswap / passthrough)
//
// The WASM liblzma compressor (same one the patcher uses) is INJECTED — the
// package itself stays dependency-free.
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import createLiblzma from "../../gnw-patch/vendor/lzma-wasm/liblzma.mjs";
import { compressPayloadLzma, packStagedRoms, byteswap16 } from "../dist/index.js";

const Module = await createLiblzma();
const lzmaRaw = (bytes) => {
  const inPtr = Module._malloc(Math.max(1, bytes.length));
  Module.HEAPU8.set(bytes, inPtr);
  const outPtrPtr = Module._malloc(4);
  const outLen = Module._lzma_alone_compress(inPtr, bytes.length, outPtrPtr);
  if (outLen < 0) throw new Error(`lzma_alone_compress failed: ${outLen}`);
  const outPtr = Module.getValue(outPtrPtr, "i32");
  const out = Module.HEAPU8.slice(outPtr, outPtr + outLen);
  Module._free(inPtr);
  Module._free(outPtrPtr);
  Module._free(outPtr);
  return out;
};

const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
let fails = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "OK  " : "FAIL"} ${msg}`);
  if (!cond) fails++;
};

// deterministic generators
const rnd = (n, seed) => {
  const b = new Uint8Array(n);
  let s = (seed * 2654435761) >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    b[i] = (s >>> 16) & 0xff;
  }
  return b;
};
const comp = (n) => {
  const b = new Uint8Array(n); // low-entropy → compresses well
  for (let i = 0; i < n; i++) b[i] = i % 16;
  return b;
};
const zeros = (n) => new Uint8Array(n);

// ── A. payload byte-diff vs oracle ───────────────────────────────────────────
const base = fileURLToPath(new URL("./ref-romlzma/", import.meta.url));
rmSync(base, { recursive: true, force: true });
mkdirSync(base + "in", { recursive: true });

const cases = [
  { name: "nes_small", mode: "nes", input: rnd(8000, 1) },
  { name: "nes_over", mode: "nes", input: zeros(0x60010 + 1) },
  { name: "pce_small", mode: "pce", input: rnd(6000, 2) },
  { name: "col_small", mode: "col", input: rnd(4000, 3) },
  { name: "col_over", mode: "col", input: zeros(60 * 1024 + 1) },
  { name: "gb_default", mode: "gb", input: rnd(40000, 4) },
  { name: "gb_speed", mode: "gb", input: rnd(60000, 5), gbSpeed: true },
  { name: "gb_speed_zeros", mode: "gb", input: zeros(40000), gbSpeed: true },
  { name: "sms_multi", mode: "sms_md", input: rnd(300000, 6) },
  { name: "md_byteswap", mode: "sms_md", input: rnd(200000, 7), byteswapMd: true },
  { name: "sms_no_swap", mode: "sms_md", input: rnd(200000, 7), byteswapMd: false },
];

for (const c of cases) writeFileSync(`${base}in/${c.name}.bin`, c.input);
writeFileSync(
  `${base}cases.json`,
  JSON.stringify(cases.map(({ name, mode, gbSpeed, byteswapMd }) => ({ name, mode, gbSpeed: !!gbSpeed, byteswapMd: !!byteswapMd }))),
);

const py = spawnSync("python3", [fileURLToPath(new URL("./rom_lzma_oracle.py", import.meta.url)), base.replace(/\/$/, "")], { encoding: "utf8" });
if (py.stdout) process.stdout.write(py.stdout);
if (py.status !== 0) {
  if (py.stderr) process.stderr.write(py.stderr);
  console.error("oracle failed");
  process.exit(1);
}

console.log("payload bytes vs Python oracle:");
for (const c of cases) {
  let raw = c.input;
  if (c.byteswapMd) raw = byteswap16(raw);
  const got = compressPayloadLzma(c.mode, raw, lzmaRaw, { compressGbSpeed: !!c.gbSpeed });
  const noneFile = `${base}out/${c.name}.none`;
  if (existsSync(noneFile)) {
    ok(got === null, `${c.name} → None (over cap)`);
  } else {
    const ref = new Uint8Array(readFileSync(`${base}out/${c.name}.bin`));
    ok(got !== null && eq(got, ref), `${c.name} (${c.mode}${c.gbSpeed ? " speed" : ""}${c.byteswapMd ? " md-swap" : ""}) ${ref.length}B`);
  }
}

// ── B. packStagedRoms behavior ───────────────────────────────────────────────
console.log("packStagedRoms:");
const md = comp(4000);
const tree = [
  { path: "roms/nes/a.nes", data: comp(20000) }, // compresses → sidecar
  { path: "roms/nes/big.nes", data: zeros(0x60010 + 1) }, // over cap → kept
  { path: "roms/nes/d.nes", data: comp(1000) }, // deduped away (sibling .lzma)
  { path: "roms/nes/d.lzma", data: rnd(50, 8) }, // pre-existing sidecar wins
  { path: "roms/md/b.md", data: md }, // byteswap + sms_md
  { path: "roms/snes/x.sfc", data: rnd(100, 9) }, // unknown mode → passthrough
  { path: "covers/nes/a.png", data: rnd(64, 10) }, // non-roms → passthrough
];
const res = packStagedRoms(tree, lzmaRaw);
const paths = new Set(res.files.map((f) => f.path));
const byPath = Object.fromEntries(res.files.map((f) => [f.path, f.data]));

ok(paths.has("roms/nes/a.lzma") && !paths.has("roms/nes/a.nes"), "a.nes → a.lzma");
ok(paths.has("roms/nes/big.nes") && !paths.has("roms/nes/big.lzma"), "big.nes kept (over cap)");
ok(!paths.has("roms/nes/d.nes") && paths.has("roms/nes/d.lzma"), "d.nes deduped, d.lzma kept");
ok(paths.has("roms/md/b.lzma") && !paths.has("roms/md/b.md"), "b.md → b.lzma");
ok(paths.has("roms/snes/x.sfc"), "unknown x.sfc passthrough");
ok(paths.has("covers/nes/a.png"), "non-roms a.png passthrough");
const expMd = compressPayloadLzma("sms_md", byteswap16(md), lzmaRaw);
ok(byPath["roms/md/b.lzma"] && eq(byPath["roms/md/b.lzma"], expMd), "b.lzma == sms_md(byteswap(b))");
ok(res.compressed === 2 && res.skipped === 1, `counts compressed=2 skipped=1 (got ${res.compressed}/${res.skipped})`);

if (fails) {
  console.error(`\nrom-lzma validation FAILED (${fails})`);
  process.exit(1);
}
console.log("\nrom-lzma byte-exact validation OK ✓");
