// gnwmanager flows: connect a probe, boot the RAM util on the device, and run
// an operation against it (info / flash / dump). Exercises the full stack —
// SwdTransport (L1) + GnwFlasher (L2). See PLAN.md §"L2".

import { connectProbe } from "./probe.js";
import { GnwFlasher } from "/packages/gnw-flasher/dist/index.js";

const FIRMWARE_URL = "/packages/gnw-flasher/blobs/firmware.bin";

const makeLog = (logEl) => (msg) => {
  if (logEl) logEl.appendChild(Object.assign(document.createElement("div"), { textContent: msg }));
};

/**
 * Connect a probe, boot the gnwmanager stub, and run `fn(flasher, meta, log)`.
 * Releases the probe afterwards.
 * @param {HTMLElement|null} logEl
 * @param {(flasher: GnwFlasher, meta: object, log: (m:string)=>void) => Promise<any>} fn
 */
export async function withStub(logEl, fn) {
  const log = makeLog(logEl);
  const { transport, meta, dispose } = await connectProbe(logEl);
  try {
    log(`Fetching ${FIRMWARE_URL}…`);
    const resp = await fetch(FIRMWARE_URL);
    if (!resp.ok) throw new Error(`failed to fetch firmware.bin: HTTP ${resp.status}`);
    const firmware = new Uint8Array(await resp.arrayBuffer());

    const flasher = new GnwFlasher(transport);
    log(`Booting ${firmware.length}-byte RAM util…`);
    await flasher.startStub(firmware, { timeoutMs: 10000, log });
    log("Stub IDLE.");
    return await fn(flasher, meta, log);
  } finally {
    await dispose?.();
  }
}

/** Boot the stub and return `gnwmanager info`-style device details. */
export async function gnwInfo(logEl = null) {
  return withStub(logEl, async (flasher, meta, log) => {
    const info = await flasher.info({ log });
    return { probe: meta.probe, probeName: meta.probeName, ...info };
  });
}
