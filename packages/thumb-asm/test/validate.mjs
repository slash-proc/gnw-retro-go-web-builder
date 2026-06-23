// Byte-exact validation of the in-house Thumb-2 assembler.
//
//   Oracle A: the upstream pure-Python thumb_asm (keystone-validated) — drive
//             both it and our JS over an exhaustive input set; require identical
//             output (and identical accept/reject) for every input.
//   Oracle B: keystone's own cached output (keystone_cache.json from the v0.22.1
//             tag) — the exact instructions Mario/Zelda emit, encoded by real
//             keystone. Require our JS to reproduce all of them.
//
// Green on both ⟹ we match keystone with zero runtime dependency on it or the
// cache. Run inside the dev container (needs python3 + git): `npm test`.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assemble, iterModifiedImmediates, ThumbAssemblyError } from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const SUBMODULE = path.join(REPO, "references/gnwmanager");

let failures = 0;
const fail = (msg) => {
  failures++;
  if (failures <= 40) console.error("  ✗ " + msg);
};

// Try JS assemble; return array-of-bytes on success or null on (expected) reject.
function jsTry(code, addr) {
  try {
    return [...assemble(code, addr)];
  } catch (e) {
    if (e instanceof ThumbAssemblyError) return null;
    throw e;
  }
}

const eqBytes = (a, b) =>
  a === null || b === null ? a === b : a.length === b.length && a.every((x, i) => x === b[i]);

// ---- Build the Oracle A input set -------------------------------------------
function buildInputs() {
  const inputs = [];
  const add = (code, addr = 0) => inputs.push([code, addr]);

  // Modified-immediate forms across every representable constant.
  for (const v of iterModifiedImmediates()) {
    add(`mov.w r3, #${v}`);
    add(`add.w r2, r1, #${v}`);
    add(`sub.w r1, r8, #${v}`);
  }
  // A few constants that are NOT representable → both must reject.
  for (const v of [0x101, 0x2724, 0x12345, 0xabcdef]) add(`mov.w r3, #${v}`);

  // movw: full 16-bit immediate range across several destinations.
  for (const rd of ["r0", "r2", "r3", "r7", "r12"]) {
    for (let im = 0; im <= 0xffff; im++) add(`movw ${rd}, #${im}`);
  }
  add("movw r2, #0x10000"); // out of range → reject

  // mov (register), all pairs.
  for (let d = 0; d < 16; d++) for (let m = 0; m < 16; m++) add(`mov r${d}, r${m}`);

  // sub sp, #imm (multiples of 4) plus a couple invalid.
  for (let im = 0; im <= 0x1fc; im += 4) add(`sub sp, #${im}`);
  add("sub sp, #6");
  add("sub sp, #0x200");

  // ldr.w Rt, [pc, #imm] across signed offsets.
  for (let off = -0xfff; off <= 0xfff; off += 7) add(`ldr.w r0, [pc, #${off}]`);

  // b (narrow) and b.w (wide) across a range of (addr, target) → offsets.
  for (const addr of [0, 0x100, 0x08000000, 0x08018240]) {
    for (const off of [-0x400, -0x100, -4, 0, 4, 0x100, 0x3ff].map((o) => o * 2)) {
      add(`b 0x${(addr + 4 + off).toString(16)}`, addr);
    }
    for (const off of [-0x1000, -0x20, 0, 0x10, 0x1000, 0x100000].map((o) => o * 2)) {
      add(`b.w #0x${(addr + 4 + off).toString(16)}`, addr);
    }
  }
  add("b 0x4000", 0); // narrow out of range → reject

  // IT blocks: every condition × every t/e pattern.
  const conds = ["eq", "ne", "cs", "cc", "mi", "pl", "vs", "vc", "hi", "ls", "ge", "lt", "gt", "le"];
  for (const c of conds) {
    for (const suffix of ["", "t", "e", "tt", "te", "et", "ee", "ttt", "tte", " tet".trim()]) {
      add(`it${suffix} ${c}`);
    }
  }

  // The exact multi-instruction forms the patches emit.
  add("ite ne; movne.w r4, #0x1000; moveq.w r4, #0x0");
  add("ite ne; movne.w r4, #0xff000; moveq.w r4, #0xfe000");
  return inputs;
}

// ---- Oracle A: compare against upstream Python ------------------------------
function oracleA() {
  const inputs = buildInputs();
  console.log(`Oracle A: ${inputs.length} inputs vs upstream Python thumb_asm…`);
  const py = execFileSync("python3", [path.join(__dirname, "oracle.py")], {
    input: JSON.stringify(inputs),
    maxBuffer: 256 * 1024 * 1024,
  });
  const expected = JSON.parse(py.toString());

  let checked = 0;
  for (const [code, addr, want] of expected) {
    const got = jsTry(code, addr);
    if (!eqBytes(got, want)) {
      fail(`[A] "${code}" @0x${addr.toString(16)} : js=${JSON.stringify(got)} py=${JSON.stringify(want)}`);
    }
    checked++;
  }
  console.log(`  ${checked} compared.`);
}

// ---- Oracle B: keystone_cache.json from the v0.22.1 tag ----------------------
function oracleB() {
  const raw = execFileSync(
    "git",
    // safe.directory: the repo is host-owned but git runs as root in the container.
    ["-C", SUBMODULE, "-c", "safe.directory=*", "show", "v0.22.1:gnwmanager/cli/gnw_patch/keystone_cache.json"],
    { maxBuffer: 64 * 1024 * 1024 },
  ).toString();
  const cache = JSON.parse(raw);
  const keys = Object.keys(cache);
  console.log(`Oracle B: ${keys.length} keystone cache entries…`);

  // Key form: "('asm string',){}"  or  "('asm string', 134280240){}"
  const KEY_RE = /^\('(.*)',(?: (\d+))?\)\{\}$/;
  let checked = 0;
  for (const key of keys) {
    const m = key.match(KEY_RE);
    if (!m) {
      fail(`[B] unparseable cache key: ${key}`);
      continue;
    }
    const code = m[1];
    const addr = m[2] ? Number(m[2]) : 0;
    const want = cache[key];
    const got = jsTry(code, addr);
    if (!eqBytes(got, want)) {
      fail(`[B] "${code}" @0x${addr.toString(16)} : js=${JSON.stringify(got)} ks=${JSON.stringify(want)}`);
    }
    checked++;
  }
  console.log(`  ${checked} compared.`);
}

oracleA();
oracleB();

if (failures) {
  console.error(`\nFAILED: ${failures} mismatch(es).`);
  process.exit(1);
}
console.log("\nAll byte-exact. ✓");
