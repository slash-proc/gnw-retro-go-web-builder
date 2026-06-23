/**
 * Firmware-rewrite engine — a 1:1 port of gnwmanager's cli/gnw_patch/firmware.py
 * + patch.py. Byte-exact with the Python reference (validated against an oracle).
 *
 * LZMA is injected (`CompressFn`) and MUST be byte-exact liblzma (the WASM build),
 * because relocation/layout decisions depend on exact compressed lengths.
 */
import { lz77Decompress } from "./lz77.js";
import { aes128Encryptor } from "./aes.js";
import { assemble } from "@gnw/thumb-asm";

/** Byte-exact liblzma compressor (raw LZMA1, preset 6, 16 KiB dict, header stripped). */
export type CompressFn = (data: Uint8Array) => Uint8Array;

export class PatchError extends Error {}
export class NotEnoughSpaceError extends PatchError {}
export class InvalidStockRomError extends PatchError {}
export class MissingSymbolError extends PatchError {}
export class ParsingError extends PatchError {}

// ---- little-endian int helpers ----------------------------------------------
function toBytesLE(value: number, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let v = value;
  for (let i = 0; i < size; i++) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

// ---- utils.py ---------------------------------------------------------------
export const roundDownWord = (v: number) => Math.floor(v / 4) * 4;
export const roundUpWord = (v: number) => Math.ceil(v / 4) * 4;
export const roundUpPage = (v: number) => Math.ceil(v / 4096) * 4096;
export const secondsToFrames = (s: number) => Math.round(60 * s);

type Lookup = Map<number, number>;

/**
 * Growable byte buffer with the slice-assignment semantics the patcher relies on
 * (Python bytearray): replacing a slice with data of a different length resizes.
 */
class ByteBuf {
  private buf: Uint8Array;
  len: number;

  constructor(init: Uint8Array | number) {
    if (typeof init === "number") {
      this.buf = new Uint8Array(init);
      this.len = init;
    } else {
      this.buf = init.slice();
      this.len = init.length;
    }
  }
  get length() {
    return this.len;
  }
  private ensure(cap: number) {
    if (cap <= this.buf.length) return;
    let n = this.buf.length || 1;
    while (n < cap) n *= 2;
    const grown = new Uint8Array(n);
    grown.set(this.buf.subarray(0, this.len));
    this.buf = grown;
  }
  u8(i: number): number {
    if (i < 0) i += this.len;
    if (i < 0 || i >= this.len) throw new RangeError(`index ${i} out of range`);
    return this.buf[i];
  }
  setU8(i: number, v: number): void {
    if (i < 0) i += this.len;
    if (i < 0 || i >= this.len) throw new RangeError(`index ${i} out of range`);
    this.buf[i] = v & 0xff;
  }
  /** Copy of [start,end). Negatives wrap; defaults are full range. */
  getSlice(start?: number, end?: number): Uint8Array {
    let s = start ?? 0;
    let e = end ?? this.len;
    if (s < 0) s += this.len;
    if (e < 0) e += this.len;
    s = Math.max(0, Math.min(s, this.len));
    e = Math.max(s, Math.min(e, this.len));
    return this.buf.slice(s, e);
  }
  /** Replace [start,end) with data (may resize, like bytearray slice assignment). */
  setSlice(start: number | undefined, end: number | undefined, data: Uint8Array): void {
    let s = start ?? 0;
    let e = end ?? this.len;
    if (s < 0) s += this.len;
    if (e < 0) e += this.len;
    if (s < 0 || s > this.len) throw new NotEnoughSpaceError(`start ${s} exceeds length ${this.len}`);
    if (e > this.len) throw new NotEnoughSpaceError(`end ${e} exceeds length ${this.len}`);
    if (e < s) e = s;
    const removed = e - s;
    if (data.length === removed) {
      this.buf.set(data, s);
      return;
    }
    // splice: tail shifts by (data.length - removed)
    const newLen = this.len - removed + data.length;
    const tail = this.buf.slice(e, this.len);
    this.ensure(newLen);
    this.buf.set(data, s);
    this.buf.set(tail, s + data.length);
    this.len = newLen;
  }
  extend(data: Uint8Array): void {
    this.ensure(this.len + data.length);
    this.buf.set(data, this.len);
    this.len += data.length;
  }
  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

// ---- HeaderMetaData (firmware.py) -------------------------------------------
const METADATA_MAGIC = 0x4;
export function packMetadata(externalFlashSize: number, isMario: boolean, isZelda: boolean): Uint8Array {
  const blocks4k = roundUpPage(externalFlashSize) >> 12;
  if (!(blocks4k >= 0 && blocks4k < 1 << 24)) throw new PatchError("external_flash_size too large");
  const flags = METADATA_MAGIC | ((isMario ? 1 : 0) << 4) | ((isZelda ? 1 : 0) << 5);
  return toBytesLE((blocks4k & 0xffffff) | (flags * (1 << 24)), 4);
}

/** Base firmware: a byte buffer + FLASH_BASE, the relocation lookup, and all patch ops. */
export abstract class Firmware {
  buf: ByteBuf;
  lookup: Lookup; // shared device lookup (Device wires this)
  compressFn?: CompressFn; // byte-exact liblzma (Device wires this)
  abstract FLASH_BASE: number;

  constructor(data: Uint8Array | number) {
    this.buf = new ByteBuf(data);
    this.lookup = new Map();
    this.verify();
  }
  protected verify(): void {}

  get length() {
    return this.buf.length;
  }
  toUint8Array() {
    return this.buf.toUint8Array();
  }

  // Subclasses with a symbol table override this.
  address(_symbol: string, _subBase = false): number {
    throw new MissingSymbolError("no symbol table on this firmware");
  }

  int(offset: number, size = 4): number {
    const b = this.buf.getSlice(offset, offset + size);
    let v = 0;
    for (let i = 0; i < size; i++) v += b[i] * 256 ** i;
    return v;
  }
  setRange(start: number, end: number, val: Uint8Array): number {
    // self[start:end] = val * (end-start)  (val is a single byte pattern)
    const n = end - start;
    const filled = new Uint8Array(n);
    if (val.length === 1) filled.fill(val[0]);
    else for (let i = 0; i < n; i++) filled[i] = val[i % val.length];
    this.buf.setSlice(start, end, filled);
    return n;
  }
  clearRange(start: number, end: number): number {
    return this.setRange(start, end, new Uint8Array([0]));
  }

  // ---- patch ops (patch.py FirmwarePatchMixin) ------------------------------
  replace(offset: number, data: Uint8Array | string | number, size?: number): number {
    if (offset >= this.length) throw new RangeError(`Patch offset ${offset} exceeds length ${this.length}`);
    if (data instanceof Uint8Array) {
      this.buf.setSlice(offset, offset + data.length, data);
      return data.length;
    }
    if (typeof data === "string") {
      if (size) throw new PatchError("Don't specify size with a symbol name.");
      const addr = this.address(data);
      this.buf.setSlice(offset, offset + 4, toBytesLE(addr, 4));
      return 4;
    }
    if (size === undefined) throw new PatchError('Must specify "size" with int data');
    if (![1, 2, 4].includes(size)) throw new PatchError(`Size must be 1, 2, or 4; got ${size}`);
    this.buf.setSlice(offset, offset + size, toBytesLE(data, size));
    return size;
  }
  relative(offset: number, data: string | number, size?: number): number {
    const src = this.FLASH_BASE + offset;
    let dst: number;
    if (typeof data === "string") {
      if (size) throw new PatchError("Don't specify size with a symbol name.");
      dst = this.address(data);
    } else {
      if (size === undefined) throw new PatchError('Must specify "size" with int data.');
      let d = data;
      if (d < this.FLASH_BASE) d += this.FLASH_BASE;
      dst = d;
    }
    let rel = dst - src;
    if (rel < 0) rel += 0x1_0000_0000;
    return this.replace(offset, rel, 4);
  }
  b(offset: number, data: number): number {
    const pc = offset + 4;
    let jump = data - pc;
    if (Math.abs(jump) > 2 * (1 << 10)) throw new PatchError(`Too large of a jump ${jump}`);
    jump >>= 1;
    jump = jump >= 0 ? jump : (1 << 11) + jump;
    const byte0 = 0b1110_0000 | ((jump >> 8) & 0x7);
    const byte1 = jump & 0xff;
    this.buf.setU8(offset, byte1);
    this.buf.setU8(offset + 1, byte0);
    return 2;
  }
  bl(offset: number, data: string | number): number {
    const dstAddress = typeof data === "string" ? this.address(data) : this.FLASH_BASE + data;
    const pc = this.FLASH_BASE + offset + 4;
    const jump = dstAddress - pc;
    if (Math.abs(jump) > 4 * (1 << 20)) throw new PatchError(`Too large of a jump ${jump}`);
    let s1 = jump >> 12;
    s1 = s1 >= 0 ? s1 : (1 << 11) + s1;
    const s1b0 = 0b1111_0000 | ((s1 >> 8) & 0x7);
    const s1b1 = s1 & 0xff;
    const s2 = (jump - (s1 << 12)) >> 1;
    if (s2 >> 11) throw new PatchError(`bl jump 0x${jump.toString(16)} too large!`);
    const s2b0 = 0b1111_1000 | ((s2 >> 8) & 0x7);
    const s2b1 = s2 & 0xff;
    this.buf.setU8(offset, s1b1);
    this.buf.setU8(offset + 1, s1b0);
    this.buf.setU8(offset + 2, s2b1);
    this.buf.setU8(offset + 3, s2b0);
    return 4;
  }
  asm(offset: number, data: string, size?: number): number {
    const text = data.trim();
    const enc = text.startsWith("b.w") ? assemble(text, this.FLASH_BASE + offset) : assemble(text);
    if (size && enc.length !== size) throw new PatchError(`asm size mismatch: ${enc.length} != ${size}`);
    for (let i = 0; i < enc.length; i++) this.buf.setU8(offset + i, enc[i]);
    return enc.length;
  }
  nop(offset: number, count: number): number {
    const size = count * 2;
    const pat = new Uint8Array(size);
    for (let i = 0; i < count; i++) {
      pat[i * 2] = 0x00;
      pat[i * 2 + 1] = 0xbf;
    }
    this.buf.setSlice(offset, offset + size, pat);
    return size;
  }
  bkpt(offset: number, size = 2): number {
    if (size % 2) throw new PatchError("breakpoint size must be even");
    const pat = new Uint8Array(size);
    for (let i = 0; i < size / 2; i++) {
      pat[i * 2] = 0x00;
      pat[i * 2 + 1] = 0xbe;
    }
    this.buf.setSlice(offset, offset + size, pat);
    return size;
  }
  private moveCopy(offset: number, data: number, size: number, del: boolean): number {
    const oldStart = offset;
    const oldEnd = oldStart + size;
    const newStart = offset + data;
    const newEnd = newStart + size;
    this.buf.setSlice(newStart, newEnd, this.buf.getSlice(oldStart, oldEnd));
    if (del) {
      if (data < 0) {
        if (newEnd > offset) this.clearRange(newEnd, oldEnd);
        else this.clearRange(oldStart, oldEnd);
      } else {
        if (newStart < oldEnd) this.clearRange(oldStart, newStart);
        else this.clearRange(oldStart, oldEnd);
      }
    }
    for (let i = 0; i < size; i++) {
      this.lookup.set(this.FLASH_BASE + oldStart + i, this.FLASH_BASE + newStart + i);
    }
    return size;
  }
  move(offset: number, data: number, size: number): number {
    return this.moveCopy(offset, data, size, true);
  }
  copy(offset: number, data: number, size: number): number {
    return this.moveCopy(offset, data, size, false);
  }
  add(offset: number, data: number, size = 4): number {
    const val = this.int(offset, size) + data;
    this.buf.setSlice(offset, offset + size, toBytesLE(val % 0x1_0000_0000, size));
    return size;
  }
  compress(offset: number, size: number): number {
    const data = this.buf.getSlice(offset, offset + size);
    const c = this.compressFn!(data);
    this.clearRange(offset, offset + size);
    this.buf.setSlice(offset, offset + c.length, c);
    return c.length;
  }
  lookupRefs(offsets: number | number[]): void {
    const list = Array.isArray(offsets) ? offsets : [offsets];
    for (const offset of list) {
      const val = this.int(offset, 4);
      const nv = this.lookup.get(val);
      if (nv === undefined) throw new PatchError(`0x${val.toString(16)} at offset 0x${offset.toString(16)}`);
      this.buf.setSlice(offset, offset + 4, toBytesLE(nv, 4));
    }
  }
}

// ---- RWData (firmware.py) ---------------------------------------------------
export class RWData {
  firmware: IntFirmware;
  tableStart: number;
  datas: Uint8Array[] = [];
  dsts: number[] = [];
  lastFn = 0;
  static MAX_TABLE_ELEMENTS = 5;

  constructor(firmware: IntFirmware, tableStart: number, tableLen: number) {
    this.firmware = firmware;
    this.tableStart = tableStart;
    for (let base = tableStart; base < tableStart + tableLen - 4; base += 16) {
      let i = base;
      let relOffsetToFn = firmware.int(i);
      if (relOffsetToFn > 0x8000_0000) relOffsetToFn -= 0x1_0000_0000;
      i += 4;
      const dataAddr = i + firmware.int(i);
      i += 4;
      const dataLen = firmware.int(i) >> 1;
      i += 4;
      const dataDst = firmware.int(i);
      i += 4;
      const data = lz77Decompress(firmware.buf.getSlice(dataAddr, dataAddr + dataLen));
      firmware.clearRange(dataAddr, dataAddr + dataLen);
      this.append(data, dataDst);
    }
    const lastElementOffset = tableStart + tableLen - 4;
    let lastFn = firmware.int(lastElementOffset);
    if (lastFn > 0x8000_0000) lastFn -= 0x1_0000_0000;
    lastFn += lastElementOffset;
    this.lastFn = lastFn;
    firmware.setRange(tableStart, tableStart + 16 * RWData.MAX_TABLE_ELEMENTS + 4, new Uint8Array([0x77]));
  }
  get(k: number): Uint8Array {
    return this.datas[k];
  }
  setData(k: number, d: Uint8Array): void {
    this.datas[k] = d;
  }
  get tableEnd(): number {
    return this.tableStart + 4 * 4 * this.datas.length + 4 + 4;
  }
  append(data: Uint8Array, dst: number): void {
    if (this.datas.length >= RWData.MAX_TABLE_ELEMENTS) throw new NotEnoughSpaceError("MAX_TABLE_ELEMENTS exceeded");
    this.datas.push(data);
    this.dsts.push(dst);
  }
  compressedLen(compress: CompressFn): number {
    let total = 0;
    for (const d of this.datas) total += compress(d).length;
    return total;
  }
  writeTableAndData(endOfTableReference: number, dataOffset: number, compress: CompressFn): number {
    const dataAddrs: number[] = [];
    const dataLens: number[] = [];
    let index = dataOffset;
    let totalLen = 0;
    for (const d of this.datas) {
      const c = compress(d);
      this.firmware.buf.setSlice(index, index + c.length, c);
      dataAddrs.push(index);
      dataLens.push(c.length);
      index += c.length;
      totalLen += c.length;
    }
    index = this.tableStart;
    for (let k = 0; k < dataAddrs.length; k++) {
      this.firmware.relative(index, "rwdata_inflate");
      index += 4;
      let relAddr = dataAddrs[k] - index;
      if (relAddr < 0) relAddr += 0x1_0000_0000;
      this.firmware.replace(index, relAddr, 4);
      index += 4;
      this.firmware.replace(index, dataLens[k], 4);
      index += 4;
      this.firmware.replace(index, this.dsts[k], 4);
      index += 4;
    }
    this.firmware.relative(index, "bss_rwdata_init");
    index += 4;
    this.firmware.relative(index, this.lastFn, 4);
    index += 4;
    this.firmware.relative(endOfTableReference, index, 4);
    return totalLen;
  }
}

// ---- Int/Ext firmware -------------------------------------------------------
export interface IntConfig {
  FLASH_BASE: number;
  FLASH_LEN: number;
  STOCK_ROM_SHA1: string;
  STOCK_ROM_END: number;
  KEY_OFFSET: number;
  NONCE_OFFSET: number;
  RWDATA_OFFSET: number | null;
  RWDATA_LEN: number;
  RWDATA_DTCM_IDX: number | null;
  RWDATA_ITCM_IDX?: number | null;
}

export class IntFirmware extends Firmware {
  cfg: IntConfig;
  symbols: Record<string, number>;
  sha1: (d: Uint8Array) => string;
  rwdata: RWData | null = null;
  FLASH_BASE: number;

  constructor(data: Uint8Array, cfg: IntConfig, symbols: Record<string, number>, sha1: (d: Uint8Array) => string) {
    // verify() needs cfg/sha1 — stash before super (TS: set via globals trick not allowed; verify after).
    super(data);
    this.cfg = cfg;
    this.symbols = symbols;
    this.sha1 = sha1;
    this.FLASH_BASE = cfg.FLASH_BASE;
    // Re-run verification now that cfg/sha1 are available.
    if (this.sha1(this.toUint8Array()) !== cfg.STOCK_ROM_SHA1) throw new InvalidStockRomError();
    this.rwdata = cfg.RWDATA_OFFSET === null ? null : new RWData(this, cfg.RWDATA_OFFSET, cfg.RWDATA_LEN);
  }
  address(symbol: string, subBase = false): number {
    const a = this.symbols[symbol];
    if (a === undefined || a === 0) throw new MissingSymbolError(`Cannot find symbol "${symbol}"`);
    return subBase ? a - this.FLASH_BASE : a;
  }
  get emptyOffset(): number {
    const searchStart = this.rwdata === null ? this.cfg.STOCK_ROM_END : this.rwdata.tableEnd;
    for (let addr = searchStart; addr < this.cfg.FLASH_LEN; addr += 0x10) {
      const chunk = this.buf.getSlice(addr, addr + 256);
      if (chunk.length === 256 && chunk.every((x) => x === 0)) return addr;
    }
    throw new ParsingError("Couldn't find end of internal code.");
  }
  get key(): Uint8Array {
    return this.buf.getSlice(this.cfg.KEY_OFFSET, this.cfg.KEY_OFFSET + 16);
  }
  get nonce(): Uint8Array {
    return this.buf.getSlice(this.cfg.NONCE_OFFSET, this.cfg.NONCE_OFFSET + 8);
  }
}

function nonceToIv(nonce: Uint8Array): Uint8Array {
  const rev = nonce.slice().reverse();
  const iv = new Uint8Array(16);
  iv.set(rev, 0); // 8 bytes
  iv.set([0x00, 0x00, 0x71, 0x23, 0x20, 0x00, 0x00, 0x00], 8);
  return iv;
}

export interface ExtConfig {
  STOCK_ROM_SHA1: string;
  ENC_START: number;
  ENC_END: number;
  verifySlice: (len: number, encStart: number, encEnd: number) => [number, number]; // [start,end] of hashed region
}

export class ExtFirmware extends Firmware {
  cfg: ExtConfig;
  sha1: (d: Uint8Array) => string;
  ENC_START: number;
  ENC_END: number;
  FLASH_BASE = 0x9000_0000;

  constructor(data: Uint8Array, cfg: ExtConfig, sha1: (d: Uint8Array) => string) {
    super(data);
    this.cfg = cfg;
    this.sha1 = sha1;
    this.ENC_START = cfg.ENC_START;
    this.ENC_END = cfg.ENC_END;
    const [s, e] = cfg.verifySlice(this.length, cfg.ENC_START, cfg.ENC_END);
    if (this.sha1(this.buf.getSlice(s, e)) !== cfg.STOCK_ROM_SHA1) throw new InvalidStockRomError();
  }
  crypt(key: Uint8Array, nonce: Uint8Array): void {
    const keyR = key.slice().reverse();
    const iv = nonceToIv(nonce);
    const encrypt = aes128Encryptor(keyR);
    const block = new Uint8Array(16);
    for (let offset = this.ENC_START; offset < this.ENC_END; offset += 16) {
      block.set(iv);
      const counter = (this.FLASH_BASE + offset) >>> 4;
      block[12] = (((counter >>> 24) & 0x0f) | (block[12] & 0xf0)) & 0xff;
      block[13] = (counter >>> 16) & 0xff;
      block[14] = (counter >>> 8) & 0xff;
      block[15] = counter & 0xff;
      const cipher = encrypt(block);
      for (let i = 0; i < 16; i++) {
        this.buf.setU8(offset + i, this.buf.u8(offset + i) ^ cipher[15 - i]);
      }
    }
  }
  shorten(data: number): number {
    let d = Math.abs(data);
    if (d === 0) return 0;
    this.ENC_END -= d;
    if (this.ENC_END < this.ENC_START) this.ENC_END = this.ENC_START;
    if (this.length === d) this.buf.setSlice(0, this.length, new Uint8Array(0));
    else this.buf.setSlice(0, this.length, this.buf.getSlice(0, this.length - d));
    return d;
  }
}
