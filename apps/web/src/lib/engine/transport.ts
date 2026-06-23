// Probe connection: prompt for an ST-Link or CMSIS-DAP probe, build the matching
// SwdTransport. Ported from the test harness (probe/swd/dap.js).
import { DapjsTransport, WebStlinkTransport, type SwdTransport } from "@gnw/swd-transport";
import { CortexM, WebUSB } from "dapjs";
import WebStlink from "@webstlink/webstlink.js";
import * as libstlink from "@webstlink/lib/package.js";

const ST_LINK_VENDOR_ID = 0x0483;
const RASPBERRY_PI_VENDOR_ID = 0x2e8a;
// Shared SWD clock for both probe families. Out of the box dapjs runs at 10 MHz and
// the ST-Link at 1.8 MHz; 4 MHz is the ST-Link table maximum and our default for both.
// Tune here if flying leads corrupt transfers — lower is more reliable (e.g. 2_000_000).
const SWD_CLOCK_HZ = 4_000_000;

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
    readMemory: (a, l, p) => q(() => t.readMemory(a, l, p)),
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

export async function connectProbe(opts: { forcePicker?: boolean } = {}): Promise<ProbeHandle> {
  if (typeof navigator === "undefined" || !navigator.usb) {
    throw new Error("WebUSB unavailable — use Chrome, Edge, or Opera.");
  }
  const filters = [...libstlink.usb.filters, { vendorId: RASPBERRY_PI_VENDOR_ID }];
  // "Choose Adapter" forces the chooser. Otherwise auto-connect when exactly one
  // already-authorized probe is connected (the picker shows only for 0 → grant a new
  // one, or 2+ → let the user select).
  let dev: USBDevice;
  if (opts.forcePicker) {
    dev = await navigator.usb.requestDevice({ filters });
  } else {
    const known = (await navigator.usb.getDevices()).filter((d) => matchesFilters(d, filters));
    dev = known.length === 1 ? known[0] : await navigator.usb.requestDevice({ filters });
  }

  if (dev.vendorId === ST_LINK_VENDOR_ID) {
    const logger = new libstlink.Logger(1, null);
    const stlink = new WebStlink(logger);
    await stlink.attach(dev, logger);
    const ll = stlink._stlink;
    // attach() inits at the 1.8 MHz default — override to our shared SWD clock.
    await ll.set_swd_freq(SWD_CLOCK_HZ);
    return {
      transport: new WebStlinkTransport(ll),
      probeName: `ST-Link/${ll.ver_str}`,
      device: dev,
      dispose: () => stlink.detach().catch(() => {}),
    };
  }

  const cortexM = new CortexM(new WebUSB(dev));
  // @ts-expect-error dapjs exposes clockFrequency on the instance.
  cortexM.clockFrequency = SWD_CLOCK_HZ;
  await cortexM.connect();
  return {
    transport: new DapjsTransport(cortexM as never),
    probeName: dev.productName || "CMSIS-DAP",
    device: dev,
    dispose: () => cortexM.disconnect().catch(() => {}),
  };
}
