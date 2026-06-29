/**
 * L2 — gnwmanager-in-JS (mailbox protocol).
 *
 * Direct JS port of the gnwmanager host protocol (gnw.py / status.py). Reuses
 * the *unmodified* device blob `firmware.bin` (the on-device RAM flash util),
 * vendored from gnwmanager 0.22.1 (Apache-2.0) — see blobs/PROVENANCE.md. The
 * host side is just memory read/write + register write + halt/resume over an
 * SwdTransport, exactly what gnwmanager drives OpenOCD to do. See PLAN.md §"L2".
 *
 * This milestone implements `startStub` + `info` (the `gnwmanager info` path);
 * the flashing / SD / dump ops remain stubs for a later phase.
 */

import type { SwdTransport } from "@gnw/swd-transport";

/** Memory-mapped mailbox base — gnwmanager gnw.py. */
export const MAILBOX_ADDR = 0x24025800;

/** Load address for the RAM flash util (gnw.py: write_memory(0x240E6800, fw)). */
export const FW_LOAD_ADDR = 0x240e6800;

/** Internal flash bank 1 — readable only when the device is unlocked. */
const INTFLASH_BANK1_ADDR = 0x08000000;

/** bank → memory-mapped base address (gnw.py). 0=ext, 1=bank1, 2=bank2. */
export const BANK_BASE: Record<number, number> = {
  0: 0x90000000,
  1: 0x08000000,
  2: 0x08100000,
};

/** Mailbox global-area field offsets from MAILBOX_ADDR (gnw.py _populate_comm). */
const Field = {
  STATUS: 0x00,
  STATUS_OVERRIDE: 0x04,
  UTC_TIMESTAMP: 0x08, // host writes; device sets its RTC from it
  PROGRESS: 0x0c, // host writes 0..26; device GUI draws a progress bar from it
  FLASH_SIZE: 0x10, // external flash size in bytes (set by the stub)
  MIN_ERASE_SIZE: 0x14, // external flash min erase/block size
  UPLOAD_IN_PROGRESS: 0x18,
  DOWNLOAD_IN_PROGRESS: 0x1c,
  EXPECTED_HASH: 0x20, // 32 bytes
  ACTUAL_HASH: 0x40, // 32 bytes
  FAILED_CONTEXT_IDX: 0x60,
  RETRY_REQUEST: 0x64,
  RETRY_ACK: 0x68,
} as const;

/** Per-context struct field offsets, relative to the context base (gnw.py). */
const Ctx = {
  SIZE: 0x04,
  OFFSET: 0x08,
  ERASE: 0x0c,
  ERASE_BYTES: 0x10,
  COMPRESSED_SIZE: 0x14,
  EXPECTED_SHA256: 0x18, // 32 bytes
  BANK: 0x38,
  ACTION: 0x3c,
  RESPONSE_READY: 0x40,
  COMPRESSED_SHA256: 0x14c, // 32 bytes
  READY: 0x16c,
} as const;

const N_CONTEXTS = 2;
const CONTEXT_HDR_STRIDE = 1024; // context i header @ MAILBOX_ADDR + (i+1)*1024
// Layout (gnw.py _populate_comm): globals(1024) + contexts[2](2048) +
// active_context(1024) THEN the data buffers. So buffer[0] is at +0x1000, not
// +0xC00 — the +0xC00 slot is active_context, not a data buffer.
const CONTEXT_BUFFER_BASE = MAILBOX_ADDR + 4096; // first context data buffer (0x24026800)
export const CONTEXT_BUFFER_SIZE = 256 << 10; // 256 KiB per context

const EXT_FLASH_ALIGN = 4096; // external flash offset alignment
const INT_FLASH_ALIGN = 8192; // internal flash offset alignment
const INT_BANK_SIZE = 256 << 10; // each internal flash bank is 256 KiB

/** Status enum mirrored from gnwmanager status.py. */
export const Status: Record<number, string> = {
  0x00000000: "BOOTING",
  0xbad00001: "BAD_HASH_RAM",
  0xbad00002: "BAD_HASH_FLASH",
  0xbad00003: "NOT_ALIGNED",
  0xbad00004: "BAD_DECOMPRESS",
  0xbad00005: "BAD_SEGFAULT",
  0xbad00006: "BAD_FLASH_COMM",
  0xbad00007: "BAD_SD_FS_MOUNT",
  0xbad00008: "BAD_SD_OPEN",
  0xbad00009: "BAD_SD_WRITE",
  0xbad0000a: "BAD_SD_UNLINK",
  0xbad0000b: "BAD_SD_DIR",
  0xbad0000c: "BAD_SD_LIST_TRUNC",
  0xbad0000d: "BAD_SD_READ",
  0xbad0000e: "BAD_HASH_RAM_COMPRESSED",
  0xcafe0000: "IDLE",
  0xcafe0001: "ERASE",
  0xcafe0002: "PROG",
  0xcafe0003: "HASH",
};

export const STATUS_IDLE = 0xcafe0000;
const ERROR_MASK = 0xffff0000;
const ERROR_TAG = 0xbad00000;

export const statusName = (v: number): string => Status[v >>> 0] ?? `UNKNOWN(0x${(v >>> 0).toString(16)})`;

/** Mailbox actions (gnwmanager gnw.py). */
export enum Action {
  ERASE_AND_FLASH = 0,
  HASH = 1,
  WRITE_FILE_TO_SD = 2,
  LIST_SD_DIR = 3,
  DELETE_FILE_FROM_SD = 4,
  READ_FILE_FROM_SD = 5,
}

export interface FlashOptions {
  compress?: boolean;
}

export interface DeviceInfo {
  status: string;
  detectedStockFirmware: string;
  externalFlashSizeBytes: number;
  externalFlashSizeMiB: number;
  minEraseSizeBytes: number;
  locked: boolean;
}

/**
 * Stock-firmware fingerprints (gnwmanager cli/devices.py). Detection hashes the
 * residual ITCM image left by the stock firmware (it survives reset_and_halt
 * since RAM isn't cleared). itcmSize 1300 is 4-byte aligned.
 */
const STOCK_MODELS = [
  { name: "MARIO", itcmOffset: 0x00, itcmSize: 1300, itcmSha1: "ca71a54c0a22cca5c6ee129faee9f99f3a346ca0" },
  { name: "ZELDA", itcmOffset: 0x20, itcmSize: 1300, itcmSha1: "2f70156235ffd871599facf64457040d549353b4" },
] as const;

const sha1Hex = async (data: Uint8Array): Promise<string> => {
  const view = new Uint8Array(data); // own buffer for crypto.subtle
  const digest = await globalThis.crypto.subtle.digest("SHA-1", view);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

/** 32-byte SHA-256 digest (gnwmanager utils.sha256). */
const sha256 = async (data: Uint8Array): Promise<Uint8Array> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(data));
  return new Uint8Array(digest);
};

/** Pad `data` up to a multiple of `mod` with `fill` (gnwmanager utils.pad_bytes). */
const padBytes = (data: Uint8Array, mod: number, fill = 0xff): Uint8Array => {
  const padSize = (mod - (data.length % mod)) % mod;
  if (padSize === 0) return data;
  const out = new Uint8Array(data.length + padSize);
  out.set(data);
  out.fill(fill, data.length);
  return out;
};

const hexAddr = (n: number): string => "0x" + (n >>> 0).toString(16).padStart(8, "0");

const toHex = (data: Uint8Array): string =>
  Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");

export type ProgressFn = (done: number, total: number) => void;

/** Optional step-by-step logger for debugging the boot sequence. */
export type LogFn = (msg: string) => void;

/**
 * Injected LZMA1 compressor. Must produce a *raw* LZMA1 stream matching the
 * device decoder: lc=3/lp=0/pb=2, 16 KiB dictionary, end-of-stream marker, and
 * NO 13-byte .lzma header. (Frontend wires LZMA-JS; see frontend/lzma.js.)
 */
export type CompressFn = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;

const MAX_CHUNK_RETRIES = 3; // gnwmanager _MAX_CHUNK_RETRIES

const notImplemented = (what: string): never => {
  throw new Error(`[gnw-flasher] ${what} not implemented yet (scaffold stub)`);
};

const readU32LE = (buf: Uint8Array, off: number): number =>
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(off, true);

/**
 * Unix timestamp such that the device (which treats it as UTC) shows the host's
 * LOCAL wall-clock — matching gnwmanager's `timestamp_now()`
 * (`datetime.now().replace(tzinfo=utc).timestamp()`).
 */
const localAsUtcUnix = (): number => Math.round(Date.now() / 1000) - new Date().getTimezoneOffset() * 60;

/** Pad a buffer up to a 4-byte boundary (writeMemory requires word alignment). */
const pad4 = (data: Uint8Array): Uint8Array => {
  if (data.length % 4 === 0) return data;
  const out = new Uint8Array(data.length + (4 - (data.length % 4)));
  out.set(data);
  return out;
};

export class GnwFlasher {
  /**
   * Mirrors the device's static context_counter (gnwmanager.c:253), which starts
   * at 1 and increments per completed context. The device resets it to 1 every
   * reboot, so startStub() resets ours to 1 to stay in lockstep.
   */
  private contextCounter = 1;

  /** Per-context saved compressed payload, for the BAD_HASH_RAM_COMPRESSED retry. */
  private inFlight: Array<{
    buffer: Uint8Array;
    compressedSha256: Uint8Array;
    expectedSha256: Uint8Array;
    attempts: number;
  } | null> = [null, null];

  constructor(private readonly transport: SwdTransport) {}

  private addr(field: number): number {
    return MAILBOX_ADDR + field;
  }

  /** Address of a per-context header field (context i header @ +(i+1)*1024). */
  private ctxAddr(i: number, field: number): number {
    return MAILBOX_ADDR + (i + 1) * CONTEXT_HDR_STRIDE + field;
  }

  /** Data buffer address for context i. */
  private ctxBuffer(i: number): number {
    return CONTEXT_BUFFER_BASE + i * CONTEXT_BUFFER_SIZE;
  }

  /**
   * Jump to and run the firmware in `bank` (1 or 2): reset-and-halt, read MSP/PC
   * from the bank's vector table (BANK_BASE[bank]), set them, and resume — the same
   * sequence as startStub() minus the stub load. The bank's reset handler sets VTOR.
   *
   * This is a SESSION-ONLY boot: a cold power-cycle reverts to the chip's default
   * boot bank (bank 1 unless the BFB2 option byte is set). After this call the stub
   * is no longer running, so this GnwFlasher is spent — reconnect for more work.
   */
  async startBank(bank: number): Promise<void> {
    const base = BANK_BASE[bank];
    if (bank === 0 || base === undefined) throw new Error(`startBank: invalid bank ${bank}`);
    await this.transport.reset(); // reset + halt at the default reset vector
    const msp = (await this.transport.readWord(base)) >>> 0;
    const pc = (await this.transport.readWord(base + 4)) >>> 0;
    await this.transport.writeRegister("msp", msp);
    await this.transport.writeRegister("pc", pc);
    await this.transport.resume();
  }

  /**
   * Boot the gnwmanager RAM util: reset-and-halt, load firmware.bin into SRAM,
   * set MSP/PC from its vector table, clear status, resume, and wait for IDLE.
   * Mirrors gnw.py start_gnwmanager() — the leading reset_and_halt is required;
   * loading the stub over a running stock firmware hardfaults it. `firmware` is
   * the vendored blobs/firmware.bin.
   */
  async startStub(
    firmware: Uint8Array,
    opts: { timeoutMs?: number; log?: LogFn } = {},
  ): Promise<void> {
    const log = opts.log ?? (() => {});
    const fw = pad4(firmware);
    const msp = readU32LE(fw, 0);
    const pc = readU32LE(fw, 4);

    // Device resets its context_counter to 1 on reboot; match it.
    this.contextCounter = 1;

    log("reset-and-halt…");
    await this.transport.reset();

    log(`loading ${fw.length} bytes @ 0x${FW_LOAD_ADDR.toString(16)}…`);
    // Write + full read-back verify with retry — a corrupt stub would hardfault.
    await this.writeVerified(FW_LOAD_ADDR, fw, true, log, "firmware load");
    log("load verified.");

    // Clear any residual status left in RAM before the stub starts.
    await this.transport.writeWord(this.addr(Field.STATUS), 0);
    await this.transport.writeWord(this.addr(Field.STATUS_OVERRIDE), 0);

    log(`set msp=0x${msp.toString(16)}, pc=0x${pc.toString(16)}`);
    await this.transport.writeRegister("msp", msp);
    await this.transport.writeRegister("pc", pc);
    // PC reads back with bit0 (Thumb) cleared — compare with it masked off.
    const pcBack = (await this.transport.readRegister("pc")) >>> 0;
    const pcOk = (pcBack & ~1) === (pc & ~1);
    log(`pc reads back as 0x${pcBack.toString(16)}${pcOk ? " ✓" : " ✗ (register write not taking)"}`);

    log("resume — waiting for IDLE…");
    await this.transport.resume();
    await this.waitForIdle(opts.timeoutMs, log);

    // Set the device clock from the host's local wall-clock (gnwmanager parity).
    await this.transport.writeWord(this.addr(Field.UTC_TIMESTAMP), localAsUtcUnix() >>> 0);
  }

  /**
   * Poll the mailbox status until IDLE; throw on a BAD_* error or timeout.
   * Like gnw.py, the deadline resets whenever the status value changes (the
   * stub legitimately spends time probing flash between states).
   */
  async waitForIdle(timeoutMs = 10000, log: LogFn = () => {}): Promise<void> {
    let deadline = Date.now() + timeoutMs;
    let last: number | null = null;
    for (;;) {
      const status = (await this.transport.readWord(this.addr(Field.STATUS))) >>> 0;
      if (status !== last) {
        log(`status: ${statusName(status)}`);
        last = status;
        deadline = Date.now() + timeoutMs;
      }
      if (status === STATUS_IDLE) return;
      if ((status & ERROR_MASK) === ERROR_TAG) {
        throw new Error(`[gnw-flasher] stub reported ${statusName(status)}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`[gnw-flasher] timed out waiting for IDLE (last status ${statusName(status)})`);
      }
    }
  }

  /**
   * `gnwmanager info` parity: report the device details the booted stub exposes.
   * Call after startStub(). The flash size/block size are populated by the stub
   * once it has probed the external flash, so reading them proves it is alive.
   */
  async info(opts: { log?: LogFn; flashSizeTimeoutMs?: number } = {}): Promise<DeviceInfo> {
    const log = opts.log ?? (() => {});
    const status = (await this.transport.readWord(this.addr(Field.STATUS))) >>> 0;

    // The stub sets comm.status=IDLE (gnwmanager.c:859) BEFORE it writes
    // flash_size (line 882), with a slow full-screen gui_fill() in between. A
    // fast transport can read flash_size in that window and see 0, so poll until
    // the stub has populated it (or give up — a genuinely undetected flash is 0).
    const externalFlashSizeBytes = await this.externalFlashSize(opts.flashSizeTimeoutMs);
    if (externalFlashSizeBytes === 0) log("flash_size still 0 after wait — flash may be undetected");
    const minEraseSizeBytes = (await this.transport.readWord(this.addr(Field.MIN_ERASE_SIZE))) >>> 0;
    const detectedStockFirmware = await this.detectStockFirmware();

    // gnw.py is_locked(): bank-1 internal flash reads only when unlocked.
    let locked: boolean;
    try {
      await this.transport.readWord(INTFLASH_BANK1_ADDR);
      locked = false;
    } catch {
      locked = true;
    }

    return {
      status: statusName(status),
      detectedStockFirmware,
      externalFlashSizeBytes,
      externalFlashSizeMiB: externalFlashSizeBytes / (1 << 20),
      minEraseSizeBytes,
      locked,
    };
  }

  /** Identify the stock firmware by hashing the residual ITCM (gnwmanager autodetect). */
  async detectStockFirmware(): Promise<string> {
    for (const m of STOCK_MODELS) {
      try {
        const itcm = await this.transport.readMemory(m.itcmOffset, m.itcmSize);
        if ((await sha1Hex(itcm)) === m.itcmSha1) return m.name;
      } catch {
        /* region unreadable on this probe/state; try next */
      }
    }
    return "UNKNOWN";
  }

  // ---- Flash / dump (gnwmanager program/flash/dump) -----------------------

  /** Validate a flash offset's alignment for the given bank (gnw.py validation). */
  private validateOffset(bank: number, offset: number): void {
    const align = bank === 0 ? EXT_FLASH_ALIGN : INT_FLASH_ALIGN;
    if (offset % align !== 0) {
      throw new Error(`[gnw-flasher] ${bank === 0 ? "ext" : "int"}flash offset must be a multiple of ${align}`);
    }
  }

  /** Wait for a free context slot (ready==0) and return its index (gnw.py get_context). */
  async getContext(timeoutMs = 120000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let i = 0; i < N_CONTEXTS; i++) {
        if (((await this.transport.readWord(this.ctxAddr(i, Ctx.READY))) >>> 0) === 0) return i;
      }
      if (Date.now() > deadline) throw new Error("[gnw-flasher] timed out waiting for a free context");
    }
  }

  /**
   * Program (erase + flash) up to one 256 KiB chunk into a single context.
   * If `opts.compress` is given, the chunk is LZMA-compressed and the device
   * decompresses + verifies (with a chunk-retry handshake on transient buffer
   * corruption); otherwise it's sent raw. The device self-verifies the flashed
   * bytes (BAD_HASH_FLASH). Mirrors gnw.py program(). `data` must already be
   * padded to the bank's flash block size. See PLAN.md §"L2".
   */
  async program(
    bank: number,
    offset: number,
    data: Uint8Array,
    opts: {
      erase?: boolean;
      log?: LogFn;
      compress?: CompressFn;
      verify?: boolean;
      onWriteProgress?: ProgressFn;
    } = {},
  ): Promise<void> {
    const log = opts.log ?? (() => {});
    const erase = opts.erase ?? true;
    if (!(bank in BANK_BASE)) throw new Error(`[gnw-flasher] bank must be 0, 1, or 2 (got ${bank})`);
    this.validateOffset(bank, offset);
    if (data.length === 0 || data.length > CONTEXT_BUFFER_SIZE) {
      throw new Error(`[gnw-flasher] program chunk must be 1..${CONTEXT_BUFFER_SIZE} bytes (got ${data.length})`);
    }

    const i = await this.getContext();
    const expectedHash = await sha256(data);

    // Try compression; fall back to raw if it doesn't help (gnw.py: >0.9x).
    let compressed: Uint8Array | null = null;
    let compressedHash: Uint8Array | null = null;
    if (opts.compress) {
      const c = await opts.compress(data);
      if (c.length <= 0.9 * data.length) {
        compressed = c;
        compressedHash = await sha256(c);
      }
    }

    await this.transport.writeWord(this.addr(Field.UPLOAD_IN_PROGRESS), 1);
    await this.transport.writeWord(this.ctxAddr(i, Ctx.ACTION), Action.ERASE_AND_FLASH);
    await this.transport.writeWord(this.ctxAddr(i, Ctx.OFFSET), offset);
    await this.transport.writeWord(this.ctxAddr(i, Ctx.SIZE), data.length);
    await this.transport.writeWord(this.ctxAddr(i, Ctx.BANK), bank);
    if (erase) {
      await this.transport.writeWord(this.ctxAddr(i, Ctx.ERASE), 1);
      await this.transport.writeWord(this.ctxAddr(i, Ctx.ERASE_BYTES), data.length);
    } else {
      await this.transport.writeWord(this.ctxAddr(i, Ctx.ERASE), 0);
    }
    await this.transport.writeMemory(this.ctxAddr(i, Ctx.EXPECTED_SHA256), expectedHash);

    let payload: Uint8Array;
    if (compressed && compressedHash) {
      await this.transport.writeWord(this.ctxAddr(i, Ctx.COMPRESSED_SIZE), compressed.length);
      await this.transport.writeMemory(this.ctxAddr(i, Ctx.COMPRESSED_SHA256), compressedHash);
      payload = pad4(compressed);
      this.inFlight[i] = { buffer: compressed, compressedSha256: compressedHash, expectedSha256: expectedHash, attempts: 0 };
      log(`program ctx${i}: bank=${bank} off=${hexAddr(offset)} size=${data.length} (lzma ${compressed.length}B, ${Math.round((100 * compressed.length) / data.length)}%)${erase ? " erase" : ""}`);
    } else {
      await this.transport.writeWord(this.ctxAddr(i, Ctx.COMPRESSED_SIZE), 0);
      payload = data;
      this.inFlight[i] = null;
      log(`program ctx${i}: bank=${bank} off=${hexAddr(offset)} size=${data.length} (raw)${erase ? " erase" : ""}`);
    }
    await this.writeVerified(this.ctxBuffer(i), payload, opts.verify ?? true, log, "buffer", opts.onWriteProgress);
    // Barrier: ensure buffer write lands before we trigger (gnw.py _drain_pending_writes).
    await this.transport.readWord(this.ctxBuffer(i));

    await this.transport.writeWord(this.ctxAddr(i, Ctx.READY), this.contextCounter);
    this.contextCounter += 1;
    await this.transport.writeWord(this.addr(Field.UPLOAD_IN_PROGRESS), 0);

    await this.waitForContextComplete(i, log);
  }

  /**
   * Write `data` at `addr` and (optionally) read it back to confirm the probe
   * delivered it intact, re-writing on mismatch. Catches transport corruption
   * before it becomes a confusing device-side failure (a hardfaulting stub or a
   * BAD_HASH), turning it into a precise, self-healing host-side operation.
   */
  private async writeVerified(
    addr: number,
    data: Uint8Array,
    verify: boolean,
    log: LogFn,
    label: string,
    onProgress?: ProgressFn,
  ): Promise<void> {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      await this.transport.writeMemory(addr, data, onProgress);
      if (!verify) return;
      const back = await this.transport.readMemory(addr, data.length);
      let bad = -1;
      for (let k = 0; k < data.length; k++) {
        if (back[k] !== data[k]) {
          bad = k;
          break;
        }
      }
      if (bad === -1) return;
      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(
          `[gnw-flasher] ${label} write verify failed at byte ${bad} after ${MAX_ATTEMPTS} attempts ` +
            `(probe transport corruption: wrote 0x${data[bad].toString(16)}, read 0x${back[bad].toString(16)})`,
        );
      }
      log(`${label} verify mismatch at byte ${bad}; re-writing (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
    }
  }

  /** Wait for context i's ready→0, surfacing device errors with hash detail. */
  private async waitForContextComplete(i: number, log: LogFn = () => {}, timeoutMs = 120000): Promise<void> {
    let deadline = Date.now() + timeoutMs;
    let lastStatus: number | null = null;
    for (;;) {
      const ready = (await this.transport.readWord(this.ctxAddr(i, Ctx.READY))) >>> 0;
      if (ready === 0) break;
      const status = (await this.transport.readWord(this.addr(Field.STATUS))) >>> 0;
      if (status !== lastStatus) {
        log(`status: ${statusName(status)}`);
        lastStatus = status;
        deadline = Date.now() + timeoutMs;
      }
      if ((status & ERROR_MASK) === ERROR_TAG) {
        const name = statusName(status);
        // Transient compressed-buffer corruption: re-transmit and continue.
        if (name === "BAD_HASH_RAM_COMPRESSED" && (await this.tryChunkRetry(log))) {
          lastStatus = null;
          deadline = Date.now() + timeoutMs;
          continue;
        }
        if (name === "BAD_HASH_RAM" || name === "BAD_HASH_FLASH" || name === "BAD_HASH_RAM_COMPRESSED") {
          const expected = await this.transport.readMemory(this.addr(Field.EXPECTED_HASH), 32);
          const actual = await this.transport.readMemory(this.addr(Field.ACTUAL_HASH), 32);
          throw new Error(`[gnw-flasher] ${name}: expected ${toHex(expected)} got ${toHex(actual)}`);
        }
        throw new Error(`[gnw-flasher] device error during flash: ${name}`);
      }
      if (Date.now() > deadline) throw new Error(`[gnw-flasher] flash timed out (status ${statusName(lastStatus ?? 0)})`);
      await new Promise(r => setTimeout(r, 10));
    }
  }

  /** Re-transmit a corrupted compressed buffer (gnw.py _try_chunk_retry). */
  private async tryChunkRetry(log: LogFn): Promise<boolean> {
    const idx = (await this.transport.readWord(this.addr(Field.FAILED_CONTEXT_IDX))) >>> 0;
    const saved = this.inFlight[idx];
    if (!saved || saved.attempts >= MAX_CHUNK_RETRIES) return false;
    saved.attempts += 1;
    log(`BAD_HASH_RAM_COMPRESSED on ctx${idx}; re-transmitting (attempt ${saved.attempts}/${MAX_CHUNK_RETRIES})`);

    await this.transport.writeWord(this.addr(Field.UPLOAD_IN_PROGRESS), 1);
    await this.transport.writeMemory(this.ctxBuffer(idx), pad4(saved.buffer));
    await this.transport.writeMemory(this.ctxAddr(idx, Ctx.COMPRESSED_SHA256), saved.compressedSha256);
    await this.transport.writeMemory(this.ctxAddr(idx, Ctx.EXPECTED_SHA256), saved.expectedSha256);
    await this.transport.readWord(this.ctxBuffer(idx)); // barrier

    const newRequest = ((await this.transport.readWord(this.addr(Field.RETRY_REQUEST))) >>> 0) + 1;
    await this.transport.writeWord(this.addr(Field.RETRY_REQUEST), newRequest);
    await this.transport.writeWord(this.addr(Field.UPLOAD_IN_PROGRESS), 0);

    const deadline = Date.now() + 10000;
    while (((await this.transport.readWord(this.addr(Field.RETRY_ACK))) >>> 0) !== newRequest) {
      if (Date.now() > deadline) {
        log(`retry ack timeout on ctx${idx}`);
        return false;
      }
    }
    return true;
  }

  /**
   * Flash arbitrary-length data to a flash location. Pads to the bank's block
   * size, splits into 256 KiB chunks, and programs each (erase+write). Mirrors
   * gnw.py flash(). The device verifies every chunk, so no read-back needed.
   * @param bank 0=ext, 1=bank1, 2=bank2
   */
  async flash(
    bank: number,
    offset: number,
    data: Uint8Array,
    opts: { onProgress?: ProgressFn; log?: LogFn; compress?: CompressFn; verify?: boolean } = {},
  ): Promise<void> {
    const log = opts.log ?? (() => {});
    if (!(bank in BANK_BASE)) throw new Error(`[gnw-flasher] bank must be 0, 1, or 2 (got ${bank})`);
    this.validateOffset(bank, offset);

    const blockSize = bank === 0 ? await this.externalFlashBlockSize() : INT_FLASH_ALIGN;
    const padded = padBytes(data, blockSize);
    if (bank !== 0 && padded.length > CONTEXT_BUFFER_SIZE) {
      throw new Error(`[gnw-flasher] internal flash data must be ≤ ${CONTEXT_BUFFER_SIZE} bytes`);
    }

    const nChunks = Math.ceil(padded.length / CONTEXT_BUFFER_SIZE);
    const total = padded.length;
    log(`flashing ${total} bytes to bank ${bank} @ ${hexAddr(offset)} in ${nChunks} chunk(s)`);
    let dataDone = 0;
    for (let c = 0; c < nChunks; c++) {
      const start = c * CONTEXT_BUFFER_SIZE;
      const chunk = padded.subarray(start, Math.min(start + CONTEXT_BUFFER_SIZE, padded.length));
      await this.program(bank, offset + start, chunk, {
        erase: true,
        log,
        compress: opts.compress,
        verify: opts.verify,
        // Map this chunk's buffer-transfer progress onto overall data bytes.
        onWriteProgress: (w, t) => opts.onProgress?.(dataDone + Math.round((w / t) * chunk.length), total),
      });
      dataDone += chunk.length;
      opts.onProgress?.(dataDone, total);
      // Update the device-side progress bar (0..26, gnwmanager parity).
      await this.transport.writeWord(this.addr(Field.PROGRESS), Math.floor((26 * (c + 1)) / nChunks));
      
      // Throttle delay to prevent ST-Link clone USB saturation between heavy chunk operations
      await new Promise((r) => setTimeout(r, 50));
    }
    log("flash complete (device-verified).");
  }

  /**
   * Read/dump a region of flash. External flash and unlocked internal flash are
   * memory-mapped (gnw.py reads them directly); the stub must be running so OSPI
   * is mapped at 0x90000000. A locked device can't read internal flash here.
   * @param bank 0=ext, 1=bank1, 2=bank2
   */
  async readFlash(bank: number, offset: number, size: number, onProgress?: ProgressFn): Promise<Uint8Array> {
    if (!(bank in BANK_BASE)) throw new Error(`[gnw-flasher] bank must be 0, 1, or 2 (got ${bank})`);
    const base = BANK_BASE[bank];
    const aligned = (size + 3) & ~3; // readMemory needs a 4-byte-aligned length
    await this.transport.writeWord(this.addr(Field.DOWNLOAD_IN_PROGRESS), 1);
    try {
      const data = await this.transport.readMemory(base + offset, aligned, onProgress);
      return aligned === size ? data : data.subarray(0, size);
    } finally {
      await this.transport.writeWord(this.addr(Field.DOWNLOAD_IN_PROGRESS), 0);
    }
  }

  /** External flash block size from the mailbox, falling back to 4096. */
  private async externalFlashBlockSize(): Promise<number> {
    const v = (await this.transport.readWord(this.addr(Field.MIN_ERASE_SIZE))) >>> 0;
    return v || EXT_FLASH_ALIGN;
  }

  /**
   * External flash size the stub detected (bytes). Polls because the stub writes
   * it shortly after going IDLE (see info()'s note). 0 if undetected.
   */
  async externalFlashSize(timeoutMs = 2000): Promise<number> {
    let v = 0;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      v = (await this.transport.readWord(this.addr(Field.FLASH_SIZE))) >>> 0;
      if (v !== 0 || Date.now() > deadline) return v;
    }
  }

  /** Total size of a flash region: detected ext size, or 256 KiB per int bank. */
  async regionSize(bank: number): Promise<number> {
    if (!(bank in BANK_BASE)) throw new Error(`[gnw-flasher] bank must be 0, 1, or 2 (got ${bank})`);
    return bank === 0 ? this.externalFlashSize() : INT_BANK_SIZE;
  }

  async sdWriteFile(_path: string, _data: Uint8Array, _onProgress?: ProgressFn): Promise<void> {
    notImplemented("sdWriteFile");
  }
  async sdListDir(_path: string): Promise<string[]> {
    return notImplemented("sdListDir");
  }
  async sdRead(_path: string): Promise<Uint8Array> {
    return notImplemented("sdRead");
  }
  async sdDelete(_path: string): Promise<void> {
    notImplemented("sdDelete");
  }

  async start(_addr: number): Promise<void> {
    notImplemented("start");
  }
  async unlock(): Promise<void> {
    notImplemented("unlock");
  }
  async lock(): Promise<void> {
    notImplemented("lock");
  }
  async monitor(): Promise<Uint8Array> {
    return notImplemented("monitor");
  }
  async screenshot(): Promise<Uint8Array> {
    return notImplemented("screenshot");
  }
}
