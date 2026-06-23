// Firmware patcher: stock Mario/Zelda OFW → retro-go dual-boot, byte-exact.
// Runs entirely client-side (the ported engine + WASM liblzma).
import { patchFirmware, type PatchModel, type PatchResult } from "@gnw/gnw-patch";
import createLiblzma from "@gnw/gnw-patch/vendor/lzma-wasm/liblzma.mjs";
import wasmUrl from "@gnw/gnw-patch/vendor/lzma-wasm/liblzma.wasm?url";
import symbolsMario from "@gnw/gnw-patch/vendor/symbols_mario.json";
import symbolsZelda from "@gnw/gnw-patch/vendor/symbols_zelda.json";
import novelMarioUrl from "@gnw/gnw-patch/vendor/novel_mario.bin?url";
import novelZeldaUrl from "@gnw/gnw-patch/vendor/novel_zelda.bin?url";

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
  const symbols = (model === "mario" ? symbolsMario : symbolsZelda) as Record<string, number>;
  const novelUrl = model === "mario" ? novelMarioUrl : novelZeldaUrl;
  const novel = new Uint8Array(await (await fetch(novelUrl)).arrayBuffer());
  return patchFirmware({ model, internal, external, symbols, novel, compress, options });
}
