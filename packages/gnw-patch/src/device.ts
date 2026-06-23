/**
 * Device — port of firmware.py's `Device`: holds the internal/external/free
 * firmwares, the shared relocation lookup, and the move/compress placement
 * machinery. Subclassed per model (mario.ts / zelda.ts).
 */
import {
  Firmware,
  IntFirmware,
  ExtFirmware,
  NotEnoughSpaceError,
  roundDownWord,
  roundUpWord,
  roundUpPage,
  packMetadata,
  type CompressFn,
  type IntConfig,
  type ExtConfig,
} from "./firmware.js";

class FreeFirmware extends Firmware {
  FLASH_BASE: number;
  constructor(len: number, base: number) {
    super(len);
    this.FLASH_BASE = base;
  }
}

export interface ModelConfig {
  name: "mario" | "zelda";
  int: IntConfig;
  ext: ExtConfig;
  freeMemory: { FLASH_BASE: number; FLASH_LEN: number };
}

export abstract class Device {
  internal: IntFirmware;
  external: ExtFirmware;
  compressedMemory: FreeFirmware;
  lookup = new Map<number, number>();
  compress: CompressFn;
  sha1: (d: Uint8Array) => string;
  args: Record<string, unknown> = {};

  extOffset = 0;
  intPos = 0;
  compressedMemoryPos = 0;
  private cmemMemo = new Map<string, number>();

  constructor(
    cfg: ModelConfig,
    internalBin: Uint8Array,
    externalBin: Uint8Array,
    symbols: Record<string, number>,
    compress: CompressFn,
    sha1: (d: Uint8Array) => string,
  ) {
    this.compress = compress;
    this.sha1 = sha1;
    this.internal = new IntFirmware(internalBin, cfg.int, symbols, sha1);
    this.external = new ExtFirmware(externalBin, cfg.ext, sha1);
    this.compressedMemory = new FreeFirmware(cfg.freeMemory.FLASH_LEN, cfg.freeMemory.FLASH_BASE);
    // Single shared lookup table across all three firmwares.
    this.internal.lookup = this.lookup;
    this.external.lookup = this.lookup;
    this.compressedMemory.lookup = this.lookup;
    // Inject the byte-exact liblzma into the compress patch op.
    this.internal.compressFn = compress;
    this.external.compressFn = compress;
    this.compressedMemory.compressFn = compress;
  }

  abstract patch(): [number, number];
  abstract get isMario(): boolean;
  abstract get isZelda(): boolean;

  // ---- cross-firmware move/copy ---------------------------------------------
  private moveCopy(dst: Firmware, dstOffset: number, src: Firmware, srcOffset: number, size: number, del: boolean) {
    dst.buf.setSlice(dstOffset, dstOffset + size, src.buf.getSlice(srcOffset, srcOffset + size));
    if (del) src.clearRange(srcOffset, srcOffset + size);
    for (let i = 0; i < size; i++) {
      this.lookup.set(src.FLASH_BASE + srcOffset + i, dst.FLASH_BASE + dstOffset + i);
    }
    return size;
  }
  private moveExtToInt(extOffset: number, intOffset: number, size: number) {
    return this.moveCopy(this.internal, intOffset, this.external, extOffset, size, true);
  }
  private moveToCompressedMemoryRaw(extOffset: number, cmOffset: number, size: number) {
    return this.moveCopy(this.compressedMemory, cmOffset, this.external, extOffset, size, true);
  }

  crypt(): void {
    this.external.crypt(this.internal.key, this.internal.nonce);
  }

  // ---- compressed-memory accounting -----------------------------------------
  compressedMemoryCompressedLen(addIndex = 0): number {
    const index = this.compressedMemoryPos + addIndex;
    if (!index) return 0;
    const data = this.compressedMemory.buf.getSlice(0, index);
    const key = this.sha1(data);
    const memo = this.cmemMemo.get(key);
    if (memo !== undefined) return memo;
    const len = this.compress(data).length;
    this.cmemMemo.set(key, len);
    return len;
  }
  get compressedMemoryFreeSpace(): number {
    return this.compressedMemory.length - this.compressedMemoryPos;
  }
  get intFreeSpace(): number {
    let out = this.internal.length - this.intPos - this.compressedMemoryCompressedLen();
    if (this.internal.rwdata !== null) out -= this.internal.rwdata.compressedLen(this.compress);
    return out;
  }

  rwdataLookup(lower: number, size: number): void {
    const rw = this.internal.rwdata!;
    const idx = this.internal.cfg.RWDATA_DTCM_IDX!;
    const arr = rw.get(idx);
    const lo = lower + this.external.FLASH_BASE;
    const hi = lo + size;
    for (let i = 0; i + 4 <= arr.length; i += 4) {
      const val = arr[i] + arr[i + 1] * 256 + arr[i + 2] * 65536 + arr[i + 3] * 16777216;
      if (val >= lo && val < hi) {
        const nv = this.lookup.get(val)!;
        arr[i] = nv & 0xff;
        arr[i + 1] = (nv >>> 8) & 0xff;
        arr[i + 2] = (nv >>> 16) & 0xff;
        arr[i + 3] = (nv >>> 24) & 0xff;
      }
    }
  }
  rwdataErase(lower: number, size: number): void {
    const rw = this.internal.rwdata!;
    const idx = this.internal.cfg.RWDATA_DTCM_IDX!;
    const arr = rw.get(idx);
    const lo = lower + 0x9000_0000;
    const hi = lo + size;
    for (let i = 0; i + 4 <= arr.length; i += 4) {
      const val = arr[i] + arr[i + 1] * 256 + arr[i + 2] * 65536 + arr[i + 3] * 16777216;
      if (val >= lo && val < hi) {
        arr[i] = arr[i + 1] = arr[i + 2] = arr[i + 3] = 0;
      }
    }
  }

  // ---- relocation entry points ----------------------------------------------
  moveToInt(ext: number | Uint8Array, size: number, reference: number | number[] | null): number {
    if (this.intFreeSpace < size) throw new NotEnoughSpaceError();
    const newLoc = this.intPos;
    if (ext instanceof Uint8Array) this.internal.buf.setSlice(this.intPos, this.intPos + size, ext);
    else this.moveExtToInt(ext, this.intPos, size);
    this.intPos += roundUpWord(size);
    if (reference !== null) this.internal.lookupRefs(reference);
    return newLoc;
  }
  moveExtExternal(ext: number | Uint8Array, size: number, reference: number | number[] | null): number {
    if (ext instanceof Uint8Array) {
      this.external.buf.setSlice(this.extOffset, this.extOffset + size, ext);
      if (reference !== null) this.internal.lookupRefs(reference);
      return this.extOffset; // (Python: ext + ext_offset, but ext is bytes → unused path)
    }
    this.external.move(ext, this.extOffset, size);
    if (reference !== null) this.internal.lookupRefs(reference);
    return ext + this.extOffset;
  }
  moveExt(ext: number | Uint8Array, size: number, reference: number | number[] | null): number {
    try {
      const newLoc = this.moveToInt(ext, size, reference);
      if (typeof ext === "number") this.extOffset -= roundDownWord(size);
      return newLoc;
    } catch (e) {
      if (!(e instanceof NotEnoughSpaceError)) throw e;
      return this.moveExtExternal(ext, size, reference);
    }
  }
  moveToCompressedMemory(ext: number, size: number, reference: number | number[] | null): number {
    const currentLen = this.compressedMemoryCompressedLen();
    try {
      this.compressedMemory.buf.setSlice(
        this.compressedMemoryPos,
        this.compressedMemoryPos + size,
        this.external.buf.getSlice(ext, ext + size),
      );
    } catch (e) {
      if (!(e instanceof NotEnoughSpaceError)) throw e;
      return this.moveExt(ext, size, reference);
    }
    const newLen = this.compressedMemoryCompressedLen(size);
    const diff = newLen - currentLen;
    const ratio = size / diff;
    if (diff > this.intFreeSpace) {
      this.compressedMemory.clearRange(this.compressedMemoryPos, this.compressedMemoryPos + size);
      return this.moveExtExternal(ext, size, reference);
    }
    if (ratio < (this.args.compression_ratio as number)) {
      this.compressedMemory.clearRange(this.compressedMemoryPos, this.compressedMemoryPos + size);
      return this.moveExt(ext, size, reference);
    }
    this.moveToCompressedMemoryRaw(ext, this.compressedMemoryPos, size);
    if (reference !== null) this.internal.lookupRefs(reference);
    const newLoc = this.compressedMemoryPos;
    this.compressedMemoryPos += roundUpWord(size);
    this.extOffset -= roundDownWord(size);
    return newLoc;
  }

  run(): [number, number] {
    this.intPos = this.internal.emptyOffset;
    const out = this.patch();
    const metadata = packMetadata(this.external.length, this.isMario, this.isZelda);
    this.internal.replace(0x01b8, metadata);
    return out;
  }
}

export { roundUpPage };
