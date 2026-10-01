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

/**
 * A BULK transfer's progress, reported to one process-wide observer regardless of whether the
 * caller passed an `onProgress` of its own.
 *
 * Why this exists at L1 rather than per-flow: the app wants one indicator covering EVERY read
 * and write, including the ones no flow reports (a scan, a log read, an lfs browse). Per-flow
 * reporting (`engine/flasher.ts`, `installProgress`) can only ever cover the flows that opted in.
 *
 * Why it costs nothing: `readMemory`/`writeMemory` already chunk and already compute
 * `(done, total)` for `onProgress`. This is the same arithmetic handed to a second listener --
 * a plain in-process call, no extra USB transaction. Adding per-chunk device traffic here would
 * repeat the read-back-verify regression documented in CLAUDE.md.
 *
 * Why only bulk: a bulk transfer is a unit of work with a KNOWN size; `readWord`/`writeWord` is
 * a poke with no total. That split is also exactly what excludes the liveness poll, which pings
 * with `readWord` alone (`engine/flasher.ts`'s `pingTarget`/`isStubAlive`) -- so the heartbeat
 * cannot move a bar that only bulk transfers feed.
 */
export type TransferEvent = { kind: "read" | "write"; done: number; total: number };
export type TransferObserver = (ev: TransferEvent) => void;

let transferObserver: TransferObserver | null = null;

/** Install (or clear, with `null`) the process-wide bulk-transfer observer. */
export function setTransferObserver(fn: TransferObserver | null): void {
  transferObserver = fn;
}

/** Never let a listener's throw break a device transfer. */
function emitTransfer(kind: "read" | "write", done: number, total: number): void {
  if (!transferObserver) return;
  try {
    transferObserver({ kind, done, total });
  } catch {
    /* an observer is a UI mirror; it must never fail a flash */
  }
}

/**
 * Is this error WebUSB telling us the USBDevice handle is gone?
 *
 * Chromium throws a DOMException named `InvalidStateError` with the message "The device must
 * be opened first" from `transferIn`/`transferOut`/`controlTransfer*` once the handle has been
 * closed -- either by us (`probe.dispose()`, see device.svelte.ts's `_teardownConnection`) or
 * by the probe re-enumerating. NOTHING re-opens a handle in that state: every subsequent
 * transfer through the same object throws the identical error forever.
 *
 * That makes it categorically NOT retryable. A retry loop that treats it as ordinary transport
 * flakiness spins its whole budget -- and, on the flash path, costs a device-resetting stub
 * reboot per attempt -- for a socket that can never answer. `FlashVerifyError.retryable` is the
 * same judgement made for a different reason (see gnw-flasher).
 *
 * Matched by name first, message second: `NotFoundError` ("The device was disconnected") is the
 * sibling Chromium raises when the device is physically gone, which is equally terminal for the
 * handle. Both are recovered from by re-attaching, never by trying again on the dead object.
 */
export function isDeadHandleError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = (e as { name?: unknown }).name;
  if (name === "InvalidStateError" || name === "NotFoundError") return true;
  const msg = (e as { message?: unknown }).message;
  return typeof msg === "string" && /must be opened first|device was disconnected/i.test(msg);
}

export interface SwdTransport {
  connect(): Promise<void>; // navigator.usb.requestDevice gesture (caller-owned)
  /** Change probe SWD clock for this live connection without changing user preferences. */
  setClockFrequency?(hz: number): Promise<void>;
  readMemory(addr: number, len: number, onProgress?: ProgressFn, reportProgress?: boolean, requestSize?: number): Promise<Uint8Array>;
  /** Optional one-off MEM-AP width probe used by locked-firmware diagnostics. */
  readMemoryUnitAtWidth?(addr: number, widthBytes: 1 | 2 | 4): Promise<number>;
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

// STM32H7B0-specific: BOTH firmwares we halt into run a hardware watchdog, refreshed only
// by their own main loop, that is NOT frozen by default when the core halts for debug —
// so ANY halt (e.g. a screenshot capture) that outlasts the watchdog's window resets the
// chip out from under us, independent of anything in the host-side transport/poll/retry
// logic. Freeze BOTH before halting:
//  - Retro-Go's application firmware: Window Watchdog WWDG1 (game-and-watch-retro-go-sd
//    Core/Src/main.c HAL_WWDG_Refresh; Prescaler=128, Counter=Window=127 → sub-second window).
//    DBGMCU.APB3FZ1 bit 6 (DBG_WWDG1).
//  - The gnwmanager RAM stub (the flash util itself): Independent Watchdog IWDG1
//    (references/gnwmanager Core/Src/main.c; Prescaler=4, Reload=Window=4095 on the ~32kHz
//    LSI → ~512ms window). DBGMCU.APB4FZ1 bit 18 (DBG_IWDG1).
const DBGMCU_APB3FZ1 = 0x5c001034;
const DBG_WWDG1 = 1 << 6;
const DBGMCU_APB4FZ1 = 0x5c001054;
const DBG_IWDG1 = 1 << 18;

// OpenOCD's target/stm32h7x.cfg sets CSW.HPROT[3] so MEM-AP accesses see the
// Cortex-M7 data cache. Without it, a successful read can return stale physical
// SRAM instead of the firmware bytes the CPU just copied there.
const CSW_HPROT_CACHEABLE = 1 << 27;

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
 * readWord/writeWord and single-shot _readMemRaw/_writeMemRaw (backend-sized blocks),
 * plus _readCoreReg/_writeCoreReg. Implements block chunking, register-name
 * mapping, and halt/resume/reset.
 */
abstract class BaseTransport implements SwdTransport {
  /** Default memory request size for ordinary reads. */
  protected readonly CHUNK: number = 1024;
  /** Larger reads are opt-in; the default remains the proven 1 KiB request size. */
  protected readonly MAX_READ_REQUEST: number = 1024;
  /** Inter-transfer pause used by probes that need settling time between reads. */
  protected readonly READ_INTER_CHUNK_DELAY_MS: number = 10;

  abstract connect(): Promise<void>;
  abstract readWord(addr: number): Promise<number>;
  abstract writeWord(addr: number, val: number): Promise<void>;
  protected abstract _readMemRaw(addr: number, len: number): Promise<Uint8Array>;
  protected abstract _writeMemRaw(addr: number, data: Uint8Array): Promise<void>;
  protected abstract _readCoreReg(num: number): Promise<number>;
  protected abstract _writeCoreReg(num: number, val: number): Promise<void>;

  // This is the underlying chunked-read PRIMITIVE (per-backend transfer-size cap +
  // pacing delay), not a duplicate of apps/web's engine/chunkedRead.ts or
  // screenshot.ts helpers — those build on top of readMemory, calling it with a
  // chosen chunk size. See docs/AUDIT_NOTES.md item #2.
  async readMemory(addr: number, len: number, onProgress?: ProgressFn, reportProgress = true, requestSize = this.CHUNK): Promise<Uint8Array> {
    assertWordAligned(addr, len);
    const out = new Uint8Array(len);
    const requestLimit = Math.min(Math.max(this.CHUNK, requestSize), this.MAX_READ_REQUEST);
    // Announce at 0 so the indicator appears when the transfer STARTS, not when its first
    // chunk lands -- a 16 MB read would otherwise show nothing for its first chunk's latency.
    if (reportProgress) emitTransfer("read", 0, len);
    let off = 0;
    while (off < len) {
      // Normal reads stay inside the probe's 1 KiB transfer boundary. A caller
      // may opt into larger, aligned requests for a DAP backend that packetizes
      // them internally (such as GnWManager's staged SRAM dump).
      const boundary = requestLimit <= 1024
        ? 1024 - ((addr + off) & 1023)
        : requestLimit - ((addr + off) % requestLimit);
      const n = Math.min(requestLimit, boundary, len - off);
      let chunk: Uint8Array | null = null;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const read = await this._readMemRaw(addr + off, n);
          if (read.byteLength !== n) {
            throw new Error(
              `Transfer count mismatch: SWD read at 0x${(addr + off).toString(16)} returned ${read.byteLength} of ${n} bytes`,
            );
          }
          chunk = read;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      if (!chunk) throw lastError instanceof Error ? lastError : new Error(String(lastError));
      out.set(chunk, off);
      onProgress?.(off + n, len);
      if (reportProgress) emitTransfer("read", off + n, len);
      if (len > this.CHUNK && this.READ_INTER_CHUNK_DELAY_MS > 0)
        await new Promise((r) => setTimeout(r, this.READ_INTER_CHUNK_DELAY_MS));
      off += n;
    }
    return out;
  }

  async writeMemory(addr: number, data: Uint8Array, onProgress?: ProgressFn): Promise<void> {
    assertWordAligned(addr, data.length);
    emitTransfer("write", 0, data.length);
    for (let off = 0; off < data.length; off += this.CHUNK) {
      const n = Math.min(this.CHUNK, data.length - off);
      await this._writeMemRaw(addr + off, data.subarray(off, off + n));
      onProgress?.(off + n, data.length);
      emitTransfer("write", off + n, data.length);
      if (data.length > this.CHUNK) await new Promise((r) => setTimeout(r, 10));
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
    // Freeze both watchdogs BEFORE halting — once the core is stopped it's too late; the
    // watchdogs are asynchronous hardware and don't wait for us. We don't know which
    // firmware is running (Retro-Go vs the gnwmanager stub), so freeze both unconditionally;
    // writing the freeze bit for a watchdog that isn't currently active is a harmless no-op.
    // Best-effort: if these writes fail we still attempt the halt (a hang is recoverable,
    // silently skipping the halt isn't).
    try {
      const fz3 = (await this.readWord(DBGMCU_APB3FZ1)) >>> 0;
      if (!(fz3 & DBG_WWDG1)) await this.writeWord(DBGMCU_APB3FZ1, fz3 | DBG_WWDG1);
      const fz4 = (await this.readWord(DBGMCU_APB4FZ1)) >>> 0;
      if (!(fz4 & DBG_IWDG1)) await this.writeWord(DBGMCU_APB4FZ1, fz4 | DBG_IWDG1);
    } catch {
      /* non-fatal — see comment above */
    }
    await this.writeWord(DHCSR, DBGKEY | C_DEBUGEN | C_HALT);
    for (let i = 0; i < POLL_TRIES; i++) {
      if ((await this.readWord(DHCSR)) & S_HALT) return;
    }
    throw new Error("[swd-transport] core did not halt (S_HALT never set)");
  }

  async resume(): Promise<void> {
    await this.writeWord(DHCSR, DBGKEY | C_DEBUGEN);
    // Unfreeze both watchdogs now that the core is running again — halt() froze them only
    // to survive the halted read; leaving them frozen after resume would silently disable a
    // real firmware safety net for the rest of the run.
    try {
      const fz3 = (await this.readWord(DBGMCU_APB3FZ1)) >>> 0;
      if (fz3 & DBG_WWDG1) await this.writeWord(DBGMCU_APB3FZ1, fz3 & ~DBG_WWDG1);
      const fz4 = (await this.readWord(DBGMCU_APB4FZ1)) >>> 0;
      if (fz4 & DBG_IWDG1) await this.writeWord(DBGMCU_APB4FZ1, fz4 & ~DBG_IWDG1);
    } catch {
      /* non-fatal */
    }
  }

  /** Reset and halt at the reset vector (DEMCR.VC_CORERESET + SYSRESETREQ). */
  async reset(): Promise<void> {
    await this.halt();
    // PyOCD preserves the existing DEMCR bits while arming vector catch.
    const demcrBefore = (await this.readWord(DEMCR)) >>> 0;
    await this.writeWord(DEMCR, demcrBefore | VC_CORERESET);
    // SYSRESETREQ can reset the target before the SWD write response is returned. PyOCD
    // explicitly treats that transfer fault as expected, flushes its DP queue, and proceeds
    // with reset recovery; propagating it makes a healthy reset look like a failed recovery.
    try {
      await this.writeWord(AIRCR, AIRCR_VECTKEY | SYSRESETREQ);
    } catch {
      /* expected when reset tears down the in-flight SWD transaction */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    let halted = false;
    for (let i = 0; i < POLL_TRIES; i++) {
      if ((await this.readWord(DHCSR)) & S_HALT) {
        halted = true;
        break;
      }
    }
    await this.writeWord(DEMCR, demcrBefore); // restore the caller's reset-catch state
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
  proxy?: {
    swjClock?(hz: number): Promise<void>;
    transfer?(port: number, mode: number, register: number, value: number): Promise<number>;
  };
  writeAPCommand?(register: number, value: number): unknown[];
  transferSequence?(commands: unknown[]): Promise<unknown>;
  readMem32(addr: number): Promise<number>;
  writeMem32(addr: number, val: number): Promise<void>;
  readBlock?(addr: number, words: number): Promise<Uint32Array>;
  writeBlock?(addr: number, words: Uint32Array): Promise<void>;
  readCoreRegister(reg: number): Promise<number>;
  writeCoreRegister(reg: number, val: number): Promise<void>;
}

/** SwdTransport over an injected dapjs `CortexM` (CMSIS-DAP v2 over WebUSB). */
export class DapjsTransport extends BaseTransport {
  // The exceptional 128 KiB SRAM dump is exposed as one request to DAPJS.
  // _readMemRaw still subdivides it into 1 KiB TAR-safe windows internally.
  protected readonly MAX_READ_REQUEST: number = 128 * 1024;
  // PyOCD-backed GnWManager reads do not add a host sleep per MEM-AP transfer.
  // Keep the 1 KiB TAR-safe windows, but avoid adding ~41 s of sleeps to a 4 MiB dump.
  protected readonly READ_INTER_CHUNK_DELAY_MS: number = 0;
  constructor(
    private readonly cortexM: CortexMLike,
    private readonly onDapReadDiagnostic?: (line: string) => void,
  ) {
    super();
    // DAPJS hardcodes 0x23000052 for both scalar and block memory accesses.
    // Apply the STM32H7 attribute before its CSW-value cache checks the command;
    // a one-time writeAP(CSW, ...) would be undone by the next memory operation.
    // This covers reads, writes, core-register access and diagnostic widths alike.
    if (cortexM.writeAPCommand) {
      const writeAPCommand = cortexM.writeAPCommand.bind(cortexM);
      cortexM.writeAPCommand = (register, value) => writeAPCommand(
        register,
        register === 0 ? (value | CSW_HPROT_CACHEABLE) >>> 0 : value,
      );
    }
    // Capture the actual CMSIS-DAP TransferBlock replies for the bad SRAM ranges.
    // This is intentionally routed to the app's debug sink rather than DevTools:
    // users can retrieve the evidence from Activity after the failed backup.
    const proxy = (cortexM as CortexMLike & {
      proxy?: {
        transport?: {
          read?: () => Promise<DataView>;
          write?: (data: Uint8Array) => Promise<void>;
        };
      };
    }).proxy;
    const usb = proxy?.transport;
    if (usb?.read) {
      if (usb.write) {
        const write = usb.write.bind(usb);
        usb.write = async (data) => {
          const request = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          const context = this.dapDiagnosticRead;
          const scalarAddress = this.dapDiagnosticScalarAddress;
          if (scalarAddress !== null && request[0] === 5) {
            const raw = Array.from(request, (b) => b.toString(16).padStart(2, "0")).join("");
            this.onDapReadDiagnostic?.(`[dap-scalar-tx] addr=0x${scalarAddress.toString(16)} raw=${raw}`);
          }
          if (context && context.enabled && request[0] === 5) {
            const transferCount = request[2];
            const requestView = new DataView(request.buffer, request.byteOffset, request.byteLength);
            for (let i = 0; i < transferCount; i++) {
              const offset = 3 + i * 5;
              const transfer = request[offset];
              const port = transfer & 1;
              const read = (transfer & 2) !== 0;
              const register = transfer & 12;
              if (port !== 1 || read || (register !== 0 && register !== 4)) continue;
              const value = requestView.getUint32(offset + 1, true);
              if (register === 0 || value >= 0x24000000 && value < 0x24020000) {
                this.onDapReadDiagnostic?.(
                  `[dap-tx] ap=${register === 0 ? "CSW" : "TAR"} value=0x${value.toString(16).padStart(8, "0")}`,
                );
              }
            }
          } else if (context && context.enabled && request[0] === 6 && request.byteLength >= 5) {
            const words = request[2] | (request[3] << 8);
            const packetAddress = context.addr + context.blockOffset;
            const packetEnd = packetAddress + words * 4;
            const overlapsFirstMismatch = packetAddress < 0x240000a0 && packetEnd > 0x24000080;
            const overlapsBadTail = packetAddress < 0x24020000 && packetEnd > 0x2401f000;
            if (overlapsFirstMismatch || overlapsBadTail) {
              this.onDapReadDiagnostic?.(
                `[dap-tx] addr=0x${packetAddress.toString(16)} words=${words} request=0x${request[4].toString(16).padStart(2, "0")}`,
              );
            }
          }
          await write(data);
        };
      }
      const read = usb.read.bind(usb);
      usb.read = async () => {
        const view = await read();
        const context = this.dapDiagnosticRead;
        const scalarAddress = this.dapDiagnosticScalarAddress;
        const viewBytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        if (scalarAddress !== null && viewBytes[0] === 5) {
          const raw = Array.from(viewBytes, (b) => b.toString(16).padStart(2, "0")).join("");
          this.onDapReadDiagnostic?.(`[dap-scalar-rx] addr=0x${scalarAddress.toString(16)} raw=${raw}`);
        }
        if (context && viewBytes[0] === 6 && viewBytes.byteLength >= 4) {
          const response = new DataView(view.buffer, view.byteOffset, view.byteLength);
          const words = response.getUint16(1, true);
          const packetAddress = context.addr + context.blockOffset;
          const packetEnd = packetAddress + words * 4;
          const overlapsFirstMismatch = packetAddress < 0x240000a0 && packetEnd > 0x24000080;
          const overlapsBadTail = packetAddress < 0x24020000 && packetEnd > 0x2401f000;
          if (context.enabled && this.onDapReadDiagnostic && (overlapsFirstMismatch || overlapsBadTail)) {
            const raw = Array.from(viewBytes, (b) => b.toString(16).padStart(2, "0")).join("");
            this.onDapReadDiagnostic(
              `[dap-rx] addr=0x${packetAddress.toString(16)} words=${words} status=0x${response.getUint8(3).toString(16)} ` +
              `view=${view.byteOffset}+${view.byteLength}/${view.buffer.byteLength} raw=${raw}`,
            );
          }
          context.blockOffset += words * 4;
        }
        // DAPJS 2.3 decodes DAP_TRANSFER_BLOCK payloads with
        // `result.buffer.slice(4, ...)`, which assumes byteOffset is zero.
        // WebUSB returns a DataView; make its visible bytes a tight buffer before
        // DAPJS sees it so a non-zero view offset cannot shift/corrupt the dump.
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
        return new DataView(bytes.buffer);
      };
    }
  }

  async setClockFrequency(hz: number): Promise<void> {
    const swjClock = this.cortexM.proxy?.swjClock;
    if (!swjClock) throw new Error("This CMSIS-DAP probe cannot change SWD clock while connected.");
    await swjClock.call(this.cortexM.proxy, hz);
  }

  private dapDiagnosticRead: { addr: number; blockOffset: number; enabled: boolean } | null = null;
  private dapDiagnosticScalarAddress: number | null = null;
  private dapDiagnosticCaptured = false;

  async connect(): Promise<void> {
    await this.cortexM.connect?.();
  }

  private async transferWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await fn(); } catch (e) {
        last = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (!/Transfer count mismatch|Transfer response FAULT/i.test(msg) || attempt === 2) throw e;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    throw last;
  }

  async readWord(addr: number): Promise<number> {
    const scalarDiagnostic = addr === 0x24000080 || addr === 0x2401f000 || addr === 0x2401f310 || addr === 0x2401fff0;
    const previousAddress = this.dapDiagnosticScalarAddress;
    if (scalarDiagnostic) this.dapDiagnosticScalarAddress = addr;
    try {
      return (await this.cortexM.readMem32(addr)) >>> 0;
    } finally {
      this.dapDiagnosticScalarAddress = previousAddress;
    }
  }

  /** Read one diagnostic unit with an explicit MEM-AP access width. */
  async readMemoryUnitAtWidth(addr: number, widthBytes: 1 | 2 | 4): Promise<number> {
    const adi = this.cortexM;
    const dap = this.cortexM.proxy;
    if (!adi.writeAPCommand || !adi.transferSequence || !dap?.transfer) {
      throw new Error("DAPJS MEM-AP diagnostic methods are unavailable");
    }
    const sizeBits = widthBytes === 1 ? 0 : widthBytes === 2 ? 1 : 2;
    // Match DAPJS readBlock's single-increment CSW, changing only SIZE.
    const csw = (0x23000050 | sizeBits) >>> 0;
    await adi.transferSequence([
      ...adi.writeAPCommand(0, csw),
      ...adi.writeAPCommand(4, addr >>> 0),
    ]);
    return (await dap.transfer(1, 2, 12, 0)) >>> 0;
  }
  async writeWord(addr: number, val: number): Promise<void> {
    await this.cortexM.writeMem32(addr, val >>> 0);
  }

  protected async _readMemRaw(addr: number, len: number): Promise<Uint8Array> {
    if (typeof this.cortexM.readBlock === "function") {
      const capture = addr === 0x24000000 && len === 128 * 1024 && !this.dapDiagnosticCaptured;
      if (capture) this.dapDiagnosticCaptured = true;
      const out = new Uint8Array(len);
      for (let off = 0; off < len;) {
        // DAPJS does not safely advance the MEM-AP TAR across its 1 KiB wrap
        // boundary. Keep each raw block inside that window, even when the caller
        // requested a larger staged SRAM dump.
        const n = Math.min(1024 - ((addr + off) & 1023), len - off);
        const previous = this.dapDiagnosticRead;
        this.dapDiagnosticRead = {
          addr: addr + off,
          blockOffset: 0,
          enabled: capture,
        };
        try {
          const words = await this.transferWithRetry(() => this.cortexM.readBlock!(addr + off, n / 4));
          if (words.length !== n / 4) {
            throw new Error(`Transfer count mismatch: DAP block read at 0x${(addr + off).toString(16)} returned ${words.length * 4} of ${n} bytes`);
          }
          out.set(u32ToU8LE(words), off);
        } finally {
          this.dapDiagnosticRead = previous;
        }
        off += n;
        // Large caller requests (notably the 128 KiB locked-firmware SRAM dump)
        // are split here into MEM-AP-safe windows. Preserve the same probe settling
        // cadence as BaseTransport.readMemory(), which applies this delay between
        // its ordinary 1 KiB reads to avoid saturating the probe.
        if (off < len) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return out;
    }
    const out = new Uint8Array(len);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < len; i += 4) dv.setUint32(i, (await this.cortexM.readMem32(addr + i)) >>> 0, true);
    return out;
  }

  protected async _writeMemRaw(addr: number, data: Uint8Array): Promise<void> {
    if (typeof this.cortexM.writeBlock === "function") {
      await this.transferWithRetry(() => this.cortexM.writeBlock!(addr, u8ToU32LE(data)));
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
  set_swd_freq?(hz: number): Promise<unknown>;
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

  async setClockFrequency(hz: number): Promise<void> {
    if (!this.stlink.set_swd_freq) throw new Error("This ST-Link cannot change SWD clock while connected.");
    await this.stlink.set_swd_freq(hz);
  }

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
