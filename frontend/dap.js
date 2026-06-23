// CMSIS-DAP backend wiring: connect via dapjs, hand the CortexM to the real
// DapjsTransport from the built @gnw/swd-transport package. Requires CMSIS-DAP
// v2 (debugprobe/yapicoprobe); dapjs is the window.DAPjs UMD global loaded in
// index.html. See PLAN.md §"L1".

import { DapjsTransport } from "/packages/swd-transport/dist/index.js";
import { hex } from "./decode.js";

/** WebUSB requestDevice filter for Raspberry Pi probes (debugprobe/picoprobe). */
export const dapFilters = [{ vendorId: 0x2e8a }];

// dapjs defaults to 10 MHz SWD, which corrupts transfers over the G&W's flying
// leads. Drive it conservatively (the ST-Link backend uses 1.8 MHz). Raise only
// if your wiring is clean and you've confirmed reliability.
const SWD_CLOCK_HZ = 2_000_000;

/**
 * Connect to an already-selected CMSIS-DAP device and build a transport.
 * @param {USBDevice} device chosen via navigator.usb.requestDevice.
 * @param {HTMLElement|null} [logEl] element to stream log lines into.
 * @returns {Promise<{transport: DapjsTransport, meta: object, dispose: () => Promise<void>}>}
 */
export async function makeDapTransport(device, logEl = null) {
  const DAPjs = window.DAPjs;
  if (!DAPjs) {
    throw new Error("dapjs (window.DAPjs) not loaded — check the vendor script tag.");
  }
  const log = (msg) => {
    if (logEl) logEl.appendChild(Object.assign(document.createElement("div"), { textContent: msg }));
  };

  const cortexM = new DAPjs.CortexM(new DAPjs.WebUSB(device));
  // Override dapjs's 10 MHz default before connect() sends DAP_SWJ_Clock.
  cortexM.clockFrequency = SWD_CLOCK_HZ;
  log(`Connecting to ${device.productName || "CMSIS-DAP device"} at ${SWD_CLOCK_HZ / 1e6} MHz SWD…`);
  await cortexM.connect();

  let debugPortCoreId = null;
  try {
    debugPortCoreId = hex(await cortexM.readDP(0)); // DPIDR
  } catch (e) {
    log("Could not read DPIDR: " + e);
  }

  const meta = {
    probe: "CMSIS-DAP (debugprobe)",
    probeName: device.productName || null,
    targetVoltage: null, // not surfaced by dapjs CMSIS-DAP path
    debugPortCoreId,
  };

  return {
    transport: new DapjsTransport(cortexM),
    meta,
    dispose: () => cortexM.disconnect().catch(() => {}),
  };
}
