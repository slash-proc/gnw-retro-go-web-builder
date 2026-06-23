/**
 * L-PATCH — gnwmanager firmware patcher, ported to TS. Rewrites a stock
 * Mario/Zelda OFW backup into a dual-boot/retro-go build, byte-exact with the
 * Python reference (validated against an oracle). LZMA is injected and MUST be
 * byte-exact liblzma (the WASM build). See PLAN.md.
 */
import { MarioGnW, MARIO_CONFIG } from "./mario.js";
import { ZeldaGnW, ZELDA_CONFIG } from "./zelda.js";
import { sha1Hex } from "./sha1.js";
import type { CompressFn } from "./firmware.js";

export type { CompressFn } from "./firmware.js";
export { PatchError, NotEnoughSpaceError, InvalidStockRomError, MissingSymbolError } from "./firmware.js";
export { MARIO_CONFIG, ZELDA_CONFIG, sha1Hex };

export {
  patchSuperblock,
  locateSuperblock,
  readSuperblock,
  superblockCrcValid,
  crc32 as superblockCrc32,
  SuperblockError,
  GNW_LAYOUT_MAGIC,
  GNW_LAYOUT_VERSION,
  SUPERBLOCK_SIZE,
  FLAG_FROGFS_OFFSET,
  FLAG_EXTFLASH_SIZE,
  FLAG_RESERVED_OFFSET,
  FLAG_LITTLEFS_LENGTH,
  type SuperblockFields,
  type SuperblockPatch,
} from "./superblock.js";

export type PatchModel = "mario" | "zelda";

export interface PatchInput {
  model: PatchModel;
  internal: Uint8Array; // stock internal flash backup (128 KiB)
  external: Uint8Array; // stock external flash backup (encrypted)
  symbols: Record<string, number>; // ELF symbol → address for this model
  novel: Uint8Array; // novel-code payload (binaries/<model>/default.bin)
  compress: CompressFn; // byte-exact liblzma
  options?: Record<string, unknown>; // flash-patch flags (all off = standard)
}

export interface PatchResult {
  internal: Uint8Array; // patched internal image → flash to bank1
  external: Uint8Array; // patched external image → flash to bank0
  internalFree: number;
  compressedMemoryFree: number;
}

/** Apply a (standard, by default) patch and return the images to flash. */
export function patchFirmware(input: PatchInput): PatchResult {
  const cfg = input.model === "mario" ? MARIO_CONFIG : ZELDA_CONFIG;
  const Cls = input.model === "mario" ? MarioGnW : ZeldaGnW;

  const device = new Cls(cfg, input.internal, input.external, input.symbols, input.compress, sha1Hex);

  // _common_prepare (non-bootloader): decrypt ext, copy novel code, extend +128 KiB.
  device.crypt();
  const novelStart = cfg.int.STOCK_ROM_END;
  device.internal.buf.setSlice(novelStart, device.internal.length, input.novel.subarray(novelStart));
  device.internal.buf.extend(new Uint8Array(0x20000));

  device.args = { compression_ratio: 1.4, ...(input.options ?? {}) };
  const [internalFree, compressedMemoryFree] = device.run();

  return {
    internal: device.internal.toUint8Array(),
    external: device.external.toUint8Array(),
    internalFree,
    compressedMemoryFree,
  };
}
