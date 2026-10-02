// Probe connection: prompt for an ST-Link or CMSIS-DAP probe, build the matching
// SwdTransport. Ported from the test harness (probe/swd/dap.js).
import { DapjsTransport, WebStlinkTransport, type SwdTransport } from "@gnw/swd-transport";
import { dbg } from "../debug.js";
import { CortexM, WebUSB } from "dapjs";
import WebStlink from "@webstlink/webstlink.js";
import * as libstlink from "@webstlink/lib/package.js";

const ST_LINK_VENDOR_ID = 0x0483;
const RASPBERRY_PI_VENDOR_ID = 0x2e8a;
// Shared SWD clock for both probe families. Out of the box dapjs runs at 10 MHz and
// the ST-Link at 1.8 MHz; 4 MHz is the default (ST-Link clamps higher requests).
// Tune here if flying leads corrupt transfers — lower is more reliable (e.g. 2_000_000).
export const DEFAULT_SWD_CLOCK_HZ = 4_000_000;

export interface ProbeHandle {
  transport: SwdTransport;
  probeName: string;
  /** The underlying WebUSB device — used to detect an adapter unplug via the
   *  navigator.usb "disconnect" event. */
  device: USBDevice;
  dispose: () => Promise<void>;
}

/**
 * Wrap a transport so every call runs through a single FIFO promise-queue and they NEVER
 * interleave at the USB level. This lets a background liveness poll share the link with
 * in-flight flash/dump ops without corrupting transactions.
 */
export interface SerialTransport extends SwdTransport {
  /** True while any queued call is still in flight (an op is using the link). Lets the
   *  liveness poll skip while a flash/dump runs, so its time-boxed ping never queues behind
   *  a long op and mistakes the wait for a lost device. */
  busy(): boolean;
  /** Set the live probe clock through the serial queue; does not persist user preference. */
  setClockFrequency(hz: number): Promise<void>;
}

export function serialTransport(t: SwdTransport): SerialTransport {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  function q<R>(fn: () => Promise<R>): Promise<R> {
    pending++;
    const run = tail.then(fn);
    tail = run.catch(() => {});
    void run.then(
      () => void pending--,
      () => void pending--,
    );
    return run;
  }
  return {
    busy: () => pending > 0,
    connect: () => q(() => t.connect()),
    setClockFrequency: (hz) => q(async () => {
      if (!t.setClockFrequency) throw new Error("This debug adapter cannot change SWD clock while connected.");
      await t.setClockFrequency(hz);
    }),
    readMemory: (a, l, p, reportProgress, requestSize) => q(() => t.readMemory(a, l, p, reportProgress, requestSize)),
    ...(t.readMemoryUnitAtWidth ? {
      readMemoryUnitAtWidth: (a: number, width: 1 | 2 | 4) => q(() => t.readMemoryUnitAtWidth!(a, width)),
    } : {}),
    writeMemory: (a, d, p) => q(() => t.writeMemory(a, d, p)),
    readWord: (a) => q(() => t.readWord(a)),
    writeWord: (a, v) => q(() => t.writeWord(a, v)),
    halt: () => q(() => t.halt()),
    resume: () => q(() => t.resume()),
    reset: () => q(() => t.reset()),
    readRegister: (n) => q(() => t.readRegister(n)),
    writeRegister: (n, v) => q(() => t.writeRegister(n, v)),
  };
}

function matchesFilters(dev: USBDevice, filters: USBDeviceFilter[]): boolean {
  return filters.some(
    (f) =>
      (f.vendorId === undefined || dev.vendorId === f.vendorId) &&
      (f.productId === undefined || dev.productId === f.productId),
  );
}

/** Return all already-authorized SWD probes without showing any UI or picker.
 *  Safe to call fire-and-forget; returns [] if WebUSB is unavailable or no
 *  trusted adapters are registered. */
export async function getKnownProbes(): Promise<USBDevice[]> {
  if (typeof navigator === "undefined" || !navigator.usb) return [];
  const filters = [...libstlink.usb.filters, { vendorId: RASPBERRY_PI_VENDOR_ID }];
  try {
    return (await navigator.usb.getDevices()).filter((d) => matchesFilters(d, filters));
  } catch {
    return [];
  }
}

/** Only requestDevice cancellation is silent; USB attachment can also throw NotFoundError. */
export class ProbePickerDismissed extends Error {}

async function requestProbe(filters: USBDeviceFilter[]): Promise<USBDevice> {
  try {
    return await navigator.usb.requestDevice({ filters });
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      throw new ProbePickerDismissed(error.message);
    }
    throw error;
  }
}

async function withTimeoutAndRetry<T>(
  action: () => Promise<T>,
  timeoutMs: number,
  retries: number,
  delayMs: number,
  onRetry?: () => Promise<void>
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const p = action();
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Adapter connection timed out")), timeoutMs)
      );
      return await Promise.race([p, timeout]);
    } catch (e) {
      lastError = e;
      if (i < retries) {
        if (onRetry) await onRetry().catch(() => {});
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

export async function connectProbe(opts: { forcePicker?: boolean; swdClockHz?: number; device?: USBDevice } = {}): Promise<ProbeHandle> {
  if (typeof navigator === "undefined" || !navigator.usb) {
    throw new Error("WebUSB unavailable — use Chrome, Edge, or Opera.");
  }
  const filters = [...libstlink.usb.filters, { vendorId: RASPBERRY_PI_VENDOR_ID }];
  // "Choose Adapter" forces the chooser. Otherwise auto-connect when exactly one
  // already-authorized probe is connected (the picker shows only for 0 → grant a new
  // one, or 2+ → let the user select).
  let dev: USBDevice;
  if (opts.device) {
    dev = opts.device;
  } else if (opts.forcePicker) {
    dev = await requestProbe(filters);
  } else {
    const known = (await navigator.usb.getDevices()).filter((d) => matchesFilters(d, filters));
    dev = known.length === 1 ? known[0] : await requestProbe(filters);
  }

  const resetDevice = async () => {
    // A hardware WebUSB reset requires the device to be open
    if (!dev.opened) await dev.open();
    await dev.reset();
  };

  if (dev.vendorId === ST_LINK_VENDOR_ID) {
    const logger = new libstlink.Logger(0, null);
    const stlink = new WebStlink(logger);
    const started = performance.now();
    dbg(`[adapter] ST-Link attach begin vid=0x${dev.vendorId.toString(16)} pid=0x${dev.productId.toString(16)} opened=${dev.opened}`);
    let phase = "attach";
    try {
      // WebUSB has no cancellation for attach's pending transfers. Racing a one-second
      // timer and then resetting/retrying leaves the original attach touching the same
      // device. Let attach settle; the store owns subsequent reconnect attempts.
      await stlink.attach(dev, logger);
      const ll = stlink._stlink;
      dbg(`[adapter] ST-Link attached version=${ll.ver_str} voltage=${ll.target_voltage} elapsed=${Math.round(performance.now() - started)}ms`);
      phase = "SWD clock";
      await ll.set_swd_freq(opts.swdClockHz ?? DEFAULT_SWD_CLOCK_HZ);
    } catch (error) {
      dbg(`[adapter] ST-Link ${phase} failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      // attach cleans up its own failures; clock selection happens after that cleanup
      // boundary, so close an attached handle before the store tries again.
      if (phase === "SWD clock") await stlink.detach().catch(() => {});
      throw error;
    }
    const ll = stlink._stlink;
    return {
      transport: new WebStlinkTransport(ll),
      probeName: `ST-Link/${ll.ver_str}`,
      device: dev,
      dispose: () => stlink.detach().catch(() => {}),
    };
  }

  let cortexM!: CortexM;
  await withTimeoutAndRetry(
    async () => {
      // The clock belongs to DAPJS's CMSIS-DAP proxy, not the CortexM instance.
      // Pass it through the constructor so connect() sends the selected SWD rate.
      cortexM = new CortexM(new WebUSB(dev), undefined, opts.swdClockHz ?? DEFAULT_SWD_CLOCK_HZ);
      await cortexM.connect();
    },
    1000,
    2,
    1000,
    resetDevice
  );

  return {
    transport: new DapjsTransport(cortexM as never, (line) => dbg(line)),
    probeName: dev.productName || "CMSIS-DAP",
    device: dev,
    dispose: () => cortexM.disconnect().catch(() => {}),
  };
}

/** Open the WebUSB chooser and return the authorized probe without touching the target. */
export async function chooseProbe(): Promise<USBDevice> {
  if (typeof navigator === "undefined" || !navigator.usb) {
    throw new Error("WebUSB unavailable — use Chrome, Edge, or Opera.");
  }
  const filters = [...libstlink.usb.filters, { vendorId: RASPBERRY_PI_VENDOR_ID }];
  return requestProbe(filters);
}
