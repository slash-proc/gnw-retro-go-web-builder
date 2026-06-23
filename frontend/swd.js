// ST-Link v2 backend wiring: attach via webstlink, hand the low-level Stlinkv2
// to the real WebStlinkTransport from the built @gnw/swd-transport package.
// The browser-specific attach lives here; the reusable SWD logic lives in the
// package. See PLAN.md §"L1" and the project plan.

import WebStlink from "./vendor/webstlink/src/webstlink.js";
import * as libstlink from "./vendor/webstlink/src/lib/package.js";
import { WebStlinkTransport } from "/packages/swd-transport/dist/index.js";
import { hex } from "./decode.js";

/** WebUSB requestDevice filters that match ST-Link probes (VID 0x0483). */
export const stlinkFilters = libstlink.usb.filters;

/**
 * Attach to an already-selected ST-Link device and build a transport.
 * @param {USBDevice} device chosen via navigator.usb.requestDevice.
 * @param {HTMLElement|null} [logEl] element webstlink streams log lines into.
 * @returns {Promise<{transport: WebStlinkTransport, meta: object, dispose: () => Promise<void>}>}
 */
export async function makeStlinkTransport(device, logEl = null) {
  const logger = new libstlink.Logger(2, logEl);
  const stlink = new WebStlink(logger);
  await stlink.attach(device, logger);

  const ll = stlink._stlink; // low-level Stlinkv2
  const meta = {
    probe: "ST-Link v2",
    probeName: ll.ver_str,
    targetVoltage: ll.target_voltage != null ? Number(ll.target_voltage.toFixed(2)) : null,
    debugPortCoreId: hex(ll.coreid),
  };

  return {
    transport: new WebStlinkTransport(ll),
    meta,
    dispose: () => stlink.detach().catch(() => {}),
  };
}
