// Unified probe picker. One requestDevice call lists every supported probe
// (ST-Link v2 and Raspberry Pi debugprobe/picoprobe); we route to the matching
// backend by vendor ID, build a real SwdTransport, and read device info through
// it — so the query exercises the actual @gnw/swd-transport package.

import { makeStlinkTransport, stlinkFilters } from "./swd.js";
import { makeDapTransport, dapFilters } from "./dap.js";
import { queryCoreInfo } from "./decode.js";

const ST_LINK_VENDOR_ID = 0x0483;

/**
 * Prompt for any supported probe and build a live SwdTransport. Caller owns the
 * returned `transport` and must call `dispose()` when done.
 * @param {HTMLElement|null} [logEl] element to stream log lines into.
 * @returns {Promise<{transport: object, meta: object, dispose: () => Promise<void>}>}
 */
export async function connectProbe(logEl = null) {
  if (typeof navigator === "undefined" || !navigator.usb) {
    throw new Error("WebUSB unavailable — use Chrome/Edge over http://localhost.");
  }

  // Combined filters → the browser shows both probe families in one picker.
  const filters = [...stlinkFilters, ...dapFilters];

  // Must run inside a user gesture (the click handler).
  const device = await navigator.usb.requestDevice({ filters });

  // ST-Link → webstlink backend; anything else → CMSIS-DAP (dapjs) backend.
  const make = device.vendorId === ST_LINK_VENDOR_ID ? makeStlinkTransport : makeDapTransport;
  return make(device, logEl);
}

/**
 * Prompt for a probe, read basic core/chip info, release it.
 * @param {HTMLElement|null} [logEl]
 * @returns {Promise<object>} structured device info (includes which probe answered).
 */
export async function queryDevice(logEl = null) {
  const { transport, meta, dispose } = await connectProbe(logEl);
  try {
    const info = await queryCoreInfo(transport);
    return { ...meta, ...info };
  } finally {
    await dispose?.();
  }
}
