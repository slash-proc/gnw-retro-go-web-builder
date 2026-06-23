// Verify the WASM liblzma reproduces Python liblzma 5.4.1 byte-for-byte across
// every compression vector the patch oracle captured. Run in the dev container:
//   node packages/gnw-patch/wasm/validate.mjs
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import createLiblzma from "../vendor/lzma-wasm/liblzma.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const VEC = path.resolve(here, "../test/ref/vectors");

const Module = await createLiblzma();

function compress(bytes) {
  const inPtr = Module._malloc(Math.max(1, bytes.length));
  Module.HEAPU8.set(bytes, inPtr);
  const outPtrPtr = Module._malloc(4);
  const outLen = Module._lzma_alone_compress(inPtr, bytes.length, outPtrPtr);
  if (outLen < 0) {
    Module._free(inPtr);
    Module._free(outPtrPtr);
    throw new Error(`lzma_alone_compress failed: ${outLen}`);
  }
  const outPtr = Module.getValue(outPtrPtr, "i32");
  const out = Module.HEAPU8.slice(outPtr, outPtr + outLen);
  Module._free(inPtr);
  Module._free(outPtrPtr);
  Module._free(outPtr);
  return out;
}

const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const ins = readdirSync(VEC).filter((f) => f.endsWith(".in"));
let pass = 0;
let fail = 0;
for (const f of ins) {
  const input = readFileSync(path.join(VEC, f));
  const expected = readFileSync(path.join(VEC, f.replace(/\.in$/, ".out")));
  const got = compress(new Uint8Array(input));
  if (eq(got, new Uint8Array(expected))) {
    pass++;
  } else {
    fail++;
    if (fail <= 10) console.error(`  ✗ ${f}: in=${input.length} got=${got.length} want=${expected.length}`);
  }
}

console.log(`liblzma WASM vs Python liblzma 5.4.1: ${pass}/${ins.length} vectors byte-exact`);
if (fail) {
  console.error(`FAILED: ${fail} mismatch(es).`);
  process.exit(1);
}
console.log("All byte-exact. ✓");
