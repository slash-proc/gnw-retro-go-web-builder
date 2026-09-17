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

import type { SwdTransport, ProgressFn } from "@gnw/swd-transport";
export type { ProgressFn } from "@gnw/swd-transport";

/** Memory-mapped mailbox base — gnwmanager gnw.py. */
export const MAILBOX_ADDR = 0x24025800;

/** Load address for the RAM flash util (gnw.py: write_memory(0x240E6800, fw)). */
export const FW_LOAD_ADDR = 0x240e6800;

/** Internal flash bank 1 — readable only when the device is unlocked. */
const INTFLASH_BANK1_ADDR = 0x08000000;

/**
 * Embedded-flash option-byte registers (STM32H7B0 RM0455 §4.9), used only by `unlock()`.
 * Addresses and key values are gnwmanager's, from `cli/_unlock.py`.
 */
const FLASH_OPTKEYR = 0x52002008;
const FLASH_OPTKEY1 = 0x08192a3b;
const FLASH_OPTKEY2 = 0x4c5d6e7f;
const FLASH_OPTCR = 0x52002018;
const FLASH_OPTCR_OPTSTART = 0x02;
const FLASH_OPTSR_PRG = 0x52002020; // the reference writes byte 1 of this word (0x52002021)
const RDP_LEVEL_0 = 0xaa;

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

/**
 * How long the device may sit at IDLE still holding a context before we call it a counter
 * desync. Covers only the gap between the host's `ready` write and the stub's next main-loop
 * iteration, which is microseconds -- this is a thousandfold margin, not a tuning knob.
 */
const CONTEXT_PICKUP_GRACE_MS = 2000;
const VTOR_ADDR = 0xe000ed08;
const RAM_STUB_START = 0x24000000;
const RAM_STUB_END = 0x24100000;

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

/**
 * True for the whole 0xbad0xxxx device-error family.
 *
 * The `>>> 0` is load-bearing: JS bitwise operators coerce to a *signed* int32,
 * so `0xbad0000e & 0xffff0000` evaluates to -1160773632 while ERROR_TAG is the
 * unsigned +3134193664 — the naive `(status & ERROR_MASK) === ERROR_TAG` is
 * therefore ALWAYS false and no device error was ever recognised (they surfaced
 * only as the enclosing loop's 120 s "timed out" stall, and tryChunkRetry() was
 * unreachable). Both `status` and the masked value must be unsigned here.
 */
const isDeviceError = (status: number): boolean =>
  (((status >>> 0) & ERROR_MASK) >>> 0) === ERROR_TAG;

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

/** Optional step-by-step logger for debugging the boot sequence. */
export type LogFn = (msg: string) => void;

/**
 * Injected LZMA1 compressor. Must produce a *raw* LZMA1 stream matching the
 * device decoder: lc=3/lp=0/pb=2, 16 KiB dictionary, end-of-stream marker, and
 * NO 13-byte .lzma header. (Frontend wires LZMA-JS; see frontend/lzma.js.)
 */
export type CompressFn = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;

const MAX_CHUNK_RETRIES = 3; // gnwmanager _MAX_CHUNK_RETRIES

/**
 * BAD_HASH_FLASH attempt budget: the initial attempt plus two retries.
 *
 * Owner ruling (2026-09): *"We need to present a proper error message when
 * BAD_HASH_FLASH occurs. We need to retry 2 times and then give up with an error
 * message and the blocks affected assuming a brief sanity check doesn't help."*
 *
 * This is a THIRD, innermost retry, distinct from the two that already existed:
 *   - tryChunkRetry() — the BAD_HASH_RAM_COMPRESSED handshake (device parks in
 *     GNWMANAGER_HASH_RETRY_WAIT and the host re-transmits the RAM buffer);
 *     there is NO such handshake for BAD_HASH_FLASH (gnwmanager.c:1067-1078 sets
 *     the status and goes straight to GNWMANAGER_ERROR).
 *   - flashImage()'s outer 3-attempt region retry (apps/web engine/flasher.ts),
 *     which reboots the stub and re-sends the WHOLE image. A FlashVerifyError is
 *     marked non-retryable so that outer loop rethrows it immediately instead of
 *     multiplying into 9 attempts.
 */
const MAX_FLASH_HASH_ATTEMPTS = 3;

/** Settle before re-reading the mailbox after a BAD_HASH_FLASH (throttle, not a poll). */
const FLASH_HASH_SETTLE_MS = 250;

/** Identity of one 256 KiB flash block that failed its post-program hash check. */
export interface FlashBlockRef {
  /** 0 = external flash, 1/2 = internal flash banks. */
  bank: number;
  /** Byte offset within the bank, as passed to program(). */
  offset: number;
  /** Memory-mapped absolute address (BANK_BASE[bank] + offset). */
  address: number;
  /** Bytes covered by this block (<= CONTEXT_BUFFER_SIZE). */
  size: number;
  /** 256 KiB block index within the bank — offset / CONTEXT_BUFFER_SIZE. */
  blockIndex: number;
  /** The hash the host asked the device to produce (hex). */
  expectedHash: string;
  /** The hash the device actually read back out of flash (hex). */
  actualHash: string;
}

/**
 * The device programmed a block and its own read-back hash of FLASH did not match
 * (gnwmanager.c GNWMANAGER_CHECK_HASH_FLASH), and the retry budget is exhausted.
 *
 * Carries block identity only — no UI copy. Callers map `blocks[].bank`/`offset`
 * to a human region label from their own partition geometry (apps/web:
 * engine/classify.ts's GeoSegment list; see regionLabelForBlock()).
 */
export class FlashVerifyError extends Error {
  readonly name = "FlashVerifyError";
  /** Always false: re-sending the whole region cannot help, and costs a device reset. */
  readonly retryable = false;
  constructor(
    readonly blocks: FlashBlockRef[],
    readonly attempts: number,
  ) {
    super(
      `[gnw-flasher] BAD_HASH_FLASH: ${blocks.length} block(s) failed verification after ${attempts} attempts — ` +
        blocks
          .map((b) => `block ${b.blockIndex} @ ${hexAddr(b.address)} (expected ${b.expectedHash}, got ${b.actualHash})`)
          .join("; "),
    );
  }
}

/**
 * Internal signal raised by the status pollers when the device reports
 * BAD_HASH_FLASH. program() catches it, adds block identity, and retries.
 */
class BadHashFlashSignal extends Error {
  constructor(readonly expectedHash: string, readonly actualHash: string) {
    super(`[gnw-flasher] BAD_HASH_FLASH: expected ${expectedHash} got ${actualHash}`);
  }
}

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

  /**
   * Serialises "acquire a context, fill it, post it" against itself.
   *
   * THE INVARIANT. The device picks a context up only when its `ready` equals the device's own
   * `context_counter` (`gnwmanager.c`'s `get_context()`), and bumps that counter only on
   * pickup. So the host must post strictly consecutive values, one at a time, each of which is
   * actually seen. `getContext()` reserves NOTHING -- it returns the first slot whose `ready`
   * reads 0 -- and filling a slot takes five or six separate transport calls. Two logical
   * operations on one flasher therefore both get slot 0, clobber each other's ACTION/OFFSET/
   * SIZE, and both write the SAME `ready` word: the second write destroys the first value
   * before the device's main loop ever reads it. The device waits for a counter that no longer
   * exists anywhere, the host has moved two ahead, and nothing is ever picked up again.
   *
   * That is not a corrupted transfer, it is a permanently wedged mailbox: the flash parks at 0%
   * and every later operation on this flasher is refused too. A transport-level FIFO cannot fix
   * it -- it keeps individual transfers from interleaving, which was never the problem.
   *
   * Held only across acquire+fill+post, never across the device's actual work, so a flash's
   * sequential `program()` loop is unaffected and the two contexts still double-buffer.
   */
  private ctxLock: Promise<unknown> = Promise.resolve();

  private async claimContext(
    fill: (i: number) => Promise<void>,
    timeoutMs?: number,
    abortSignal?: AbortSignal,
  ): Promise<number> {
    const prev = this.ctxLock;
    let release!: () => void;
    this.ctxLock = new Promise<void>((r) => (release = r));
    await prev.catch(() => {});
    try {
      const i = await this.getContext(timeoutMs, abortSignal);
      await fill(i);
      await this.transport.writeWord(this.ctxAddr(i, Ctx.READY), this.contextCounter);
      this.contextCounter += 1;
      return i;
    } finally {
      release();
    }
  }

  /** Per-context saved compressed payload, for the BAD_HASH_RAM_COMPRESSED retry. */
  private inFlight: Array<{
    buffer: Uint8Array;
    compressedSha256: Uint8Array;
    expectedSha256: Uint8Array;
    attempts: number;
  } | null> = [null, null];

  /** PUBLIC on purpose: a cached flasher is only usable while the transport it captured is
   *  still the live one. `device.svelte.ts`'s `ensureStub` compares this against its own
   *  `this.transport` before reusing a flasher -- a protocol-level liveness ping cannot tell
   *  the difference, because it is issued through the CALLER's transport, not this one. */
  constructor(readonly transport: SwdTransport) {}

  private addr(field: number): number {
    return MAILBOX_ADDR + field;
  }

  /** Address of a per-context header field (context i header @ +(i+1)*1024). */
  /**
   * SHA-256 of external-flash regions, computed ON THE DEVICE.
   *
   * 1:1 with `gnwmanager/gnw.py`'s `read_hashes`, against `gnwmanager_action_hash`
   * (`Core/Src/gnwmanager.c`): the stub walks `offset..offset+size` in 256 KiB chunks, hashes
   * each with the H7's hardware unit, and writes 32 bytes per chunk into the context buffer.
   * It enables memory-mapped mode itself, so the caller does not have to.
   *
   * This exists to answer "has this region changed" without dragging it over SWD. One request
   * and 32 bytes per 256 KiB beats reading 256 KiB, by four orders of magnitude.
   *
   * The last chunk may be shorter than 256 KiB; the digest still covers exactly the bytes in
   * range, so a caller comparing against locally computed digests must chunk identically.
   */
  async readHashes(offset: number, size: number, timeoutMs = 120000): Promise<Uint8Array[]> {
    // The SLOT wait is the short one (see getContext): waiting for a free context means the
    // device is busy, and that is a no-progress question. The hash itself can legitimately take
    // a while on a large region, so the response wait below keeps the long budget.
    if (size <= 0) return [];
    const CHUNK = 256 << 10;
    const nChunks = Math.ceil(size / CHUNK);
    const i = await this.claimContext(async (ctx) => {
      await this.transport.writeWord(this.ctxAddr(ctx, Ctx.RESPONSE_READY), 0);
      await this.transport.writeWord(this.ctxAddr(ctx, Ctx.ACTION), Action.HASH);
      await this.transport.writeWord(this.ctxAddr(ctx, Ctx.OFFSET), offset >>> 0);
      await this.transport.writeWord(this.ctxAddr(ctx, Ctx.SIZE), size >>> 0);
    });

    // The device signals completion through RESPONSE_READY for this action, not by clearing
    // READY -- `gnwmanager_action_hash` sets `response_ready = 1` and returns (gnw.py waits on
    // `wait_for_context_response` for the same reason).
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (((await this.transport.readWord(this.ctxAddr(i, Ctx.RESPONSE_READY))) >>> 0) !== 0) break;
      if (Date.now() > deadline) throw new Error("[gnw-flasher] timed out waiting for the hash response");
      await new Promise((r) => setTimeout(r, 10));
    }

    const raw = await this.transport.readMemory(this.ctxBuffer(i), nChunks * 32);
    await this.transport.writeWord(this.ctxAddr(i, Ctx.READY), 0);
    const out: Uint8Array[] = [];
    for (let c = 0; c < nChunks; c++) out.push(raw.slice(c * 32, (c + 1) * 32));
    return out;
  }

  /**
   * Drain EVERY context, then wait for IDLE. 1:1 with `gnw.py`'s
   * `wait_for_all_contexts_complete`, which `_flash_ext` calls after its last packet.
   *
   * Our `flash()` waited only on the context each chunk used, and with two contexts the other
   * one can still be mid erase/program when the loop ends. The call then returns while the
   * device is still working, which is why a SECOND flash could stall on its first transfer:
   * `getContext` finds no free slot, and `ensureStub`'s `contextsFree` probe reads a busy
   * context as a wedged stub and reboots it, resetting the device mid-operation.
   *
   * NO-PROGRESS budget per context, like the reference: the deadline resets whenever `ready`
   * or the device status changes, so a slow but advancing erase is tolerated and only a genuine
   * stall raises.
   */
  async waitForAllContextsComplete(timeoutMs = 20000, log: LogFn = () => {}): Promise<void> {
    for (let i = 0; i < N_CONTEXTS; i++) {
      const stall = this.stallWatch(timeoutMs, log, `context ${i}`);
      let lastReady: number | null = null;
      let lastStatus: number | null = null;
      for (;;) {
        const ready = (await this.transport.readWord(this.ctxAddr(i, Ctx.READY))) >>> 0;
        if (ready === 0) break;
        const status = (await this.transport.readWord(this.addr(Field.STATUS))) >>> 0;
        if (ready !== lastReady || status !== lastStatus) {
          if (status !== lastStatus) log(`status: ${statusName(status)}`);
          lastReady = ready;
          lastStatus = status;
          stall.progress();
        }
        if (isDeviceError(status)) throw new Error(`[gnw-flasher] device error while draining contexts: ${statusName(status)}`);
        stall.check(statusName(lastStatus ?? 0));
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    await this.waitForIdle(timeoutMs, log);
  }

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
  // Default 120s to match gnw.py's `wait_for_idle(timeout: float = 120)`. This is a
  // NO-PROGRESS budget, not wall-clock: the deadline resets on every status change, so a
  // slow-but-advancing operation is tolerated indefinitely and only a genuine stall raises.
  // Our port previously defaulted to 10s (and program() passed 15s), which is 8-12x tighter
  // than the reference for no reason — see the call site at the end of program().
  /**
   * The no-progress rule for a wait on work the device is actively doing: WARN at half the
   * budget, give up at the budget so the caller's retry reboots the stub.
   *
   * 20 s is not arbitrary. The budget resets on a STATUS CHANGE, so it is really "how long may
   * one phase take", and a 256 KiB chunk on real hardware has been observed sitting 4 s in a
   * single status (erase -> HASH). 5 s would fail healthy flashes; gnwmanager's 120 s exists to
   * cover a whole-chip erase, which our port never issues (ERASE_BYTES is always the chunk
   * length, capped at 256 KiB). 10 s of silence is worth saying out loud; 20 s means the stub is
   * wedged, and rebooting it is the only recovery that has ever worked.
   */
  private stallWatch(timeoutMs: number, log: LogFn, what: string) {
    let deadline = Date.now() + timeoutMs;
    let warningAt = Date.now() + Math.min(10_000, timeoutMs);
    let warned = false;
    return {
      progress(): void {
        deadline = Date.now() + timeoutMs;
        warningAt = Date.now() + Math.min(10_000, timeoutMs);
        warned = false;
      },
      check(statusLabel: string): void {
        const left = deadline - Date.now();
        if (!warned && Date.now() >= warningAt) {
          warned = true;
          log(`warning: ${what} has not advanced for ${Math.min(10_000, timeoutMs) / 1000}s (status ${statusLabel})`);
        }
        if (left <= 0) {
          // A stall at IDLE is almost always the CONTEXT COUNTER, not a wedged device. The stub
          // accepts a context only when `ready` equals its own `context_counter`
          // (gnwmanager.c: `if (comm.contexts[i].ready == context_counter)`), which starts at 1
          // and resets whenever the stub restarts. Ours resets only in `startStub`, so a device
          // that restarted under a cached flasher waits for 1 while we write N -- forever, with
          // the mailbox idle throughout. The caller's retry reboots the stub, which resets both
          // sides, which is why a retry of the identical chunk then succeeds immediately.
          const hint =
            statusLabel === "IDLE"
              ? " -- the mailbox is idle, so the device is most likely waiting for a different " +
                "context counter; the stub reboot resynchronises it"
              : "";
          throw new Error(
            `[gnw-flasher] ${what} stalled for ${(timeoutMs / 1000).toFixed(0)}s with no progress ` +
              `(status ${statusLabel})${hint}; restarting the flash util`,
          );
        }
      },
    };
  }

  async waitForIdle(timeoutMs = 20000, log: LogFn = () => {}): Promise<void> {
    const stall = this.stallWatch(timeoutMs, log, "the device");
    let last: number | null = null;
    let nextVtorCheck = 0;
    for (;;) {
      const status = (await this.transport.readWord(this.addr(Field.STATUS))) >>> 0;
      // If the target reset out of the RAM stub during erase/program, the mailbox can retain
      // its last ERASE value and otherwise look alive. VTOR is the immediate, non-halting
      // witness: the stub runs from 0x240xxxxx; the bootloader/firmware does not. Surface this
      // as soon as it is observed so flashImage() restarts the stub immediately rather than
      // waiting for the no-progress timeout.
      if (status !== STATUS_IDLE && status !== 0 && Date.now() >= nextVtorCheck) {
        // Avoid adding a second SWD read to every 10 ms mailbox poll while still detecting a
        // reset within one normal polling interval.
        nextVtorCheck = Date.now() + 100;
        const vtor = (await this.transport.readWord(VTOR_ADDR)) >>> 0;
        if (vtor < RAM_STUB_START || vtor >= RAM_STUB_END) {
          throw new Error(`[gnw-flasher] RAM stub exited during ${statusName(status)} (VTOR=0x${vtor.toString(16)})`);
        }
      }
      if (status !== last) {
        log(`status: ${statusName(status)}`);
        last = status;
        stall.progress();
      }
      if (status === STATUS_IDLE) return;
      if (isDeviceError(status)) {
        // BAD_HASH_FLASH is normally observed HERE, not in waitForContextComplete: the
        // firmware calls release_context() (clearing the context's `ready`) at the END of
        // GNWMANAGER_DECOMPRESSING (gnwmanager.c:934), i.e. before CHECK_HASH_RAM and long
        // before GNWMANAGER_CHECK_HASH_FLASH sets this status. Raise the typed signal so
        // program()'s retry policy can act on it.
        if (statusName(status) === "BAD_HASH_FLASH") throw await this.badHashFlashSignal();
        throw new Error(`[gnw-flasher] stub reported ${statusName(status)}`);
      }
      stall.check(statusName(status));
      await new Promise(r => setTimeout(r, 10));
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

  /**
   * Acquire a free context buffer (0 or 1). Will wait up to timeoutMs if both
   * are busy. Used by program() to implement double-buffered streaming.
   */
  // Default 120s to match gnw.py's `get_context(timeout=120)`. Callers that want a quick
  // liveness PROBE rather than a real acquisition pass an explicit short timeout (see
  // device.svelte.ts's contextsFree(), which uses 3s and additionally races it — this
  // loop, like waitForIdle/waitForContextComplete, only checks its deadline AFTER a
  // transport read returns, so a wedged probe can park it indefinitely).
  async getContext(timeoutMs = 5000, abortSignal?: AbortSignal): Promise<number> {
    // NO-PROGRESS budget, not wall-clock, and short. Waiting for a free context means the
    // device is still working, and while it works its status changes (ERASE -> PROG -> IDLE) --
    // so a long erase resets the deadline and is tolerated indefinitely, while a device that
    // has stopped answering fails in seconds instead of two minutes. The old 120 s wall clock
    // was the wrong shape for both cases: it capped a legitimately slow operation and made a
    // wedged one look like a hang.
    let deadline = Date.now() + timeoutMs;
    let lastStatus: number | null = null;
    for (;;) {
      if (abortSignal?.aborted) throw new Error("Operation aborted");
      for (let i = 0; i < N_CONTEXTS; i++) {
        if (((await this.transport.readWord(this.ctxAddr(i, Ctx.READY))) >>> 0) === 0) return i;
      }
      const status = (await this.transport.readWord(this.addr(Field.STATUS))) >>> 0;
      if (status !== lastStatus) {
        lastStatus = status;
        deadline = Date.now() + timeoutMs;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `[gnw-flasher] no free context: no progress for ${(timeoutMs / 1000).toFixed(1)}s ` +
            `(status ${statusName(lastStatus ?? 0)})`,
        );
      }
      await new Promise(r => setTimeout(r, 10));
    }
  }

  /**
   * Program (erase + flash) up to one 256 KiB chunk into a single context.
   * If `opts.compress` is given, the chunk is LZMA-compressed and the device
   * decompresses + verifies (with a chunk-retry handshake on transient buffer
   * corruption); otherwise it's sent raw. The device self-verifies the flashed
   * bytes (BAD_HASH_FLASH). Mirrors gnw.py program(). `data` must already be
   * padded to the bank's flash block size. See PLAN.md §"L2".
   *
   * On BAD_HASH_FLASH this retries the block twice (3 attempts total) with a brief
   * sanity check between attempts, then throws a FlashVerifyError naming the block.
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
      abortSignal?: AbortSignal;
    } = {},
  ): Promise<void> {
    const log = opts.log ?? (() => {});
    let last: BadHashFlashSignal | null = null;
    for (let attempt = 1; attempt <= MAX_FLASH_HASH_ATTEMPTS; attempt++) {
      try {
        await this.programOnce(bank, offset, data, opts);
        if (attempt > 1) log(`BAD_HASH_FLASH recovered on attempt ${attempt}/${MAX_FLASH_HASH_ATTEMPTS}`);
        return;
      } catch (e) {
        if (!(e instanceof BadHashFlashSignal)) throw e;
        last = e;
        if (opts.abortSignal?.aborted) throw new Error("Operation aborted");
        log(
          `BAD_HASH_FLASH on block @ ${hexAddr((BANK_BASE[bank] ?? 0) + offset)} ` +
            `(attempt ${attempt}/${MAX_FLASH_HASH_ATTEMPTS})`,
        );
        await this.sanityCheckFlashHash(log);
        if (attempt >= MAX_FLASH_HASH_ATTEMPTS) break;
        // Re-issuing the identical context is the retry: it also puts the firmware back
        // into GNWMANAGER_IDLE from GNWMANAGER_ERROR (gnwmanager.c ERROR case leaves on any
        // context ready flag) and clears the stale BAD_* status.
        log(`re-programming the block (attempt ${attempt + 1}/${MAX_FLASH_HASH_ATTEMPTS})`);
      }
    }
    const sig = last!;
    throw new FlashVerifyError(
      [
        {
          bank,
          offset,
          address: ((BANK_BASE[bank] ?? 0) + offset) >>> 0,
          size: data.length,
          blockIndex: Math.floor(offset / CONTEXT_BUFFER_SIZE),
          expectedHash: sig.expectedHash,
          actualHash: sig.actualHash,
        },
      ],
      MAX_FLASH_HASH_ATTEMPTS,
    );
  }

  /** One program attempt — the 1:1 gnw.py program() body. See program() for the retry policy. */
  private async programOnce(
    bank: number,
    offset: number,
    data: Uint8Array,
    opts: {
      erase?: boolean;
      log?: LogFn;
      compress?: CompressFn;
      verify?: boolean;
      onWriteProgress?: ProgressFn;
      abortSignal?: AbortSignal;
    } = {},
  ): Promise<void> {
    if (opts.abortSignal?.aborted) throw new Error("Operation aborted");
    const log = opts.log ?? (() => {});
    const erase = opts.erase ?? true;
    if (!(bank in BANK_BASE)) throw new Error(`[gnw-flasher] bank must be 0, 1, or 2 (got ${bank})`);
    this.validateOffset(bank, offset);
    if (data.length === 0 || data.length > CONTEXT_BUFFER_SIZE) {
      throw new Error(`[gnw-flasher] program chunk must be 1..${CONTEXT_BUFFER_SIZE} bytes (got ${data.length})`);
    }

    // No argument: getContext's own 5 s NO-PROGRESS budget. The reference passes nothing here
    // either, but its default is a 120 s wall clock, which capped slow erases and turned a
    // wedged device into a two-minute hang.
    // Hashing and compression are pure CPU and touch no device state, so they run BEFORE the
    // context is claimed -- holding the mailbox lock across an LZMA pass would serialise the
    // expensive half of every chunk for no benefit.
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

    let payload: Uint8Array = data;
    const i = await this.claimContext(async (i) => {
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
      // Default OFF (unlike the one-time stub firmware load in startStub(), which stays
      // hardcoded verify=true — a corrupt stub hardfaults, so that one's cheap and justified).
      // gnwmanager's reference Python has no read-back verification of this per-chunk context
      // buffer write at all — it trusts the device's own BAD_HASH_RAM(_COMPRESSED) check plus
      // the chunk-retry handshake (tryChunkRetry, below) entirely. Our added read-back (up to
      // 16 extra chunked reads per 256KB payload, each with its own settle/throttle delay) was a
      // TS-only addition that roughly triples the WebUSB transaction count per chunk on every
      // flash operation — directly increasing exposure to the documented ST-Link-clone USB-
      // saturation lockup risk, without catching anything the device's own hash check doesn't
      // already catch. See CLAUDE.md/memory for the investigation that found this.
      await this.writeVerified(this.ctxBuffer(i), payload, opts.verify ?? false, log, "buffer", opts.onWriteProgress);
      // Barrier: ensure buffer write lands before we trigger (gnw.py _drain_pending_writes).
      await this.transport.readWord(this.ctxBuffer(i));
    }, undefined, opts.abortSignal);
    await this.transport.writeWord(this.addr(Field.UPLOAD_IN_PROGRESS), 0);

    // No explicit budget: waitForContextComplete's own 20 s no-progress rule applies, with a
    // warning at 10 s. This passed 120000, which silently defeated that rule at the one call
    // site that matters -- a real stall sat for two minutes before the retry rebooted the stub.
    await this.waitForContextComplete(i, log, undefined, opts.abortSignal);
    // waitForContextComplete only confirms the RAM context's own `ready` flag cleared — the
    // firmware clears that right after the buffer transfer/decompression step, BEFORE it has
    // actually erased, programmed, or hash-verified the flash (gnwmanager.c: release_context()
    // runs at the END of GNWMANAGER_DECOMPRESSING, gnwmanager.c:934, well before
    // GNWMANAGER_ERASE/PROGRAM/CHECK_HASH_FLASH). The reference Python tool always follows a completed context with a
    // wait for the global status to reach IDLE (wait_for_all_contexts_complete ->
    // wait_for_idle) — without the equivalent here, program() previously returned (and the
    // device-side progress bar got updated) while the device was still mid-erase/program/verify,
    // which is what produced both the apparent multi-second "stall" on later operations and the
    // on-device progress bar failing to clear.
    // 120s, matching gnw.py's `wait_for_idle()` default at the same point in program().
    // A 15s budget here was the actual cause of the "patched OFW flash is flaky / works on
    // the 3rd try" report: erasing a large internal-flash region legitimately holds STATUS
    // at ERASE for longer than 15s with no intermediate status change, so this threw
    // `timed out waiting for IDLE (last status ERASE)` at the very END of a write that had
    // in fact succeeded. flashImage() then caught it and re-sent the ENTIRE image (that's
    // the progress bar visibly winding back and re-filling), up to maxAttempts=3 — and each
    // retry forces a stub reboot, i.e. a device reset, which is what turned an already-
    // completed flash into a wedged target. Observed on hardware, 2026-08.
    // A stalled erase must surface to the caller; retrying here reboots the RAM
    // utility and starts the whole image again, which is unsafe after a bank write.
    await this.waitForIdle(15000, log);
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
      await new Promise(r => setTimeout(r, 20)); // settle before read
      const back = new Uint8Array(data.length);
      const CHUNK_SIZE = 16384;
      for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
        const len = Math.min(CHUNK_SIZE, data.length - offset);
        const chunk = await this.transport.readMemory(addr + offset, len);
        back.set(chunk, offset);
        await new Promise(r => setTimeout(r, 10)); // throttle reads
      }
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
      await new Promise(r => setTimeout(r, 250)); // let device settle before retry
    }
  }

  /** Wait for context i's ready→0, surfacing device errors with hash detail. */
  private async waitForContextComplete(i: number, log: LogFn = () => {}, timeoutMs = 20000, abortSignal?: AbortSignal): Promise<void> {
    const stall = this.stallWatch(timeoutMs, log, `context ${i}`);
    let lastStatus: number | null = null;
    // When the device first looked IDLE while still holding our context. See the throw below.
    let idleHoldingSince: number | null = null;
    for (;;) {
      if (abortSignal?.aborted) throw new Error("Operation aborted");
      const ready = (await this.transport.readWord(this.ctxAddr(i, Ctx.READY))) >>> 0;
      if (ready === 0) break;
      const status = (await this.transport.readWord(this.addr(Field.STATUS))) >>> 0;

      // THE CONTEXT COUNTER DESYNC, caught in seconds instead of the generic no-progress budget.
      //
      // The stub picks up a context only when its `ready` equals the stub's own
      // `context_counter` (gnwmanager.c's `get_context()`), and `context_counter++` happens on
      // the same iteration as the pickup, before any long work: every action sets a status
      // (HASH, PROG, ...) before it starts. When NOTHING matches, the loop's NULL branch sets
      // IDLE and breaks.
      //
      // So "the mailbox is IDLE while it still holds our non-zero `ready`" is not a slow device,
      // it is proof that `get_context()` returned NULL after our write: the two counters
      // disagree and no amount of waiting will fix it. The stub's counter is a `.data` static
      // reset to 1 whenever the stub starts running, while the mailbox lives in `.lcd`
      // (STM32H7B0VBTx_FLASH.ld) and survives -- so a stub that restarted under a cached flasher
      // waits for 1 while we write N. Every liveness check still passes, because the stub is
      // alive and its contexts are free.
      //
      // The grace period only covers the gap between our write and the device's next loop
      // iteration, which is microseconds; seconds of it is a thousandfold margin, and the
      // condition is a proof rather than a guess, so it cannot fire on a merely slow device.
      // A stub restart is not the only way to get here, and saying so cost a long hunt once:
      // two logical operations on ONE flasher both claim a context, both post the SAME `ready`
      // word, and the second write destroys the first before the device's loop reads it -- same
      // symptom, entirely different cause. `claimContext` closes that path; the message names
      // both so the next reader is not sent looking for a reboot that never happened.
      //
      // Recovery is the caller's existing retry, which reboots the stub and resets both sides.
      if (status === STATUS_IDLE) {
        idleHoldingSince ??= Date.now();
        if (Date.now() - idleHoldingSince > CONTEXT_PICKUP_GRACE_MS) {
          throw new Error(
            `[gnw-flasher] context ${i} was never picked up: the mailbox is IDLE while still ` +
              `holding ready=${ready} (host counter ${this.contextCounter}), so the device is ` +
              `waiting for a different context counter. Either the stub restarted under this ` +
              `flasher (its counter resets to 1, ours does not), or a second operation posted ` +
              `a context on this same flasher and overwrote ours. Restarting the flash util ` +
              `resynchronises both sides.`,
          );
        }
      } else {
        idleHoldingSince = null;
      }

      if (status !== lastStatus) {
        log(`status: ${statusName(status)}`);
        lastStatus = status;
        stall.progress();
      }
      if (isDeviceError(status)) {
        const name = statusName(status);
        // Transient compressed-buffer corruption: re-transmit and continue.
        if (name === "BAD_HASH_RAM_COMPRESSED" && (await this.tryChunkRetry(log))) {
          lastStatus = null;
          stall.progress();
          continue;
        }
        if (name === "BAD_HASH_FLASH") throw await this.badHashFlashSignal();
        if (name === "BAD_HASH_RAM" || name === "BAD_HASH_RAM_COMPRESSED") {
          const expected = await this.transport.readMemory(this.addr(Field.EXPECTED_HASH), 32);
          const actual = await this.transport.readMemory(this.addr(Field.ACTUAL_HASH), 32);
          throw new Error(`[gnw-flasher] ${name}: expected ${toHex(expected)} got ${toHex(actual)}`);
        }
        throw new Error(`[gnw-flasher] device error during flash: ${name}`);
      }
      stall.check(statusName(lastStatus ?? 0));
      await new Promise(r => setTimeout(r, 10));
    }
  }

  /**
   * Read the device's own expected/actual FLASH hashes out of the mailbox
   * (gnwmanager.c CHECK_HASH_FLASH memcpy's both into comm before setting the
   * status) and package them as the typed retry signal.
   */
  private async badHashFlashSignal(): Promise<BadHashFlashSignal> {
    const expected = await this.transport.readMemory(this.addr(Field.EXPECTED_HASH), 32);
    const actual = await this.transport.readMemory(this.addr(Field.ACTUAL_HASH), 32);
    return new BadHashFlashSignal(toHex(expected), toHex(actual));
  }

  /**
   * The "brief sanity check" of the owner's BAD_HASH_FLASH ruling.
   *
   * There is deliberately no host-side re-verification here, and no device-side
   * re-check command to call: unlike BAD_HASH_RAM_COMPRESSED — which parks the
   * firmware in GNWMANAGER_HASH_RETRY_WAIT and exposes the retry_request/retry_ack
   * handshake (gnwmanager.c:1082-1100, ported as tryChunkRetry) — BAD_HASH_FLASH
   * goes straight to GNWMANAGER_ERROR (gnwmanager.c:1067-1078). The only thing the
   * host can honestly do is settle, re-read the mailbox once, and confirm the
   * failure is stable rather than a torn/stale word off the SWD link.
   *
   * The SUBSTANTIVE check is the device's own: re-issuing the same context makes
   * the firmware re-hash the destination region before erasing and skip the write
   * entirely if it already matches ("Contents of this chunk didn't change",
   * gnwmanager.c IDLE case) — so a spurious failure costs one hash and resolves
   * itself, while a real one fails again. Returns true if the status has already
   * cleared (nothing left to diagnose), false if the error is still standing.
   */
  private async sanityCheckFlashHash(log: LogFn): Promise<boolean> {
    await new Promise((r) => setTimeout(r, FLASH_HASH_SETTLE_MS)); // settle; never a tight poll
    const status = (await this.transport.readWord(this.addr(Field.STATUS))) >>> 0;
    if (!isDeviceError(status)) {
      log(`BAD_HASH_FLASH sanity check: status re-reads as ${statusName(status)} (transient)`);
      return true;
    }
    log(`BAD_HASH_FLASH sanity check: status still ${statusName(status)}`);
    return false;
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
      await new Promise(r => setTimeout(r, 10));
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
    opts: { onProgress?: ProgressFn; log?: LogFn; compress?: CompressFn; verify?: boolean; abortSignal?: AbortSignal } = {},
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
      if (opts.abortSignal?.aborted) throw new Error("Operation aborted");
      const start = c * CONTEXT_BUFFER_SIZE;
      const chunk = padded.subarray(start, Math.min(start + CONTEXT_BUFFER_SIZE, padded.length));
      await this.program(bank, offset + start, chunk, {
        erase: true,
        log,
        compress: opts.compress,
        verify: opts.verify,
        abortSignal: opts.abortSignal,
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
    // Drain BOTH contexts before returning, then clear the device's progress bar. Without the
    // drain this returned with work still in flight (see waitForAllContextsComplete); without
    // the reset the on-device bar sits at 100% until something else resets the device, which is
    // what gnwmanager's trailing `-- start bank1` happens to do for it.
    await this.waitForAllContextsComplete(20000, log);
    await this.transport.writeWord(this.addr(Field.PROGRESS), 0);
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
      await new Promise((r) => setTimeout(r, 10));
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
  /**
   * Clear RDP read-protection (level 1 -> level 0) on the internal flash.
   *
   * 1:1 port of the `_message("Unlocking device")` block in
   * `references/gnwmanager/gnwmanager/cli/_unlock.py` (identical in both of that
   * command's branches), which in turn comes from ghidraninja/game-and-watch-backup.
   *
   *   gnw.backend.halt()
   *   gnw.write_uint32(0x52002008, 0x08192A3B)   # FLASH_OPTKEYR <- OPTKEY1
   *   sleep(0.1)
   *   gnw.write_uint32(0x52002008, 0x4C5D6E7F)   # FLASH_OPTKEYR <- OPTKEY2
   *   sleep(0.1)
   *   gnw.write_memory(0x52002021, b"\xaa")      # FLASH_OPTSR_PRG byte 1 = RDP <- 0xAA
   *   sleep(0.1)
   *   gnw.write_memory(0x52002018, b"\x02")      # FLASH_OPTCR byte 0 = OPTSTART
   *   sleep(0.2)
   *   gnw.reset()
   *
   * THIS ERASES BOTH FLASHES. Clearing RDP is defined by the hardware to mass-erase
   * internal flash, and the stock firmware image is unique per unit (it is not
   * redistributable and cannot be re-downloaded). A locked device's internal flash is
   * also unreadable over SWD, which is why gnwmanager's full `unlock` command backs up
   * ITCM + external flash, flashes an XOR-obfuscated payload that dumps internal flash
   * to SRAM after a power cycle, and only then runs the four writes above. Ordering the
   * backup before this call is the CALLER's job -- see `engine/unlockGate.ts`, which is
   * the only thing in the app allowed to invoke it.
   *
   * ONE DELIBERATE DEVIATION from the reference. The two writes at 0x52002021 and
   * 0x52002018 are single-BYTE writes; `SwdTransport.writeMemory` asserts word alignment
   * (`assertWordAligned`), so a byte write is not expressible here. Both are done instead
   * as a read-modify-write of the containing word that REPLACES exactly the byte the
   * reference writes and leaves the other three untouched -- which is what the byte
   * write's bus strobes do. Replacing the byte rather than OR-ing the bit matters for
   * OPTCR: bit 2 is MER (mass erase), and an OR that inherited a stale MER=1 would start
   * a different operation than the reference does.
   */
  async unlock(): Promise<void> {
    // Halting first is what the reference does, and it also freezes both watchdogs (see
    // SwdTransport.halt) so the sleeps below cannot be interrupted by a watchdog reset.
    await this.transport.halt();

    await this.transport.writeWord(FLASH_OPTKEYR, FLASH_OPTKEY1);
    await new Promise((r) => setTimeout(r, 100));
    await this.transport.writeWord(FLASH_OPTKEYR, FLASH_OPTKEY2);
    await new Promise((r) => setTimeout(r, 100));

    // FLASH_OPTSR_PRG bits [15:8] = RDP; 0xAA is level 0 (no protection).
    const optsr = (await this.transport.readWord(FLASH_OPTSR_PRG)) >>> 0;
    await this.transport.writeWord(FLASH_OPTSR_PRG, ((optsr & ~0x0000ff00) | (RDP_LEVEL_0 << 8)) >>> 0);
    await new Promise((r) => setTimeout(r, 100));

    // FLASH_OPTCR byte 0 <- 0x02: OPTSTART (bit 1) set, OPTLOCK (bit 0) and MER (bit 2) clear.
    const optcr = (await this.transport.readWord(FLASH_OPTCR)) >>> 0;
    await this.transport.writeWord(FLASH_OPTCR, ((optcr & ~0x000000ff) | FLASH_OPTCR_OPTSTART) >>> 0);
    await new Promise((r) => setTimeout(r, 200));

    await this.transport.reset();
  }

  /**
   * Re-applying RDP is deliberately NOT implemented, and this stub is the record of that
   * decision rather than an unfinished port. Locking buys the owner of a device they are
   * already modifying nothing, and costs them the debug access every other operation in
   * this tool depends on. If it is ever wanted, the sequence is `unlock()`'s with
   * `RDP_LEVEL_0` swapped for the level-1 value -- but the mass erase applies going the
   * other way too, so it would need the same backup ordering.
   */
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
