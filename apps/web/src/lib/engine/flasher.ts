// Boot the gnwmanager RAM stub and run flash/dump over the live transport.
import { GnwFlasher, FlashVerifyError, MAILBOX_ADDR, STATUS_IDLE, type DeviceInfo, type LogFn, type ProgressFn } from "@gnw/gnw-flasher";
import { isDeadHandleError } from "@gnw/swd-transport";
import type { SwdTransport } from "@gnw/swd-transport";
import { lzmaCompress, preloadLzma } from "./lzma.js";
import firmwareUrl from "@gnw/gnw-flasher/blobs/firmware.bin?url";

// Keep the host watchdog aligned with gnw-flasher's 30-second no-progress phase
// budget. A wedged erase must surface promptly instead of holding the UI for two minutes.
const FLASH_STALL_MS = 15_000;

export type { DeviceInfo };
export { preloadLzma };

let firmwareCache: Uint8Array | null = null;
async function loadFirmware(): Promise<Uint8Array> {
  if (!firmwareCache) {
    firmwareCache = new Uint8Array(await (await fetch(firmwareUrl)).arrayBuffer());
  }
  return firmwareCache;
}

/** Reset-and-halt, load the RAM util, resume to IDLE, set the device clock. */
export async function bootStub(transport: SwdTransport, log?: LogFn): Promise<GnwFlasher> {
  const flasher = new GnwFlasher(transport);
  await flasher.startStub(await loadFirmware(), { log });
  return flasher;
}

/** Wrap the transport in a flasher WITHOUT booting the stub — to reuse one already running. */
export function attachFlasher(transport: SwdTransport): GnwFlasher {
  return new GnwFlasher(transport);
}

/** Passively detect an already-running gnwmanager RAM util: its mailbox STATUS reads back
 *  as STATUS_IDLE. This is a single RAM read (the mailbox lives in SRAM), so it's safe while
 *  the firmware is freely running — no halt, no reset. Returns false on any read error. */
export async function isStubAlive(transport: SwdTransport): Promise<boolean> {
  try {
    return ((await transport.readWord(MAILBOX_ADDR)) >>> 0) === STATUS_IDLE;
  } catch {
    return false;
  }
}

/** SCB CPUID — a FIXED Cortex-M7 constant. We validate its value (not just "did the read
 *  succeed") because a disconnected SWD target often returns garbage that reads as success
 *  rather than throwing. */
const CPUID_ADDR = 0xe000ed00;

/** Liveness ping: read the CPUID and confirm it's our Cortex-M7 (ARM implementer 0x41 +
 *  part number 0xC27). True = target genuinely responding; false = gone (read threw, hung,
 *  OR returned garbage that doesn't match the known CPUID). Safe while anything is running. */
export async function pingTarget(transport: SwdTransport): Promise<boolean> {
  try {
    const id = (await transport.readWord(CPUID_ADDR)) >>> 0;
    return (id >>> 24) === 0x41 && ((id >>> 4) & 0xfff) === 0xc27;
  } catch {
    return false;
  }
}

export async function readInfo(flasher: GnwFlasher, log?: LogFn): Promise<DeviceInfo> {
  return flasher.info({ log });
}

/**
 * Flash an image. Bank 0=ext, 1=bank1, 2=bank2. By default the transfer is
 * LZMA-compressed and host-side buffer read-back verify is on; Advanced mode's
 * "Transfer options" can toggle both (compress off → raw transfer).
 */
export async function flashImage(
  flasherOrGetter: GnwFlasher | ((forceReboot?: boolean) => Promise<GnwFlasher>),
  bank: number,
  offset: number,
  data: Uint8Array,
  onProgress?: ProgressFn,
  log?: LogFn,
  opts: {
    compress?: boolean;
    verify?: boolean;
    abortSignal?: AbortSignal;
    /** How long to wait for the store's reconnect after a mid-flash USB drop. Injectable so a
     *  suite can exercise the retry without sleeping through it. */
    reconnectWaitMs?: number;
  } = {},
): Promise<void> {
  const compress = opts.compress ?? true;
  // Default off — the device's own hash check + chunk-retry handshake already catch
  // transport corruption; a forced per-chunk read-back roughly triples WebUSB transaction
  // count per transfer for no real benefit (see gnw-flasher's program()/writeVerified()).
  const verify = opts.verify ?? false;
  if (compress) await preloadLzma();

  const maxAttempts = 3; // Initial + 2 retries
  // A dropped link spends its own budget, not the retry budget above: the two failures are
  // different (a wedged stub versus a handle that went away), and one must not exhaust the
  // other. 8 s is chosen to outlast the store's own reconnect cadence after a re-enumeration.
  // 2 was enough when only a FLASH could report a dead handle. Acquiring a flasher can now
  // report one too (it resets the target and writes the stub, so it needs the link as much as
  // the flash does), and a single real drop therefore costs several: one for the flash that
  // noticed, then one for each acquisition attempted while the link was still coming back.
  // At 8 s a go this is up to ~40 s of patience for a re-enumeration, which is the thing being
  // waited for; the budget's job is only to stop spinning forever on a handle nothing reopens.
  const MAX_DEAD_HANDLE_RETRIES = 5;
  const RECONNECT_WAIT_MS = opts.reconnectWaitMs ?? 8000;
  let deadHandleRetries = 0;
  /**
   * Force a FRESH stub on the next attempt, independently of `attempt`.
   *
   * THE BUG THIS FIXES. A dead-handle retry does `attempt--`, deliberately, so a dropped link
   * does not spend the wedged-stub budget. But the getter is called as `flasherOrGetter(attempt
   * > 1)`, so decrementing back to 1 also cleared the force flag -- and the one case that most
   * needs a new stub asked for the cached one, which is bound to the USBDevice that just
   * closed. The store duly answered "reusing cached flasher (alive + context free)" and the
   * retry failed instantly with "The device must be opened first", twice, and then the install
   * failed. Seen in an uninstall: three attempts, three identical instant failures.
   *
   * The two reasons to want a new flasher are different and must be tracked separately: a
   * WEDGED stub (spend an attempt) and a DEAD HANDLE (do not, but do get a new handle).
   */
  let forceFreshStub = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let lastProgressTime = Date.now();
    const progressWrapper = (done: number, total: number) => {
      lastProgressTime = Date.now();
      onProgress?.(done, total);
    };

    try {
      // ACQUIRED INSIDE THE TRY, and that placement is the whole point.
      //
      // Getting a flasher is itself a device operation: forcing a fresh stub resets the target
      // and writes 48 KB over the link. On a handle that has just closed, that throws the same
      // dead-handle error a flash would -- and sitting outside the try, it escaped the very
      // handler that exists for it, so the install failed on the FIRST drop with one retry line
      // logged and no second attempt. Inside, a drop while acquiring is just another dead
      // handle: wait, and try for a new one.
      let flasher: GnwFlasher;
      if (typeof flasherOrGetter === "function") {
        flasher = await flasherOrGetter(attempt > 1 || forceFreshStub);
        forceFreshStub = false;
      } else {
        flasher = flasherOrGetter;
      }

      // Erase/program status is reported independently of byte-progress callbacks. An erase
      // can legitimately take longer than the host progress watchdog interval, so status
      // traffic must count as liveness; otherwise the watchdog aborts a healthy erase and the
      // retry path resets the device before the first block completes.
      const flashLog = (line: string) => {
        lastProgressTime = Date.now();
        log?.(line);
      };
      const flashPromise = flasher.flash(bank, offset, data, {
        compress: compress ? (d) => {
          const res = lzmaCompress(d);
          lastProgressTime = Date.now();
          return res;
        } : undefined,
        verify,
        onProgress: progressWrapper,
        abortSignal: opts.abortSignal,
        log: flashLog,
      });

      // Keep this host-side guard at the same 15-second no-progress budget as the
      // flasher's waitForIdle() guard. It is only a backstop for a transport call that
      // never returns; normal phase progress resets lastProgressTime.
      let intervalId: any;
      const watchdogPromise = new Promise<void>((_, reject) => {
        intervalId = setInterval(() => {
          if (Date.now() - lastProgressTime > FLASH_STALL_MS) {
            clearInterval(intervalId);
            log?.(`[flashtrace] host watchdog fired after ${FLASH_STALL_MS / 1000}s without progress`);
            reject(new Error(`Flash stalled for ${FLASH_STALL_MS / 1000} seconds without progress (WebUSB lockup).`));
          }
        }, 1000);
      });

      // Clear watchdog when the flash settles (success or error).
      // The trailing `.catch` is load-bearing: `.finally()` returns a NEW promise that
      // rejects whenever flashPromise does, and nothing awaits that one — the `await
      // Promise.race(...)` below handles flashPromise itself, not this derivative. Without
      // it every failed flash raised an unhandled rejection (a console error in the browser,
      // a hard process crash under node, which is how the flashretry suite found it).
      flashPromise.finally(() => clearInterval(intervalId)).catch(() => {});

      await Promise.race([flashPromise, watchdogPromise]);

      // Allow ST-Link clone USB bulk endpoints to settle before the next operation
      await new Promise(r => setTimeout(r, 500));
      return; // Success
    } catch (e) {
      // A FlashVerifyError has ALREADY spent its own 3-attempt per-block budget inside
      // program() (see gnw-flasher's MAX_FLASH_HASH_ATTEMPTS). Letting this outer loop
      // retry it too would multiply to 9 attempts and, worse, force a stub reboot (device
      // reset) between each — for a failure the device has told us three times is real.
      // Rethrow so the caller can render the affected blocks.
      if (e instanceof FlashVerifyError) throw e;
      // A closed USBDevice handle is not retryable ON THE SAME FLASHER: that socket can never
      // answer again. It IS retryable once a NEW one exists, and that distinction matters,
      // because the common way to get here is a genuine mid-flash USB drop, after which the
      // store tears down and reconnects on its own. Throwing immediately turned a recoverable
      // reconnect into a failed install -- seen mid-FrogFS-write, at the second chunk.
      //
      // So: with a getter, wait for the reconnect and force a fresh stub. The budget is its
      // own and small, because the failure this guards against is spinning forever on a handle
      // nothing will reopen. Without a getter there is no new flasher to be had, so the old
      // behaviour stands.
      if (isDeadHandleError(e)) {
        if (typeof flasherOrGetter !== "function" || deadHandleRetries >= MAX_DEAD_HANDLE_RETRIES) throw e;
        deadHandleRetries++;
        log?.(`The USB handle closed mid-flash. Waiting for the link, then retrying (${deadHandleRetries}/${MAX_DEAD_HANDLE_RETRIES}).`);
        await new Promise((r) => setTimeout(r, RECONNECT_WAIT_MS));
        attempt--; // a dropped link is not a failed attempt; it spends its own budget
        // ...but it DOES need a new stub: the cached one points at the handle that just closed.
        // `attempt--` alone would ask for the cached flasher again (see `forceFreshStub`).
        forceFreshStub = true;
        continue;
      }
      if (opts.abortSignal?.aborted || attempt >= maxAttempts || typeof flasherOrGetter !== "function") {
        throw e;
      }
      log?.(`Flash attempt ${attempt} failed: ${e instanceof Error ? e.message : String(e)}`);
      log?.("Restarting RAM flasher util and retrying...");
    }
  }
}

export async function dumpRegion(
  flasher: GnwFlasher,
  bank: number,
  offset: number,
  size: number,
  onProgress?: ProgressFn,
): Promise<Uint8Array> {
  return flasher.readFlash(bank, offset, size, onProgress);
}
