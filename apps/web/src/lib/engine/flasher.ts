// Boot the gnwmanager RAM stub and run flash/dump over the live transport.
import { GnwFlasher, MAILBOX_ADDR, STATUS_IDLE, type DeviceInfo, type LogFn, type ProgressFn } from "@gnw/gnw-flasher";
import type { SwdTransport } from "@gnw/swd-transport";
import { lzmaCompress, preloadLzma } from "./lzma.js";
import firmwareUrl from "@gnw/gnw-flasher/blobs/firmware.bin?url";

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
  flasher: GnwFlasher,
  bank: number,
  offset: number,
  data: Uint8Array,
  onProgress?: ProgressFn,
  log?: LogFn,
  opts: { compress?: boolean; verify?: boolean } = {},
): Promise<void> {
  const compress = opts.compress ?? true;
  const verify = opts.verify ?? true;
  if (compress) await preloadLzma();
  await flasher.flash(bank, offset, data, {
    compress: compress ? lzmaCompress : undefined,
    verify,
    onProgress,
    log,
  });
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
