// Validate the TS patch engine against the Python oracle: run a standard patch
// on the real backups with the byte-exact WASM liblzma and require the patched
// internal + external images to match the reference SHA-1s exactly.
//   node packages/gnw-patch/test/engine.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchFirmware } from "../dist/index.js";
import createLiblzma from "../vendor/lzma-wasm/liblzma.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../..");
const sha1 = (b) => createHash("sha1").update(b).digest("hex");

const Module = await createLiblzma();
function compress(bytes) {
  const inPtr = Module._malloc(Math.max(1, bytes.length));
  Module.HEAPU8.set(bytes, inPtr);
  const outPtrPtr = Module._malloc(4);
  const outLen = Module._lzma_alone_compress(inPtr, bytes.length, outPtrPtr);
  if (outLen < 0) throw new Error(`lzma failed ${outLen}`);
  const outPtr = Module.getValue(outPtrPtr, "i32");
  const out = Module.HEAPU8.slice(outPtr, outPtr + outLen);
  Module._free(inPtr);
  Module._free(outPtrPtr);
  Module._free(outPtr);
  return out;
}

// BOTH variants: "" = standard (default.bin/elf, +128 KiB), "_boot" = dual-boot
// (0x08032000.bin/elf, +73728 -> 200 KiB, leaving 0x08032000 free for the SD bootloader).
// The bootloader case is the one that shipped broken — it was built from the DEFAULT blob
// and symbol table (46-47 addresses differ, incl. read_buttons) and extended to 256 KiB.
let failed = 0;
for (const model of ["mario", "zelda"]) {
  for (const [suffix, bootloader] of [["", false], ["_boot", true]]) {
  const vendor = path.join(REPO, "packages/gnw-patch/vendor");
  const key = `${model}${suffix}`;
  const ref = JSON.parse(readFileSync(path.join(here, `ref/${key}_summary.json`)));
  const input = {
    model,
    internal: new Uint8Array(readFileSync(path.join(REPO, `backup/internal_flash_backup_${model}.bin`))),
    external: new Uint8Array(readFileSync(path.join(REPO, `backup/flash_backup_${model}.bin`))),
    symbols: JSON.parse(readFileSync(path.join(vendor, `symbols_${model}${suffix}.json`))),
    novel: new Uint8Array(readFileSync(path.join(vendor, `novel_${model}${suffix}.bin`))),
    compress,
    options: bootloader ? { bootloader: true } : undefined,
  };
  const t0 = Date.now();
  let res;
  try {
    res = patchFirmware(input);
  } catch (e) {
    console.error(`${key}: ENGINE THREW: ${e.message}`);
    failed++;
    continue;
  }
  const intOk = sha1(res.internal) === ref.internal_sha1 && res.internal.length === ref.internal_len;
  const extOk = sha1(res.external) === ref.external_sha1 && res.external.length === ref.external_len;
  const freeOk = res.internalFree === ref.internal_free && res.compressedMemoryFree === ref.compressed_memory_free;
  console.log(
    `${key}: internal ${intOk ? "OK" : "MISMATCH"} (len ${res.internal.length}/${ref.internal_len}, free ${res.internalFree}/${ref.internal_free}) | ` +
      `external ${extOk ? "OK" : "MISMATCH"} (len ${res.external.length}/${ref.external_len}) | ` +
      `cmemFree ${res.compressedMemoryFree}/${ref.compressed_memory_free} | ${Date.now() - t0}ms`,
  );
  if (!intOk || !extOk || !freeOk) failed++;
  }
}

if (failed) {
  console.error(`\nFAILED: ${failed} case(s) did not match the reference.`);
  process.exit(1);
}
console.log("\nAll patched images byte-exact vs oracle. ✓");
