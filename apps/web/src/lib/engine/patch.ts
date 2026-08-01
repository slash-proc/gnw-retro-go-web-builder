// Firmware patcher: stock Mario/Zelda OFW → retro-go dual-boot, byte-exact.
// Runs entirely client-side (the ported engine + WASM liblzma).
import { patchFirmware, type PatchModel, type PatchResult } from "@gnw/gnw-patch";
import createLiblzma from "@gnw/gnw-patch/vendor/lzma-wasm/liblzma.mjs";
import wasmUrl from "@gnw/gnw-patch/vendor/lzma-wasm/liblzma.wasm?url";
// TWO variants per model, matching gnwmanager's binaries/<model>/{default,0x08032000}.*.
// Never mix them: 46-47 symbols differ between the tables (including `read_buttons`, which
// the patch emits a `bl` to), and `bootloader` resolves to the same ADDRESS in both while
// being a different IMPLEMENTATION. Selection is driven by `options.bootloader` below.
import symbolsMario from "@gnw/gnw-patch/vendor/symbols_mario.json";
import symbolsZelda from "@gnw/gnw-patch/vendor/symbols_zelda.json";
import symbolsMarioBoot from "@gnw/gnw-patch/vendor/symbols_mario_boot.json";
import symbolsZeldaBoot from "@gnw/gnw-patch/vendor/symbols_zelda_boot.json";
import novelMarioUrl from "@gnw/gnw-patch/vendor/novel_mario.bin?url";
import novelZeldaUrl from "@gnw/gnw-patch/vendor/novel_zelda.bin?url";
import novelMarioBootUrl from "@gnw/gnw-patch/vendor/novel_mario_boot.bin?url";
import novelZeldaBootUrl from "@gnw/gnw-patch/vendor/novel_zelda_boot.bin?url";

let compressFn: ((bytes: Uint8Array) => Uint8Array) | null = null;

/** Build the byte-exact liblzma compressor from the WASM module (cached). Also the
 *  `lzmaRaw` for FrogFS ROM `.lzma` sidecars (same `lzma_alone_compress`). */
export async function loadLiblzma(): Promise<(bytes: Uint8Array) => Uint8Array> {
  if (compressFn) return compressFn;
  const M = await createLiblzma({ locateFile: () => wasmUrl });
  compressFn = (bytes: Uint8Array): Uint8Array => {
    const inPtr = M._malloc(Math.max(1, bytes.length));
    M.HEAPU8.set(bytes, inPtr);
    const outPtrPtr = M._malloc(4);
    const outLen = M._lzma_alone_compress(inPtr, bytes.length, outPtrPtr);
    if (outLen < 0) {
      M._free(inPtr);
      M._free(outPtrPtr);
      throw new Error(`liblzma compress failed (${outLen})`);
    }
    const outPtr = M.getValue(outPtrPtr, "i32");
    const out = M.HEAPU8.slice(outPtr, outPtr + outLen);
    M._free(inPtr);
    M._free(outPtrPtr);
    M._free(outPtr);
    return out;
  };
  return compressFn;
}

/** Patch validated stock dumps. Returns the patched internal + external images. */
export async function patchModel(
  model: PatchModel,
  internal: Uint8Array,
  external: Uint8Array,
  options?: Record<string, unknown>,
): Promise<PatchResult> {
  const compress = await loadLiblzma();
  // Must track patchFirmware's own `options.bootloader` branch (which picks the extend
  // length) — the blob, the symbol table and the extend length are one matched set.
  const bootloader = options?.bootloader === true;
  const symbols = (
    model === "mario"
      ? bootloader ? symbolsMarioBoot : symbolsMario
      : bootloader ? symbolsZeldaBoot : symbolsZelda
  ) as Record<string, number>;
  const novelUrl =
    model === "mario"
      ? bootloader ? novelMarioBootUrl : novelMarioUrl
      : bootloader ? novelZeldaBootUrl : novelZeldaUrl;
  const novel = new Uint8Array(await (await fetch(novelUrl)).arrayBuffer());
  return patchFirmware({ model, internal, external, symbols, novel, compress, options });
}
