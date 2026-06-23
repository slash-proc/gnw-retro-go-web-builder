/**
 * L1 — SWD transport interface (WebUSB).
 *
 * One interface, two implementations (dapjs / webstlink). This is the only
 * USB-touching layer and the in-browser replacement for what gnwmanager uses
 * OpenOCD for: memory read/write + register access + halt/resume/reset over SWD.
 * See PLAN.md §"L1" and the project plan.
 *
 * Design: zero runtime dependencies. Each backend wraps an *injected* low-level
 * handle (a dapjs `CortexM` or a webstlink `Stlinkv2`) supplied by the caller,
 * which owns the library-specific connect/attach. That keeps this package pure
 * ESM the throwaway frontend can import directly with no bundler.
 *
 * halt/resume/reset are implemented against the generic ARMv7-M debug registers
 * (DHCSR/DEMCR/AIRCR) rather than either library's chip-aware helpers, so they
 * work on the STM32H7B0 even though neither library's device table lists it.
 */

/** Progress callback: bytes done out of total, called after each transfer chunk. */
export type ProgressFn = (done: number, total: number) => void;

export interface SwdTransport {
  connect(): Promise<void>; // navigator.usb.requestDevice gesture (caller-owned)
  readMemory(addr: number, len: number, onProgress?: ProgressFn): Promise<Uint8Array>;
  writeMemory(addr: number, data: Uint8Array, onProgress?: ProgressFn): Promise<void>;
  readWord(addr: number): Promise<number>;
  writeWord(addr: number, val: number): Promise<void>;
  halt(): Promise<void>;
  resume(): Promise<void>;
  reset(): Promise<void>; // reset + halt
  readRegister(name: string): Promise<number>;
  writeRegister(name: string, val: number): Promise<void>;
}

// --- ARMv7-M debug / reset control (memory-mapped, chip-agnostic) ----------
const DHCSR = 0xe000edf0; // Debug Halting Control and Status Register
const DEMCR = 0xe000edfc; // Debug Exception and Monitor Control Register
const AIRCR = 0xe000ed0c; // Application Interrupt and Reset Control Register

const DBGKEY = 0xa05f0000; // required in DHCSR[31:16] on write
const C_DEBUGEN = 1 << 0;
const C_HALT = 1 << 1;
const S_HALT = 1 << 17; // DHCSR status: core is halted

const VC_CORERESET = 1 << 0; // DEMCR: halt on reset vector
const AIRCR_VECTKEY = 0x05fa0000;
const SYSRESETREQ = 1 << 2;

const POLL_TRIES = 200; // each iteration is a USB round-trip (~ms)

/** ARM core register name → DCRSR selector number (shared by both backends). */
const REGISTERS: Record<string, number> = {
  r0: 0, r1: 1, r2: 2, r3: 3, r4: 4, r5: 5, r6: 6, r7: 7,
  r8: 8, r9: 9, r10: 10, r11: 11, r12: 12, r13: 13, r14: 14, r15: 15,
  sp: 13, lr: 14, pc: 15, xpsr: 16, msp: 17, psp: 18,
};

const assertWordAligned = (addr: number, len: number) => {
  if (addr % 4 || len % 4) {
    throw new Error(`[swd-transport] addr/len must be 4-byte aligned (addr=${addr}, len=${len})`);
  }
};

/**
 * Shared logic over the four primitives each backend provides:
 * readWord/writeWord and single-shot _readMemRaw/_writeMemRaw (≤ CHUNK bytes),
 * plus _readCoreReg/_writeCoreReg. Implements block chunking, register-name
 * mapping, and halt/resume/reset.
 */
abstract class BaseTransport implements SwdTransport {
  /** Max bytes per raw transfer; ST-Link/dapjs both stay safe at 1 KiB. */
  protected readonly CHUNK: number = 1024;

  abstract connect(): Promise<void>;
  abstract readWord(addr: number): Promise<number>;
  abstract writeWord(addr: number, val: number): Promise<void>;
  protected abstract _readMemRaw(addr: number, len: number): Promise<Uint8Array>;
  protected abstract _writeMemRaw(addr: number, data: Uint8Array): Promise<void>;
  protected abstract _readCoreReg(num: number): Promise<number>;
  protected abstract _writeCoreReg(num: number, val: number): Promise<void>;

  async readMemory(addr: number, len: number, onProgress?: ProgressFn): Promise<Uint8Array> {
    assertWordAligned(addr, len);
    const out = new Uint8Array(len);
    for (let off = 0; off < len; off += this.CHUNK) {
      const n = Math.min(this.CHUNK, len - off);
      out.set(await this._readMemRaw(addr + off, n), off);
      onProgress?.(off + n, len);
    }
    return out;
  }

  async writeMemory(addr: number, data: Uint8Array, onProgress?: ProgressFn): Promise<void> {
    assertWordAligned(addr, data.length);
    for (let off = 0; off < data.length; off += this.CHUNK) {
      const n = Math.min(this.CHUNK, data.length - off);
      await this._writeMemRaw(addr + off, data.subarray(off, off + n));
      onProgress?.(off + n, data.length);
    }
  }

  async readRegister(name: string): Promise<number> {
    const num = REGISTERS[name.toLowerCase()];
    if (num === undefined) throw new Error(`[swd-transport] unknown register "${name}"`);
    return (await this._readCoreReg(num)) >>> 0;
  }

  async writeRegister(name: string, val: number): Promise<void> {
    const num = REGISTERS[name.toLowerCase()];
    if (num === undefined) throw new Error(`[swd-transport] unknown register "${name}"`);
    await this._writeCoreReg(num, val >>> 0);
  }

  async halt(): Promise<void> {
    await this.writeWord(DHCSR, DBGKEY | C_DEBUGEN | C_HALT);
    for (let i = 0; i < POLL_TRIES; i++) {
      if ((await this.readWord(DHCSR)) & S_HALT) return;
    }
    throw new Error("[swd-transport] core did not halt (S_HALT never set)");
  }

  async resume(): Promise<void> {
    await this.writeWord(DHCSR, DBGKEY | C_DEBUGEN);
  }

  /** Reset and halt at the reset vector (DEMCR.VC_CORERESET + SYSRESETREQ). */
  async reset(): Promise<void> {
    await this.halt();
    await this.writeWord(DEMCR, VC_CORERESET);
    await this.writeWord(AIRCR, AIRCR_VECTKEY | SYSRESETREQ);
    let halted = false;
    for (let i = 0; i < POLL_TRIES; i++) {
      if ((await this.readWord(DHCSR)) & S_HALT) {
        halted = true;
        break;
      }
    }
    await this.writeWord(DEMCR, 0); // restore: stop catching the reset vector
    if (!halted) throw new Error("[swd-transport] core did not re-halt after reset");
  }
}

// Convert a 4-aligned Uint8Array to/from a little-endian Uint32Array view.
const u8ToU32LE = (data: Uint8Array): Uint32Array => {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = new Uint32Array(data.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = dv.getUint32(i * 4, true);
  return out;
};
const u32ToU8LE = (words: Uint32Array): Uint8Array => {
  const out = new Uint8Array(words.length * 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < words.length; i++) dv.setUint32(i * 4, words[i] >>> 0, true);
  return out;
};

/**
 * Minimal structural view of the dapjs `CortexM` methods we use, so this
 * package needs no dapjs dependency or type import.
 */
export interface CortexMLike {
  connect?(): Promise<void>;
  readMem32(addr: number): Promise<number>;
  writeMem32(addr: number, val: number): Promise<void>;
  readBlock?(addr: number, words: number): Promise<Uint32Array>;
  writeBlock?(addr: number, words: Uint32Array): Promise<void>;
  readCoreRegister(reg: number): Promise<number>;
  writeCoreRegister(reg: number, val: number): Promise<void>;
}

/** SwdTransport over an injected dapjs `CortexM` (CMSIS-DAP v2 over WebUSB). */
export class DapjsTransport extends BaseTransport {
  // NOTE: kept at the base 1 KiB. Larger blocks (tested at 16 KiB) corrupt
  // writes on at least some CMSIS-DAP probes (whole first block dropped), so
  // speeding this up needs a probe-safe approach, not a blind bump.
  constructor(private readonly cortexM: CortexMLike) {
    super();
  }

  async connect(): Promise<void> {
    await this.cortexM.connect?.();
  }

  async readWord(addr: number): Promise<number> {
    return (await this.cortexM.readMem32(addr)) >>> 0;
  }
  async writeWord(addr: number, val: number): Promise<void> {
    await this.cortexM.writeMem32(addr, val >>> 0);
  }

  protected async _readMemRaw(addr: number, len: number): Promise<Uint8Array> {
    if (typeof this.cortexM.readBlock === "function") {
      const words = await this.cortexM.readBlock(addr, len / 4);
      return u32ToU8LE(words);
    }
    const out = new Uint8Array(len);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < len; i += 4) dv.setUint32(i, (await this.cortexM.readMem32(addr + i)) >>> 0, true);
    return out;
  }

  protected async _writeMemRaw(addr: number, data: Uint8Array): Promise<void> {
    if (typeof this.cortexM.writeBlock === "function") {
      await this.cortexM.writeBlock(addr, u8ToU32LE(data));
      return;
    }
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < data.length; i += 4) await this.cortexM.writeMem32(addr + i, dv.getUint32(i, true) >>> 0);
  }

  protected async _readCoreReg(num: number): Promise<number> {
    return this.cortexM.readCoreRegister(num);
  }
  protected async _writeCoreReg(num: number, val: number): Promise<void> {
    await this.cortexM.writeCoreRegister(num, val);
  }
}

/**
 * Minimal structural view of the webstlink low-level `Stlinkv2` methods we use.
 * `get_*` return values come back as a DataView; `get_mem32` returns a DataView
 * over `size` bytes.
 */
export interface Stlinkv2Like {
  get_debugreg32(addr: number): Promise<number>;
  set_debugreg32(addr: number, data: number): Promise<unknown>;
  get_mem32(addr: number, size: number): Promise<DataView>;
  set_mem32(addr: number, data: Uint8Array): Promise<unknown>;
  get_reg(reg: number): Promise<number>;
  set_reg(reg: number, data: number): Promise<unknown>;
}

/** SwdTransport over an injected webstlink `Stlinkv2` (ST-Link v2 over WebUSB). */
export class WebStlinkTransport extends BaseTransport {
  // ST-Link's READMEM_32BIT caps a single transfer; stay conservative.
  protected readonly CHUNK: number = 1024;

  constructor(private readonly stlink: Stlinkv2Like) {
    super();
  }

  // The webstlink instance is attached by the caller before construction.
  async connect(): Promise<void> {}

  async readWord(addr: number): Promise<number> {
    return (await this.stlink.get_debugreg32(addr)) >>> 0;
  }
  async writeWord(addr: number, val: number): Promise<void> {
    await this.stlink.set_debugreg32(addr, val >>> 0);
  }

  protected async _readMemRaw(addr: number, len: number): Promise<Uint8Array> {
    const dv = await this.stlink.get_mem32(addr, len);
    return new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength).slice();
  }

  protected async _writeMemRaw(addr: number, data: Uint8Array): Promise<void> {
    // set_mem32 reads data.length; pass a tight copy to avoid subarray surprises.
    await this.stlink.set_mem32(addr, data.slice());
  }

  protected async _readCoreReg(num: number): Promise<number> {
    return this.stlink.get_reg(num);
  }
  protected async _writeCoreReg(num: number, val: number): Promise<void> {
    await this.stlink.set_reg(num, val);
  }
}
