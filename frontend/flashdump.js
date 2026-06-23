// Flash a provided binary to / dump a region from intflash or extflash.
// Thin UI glue over GnwFlasher.flash() / readFlash(); see PLAN.md §"L2".

import { withStub } from "./gnw.js";
import { lzmaCompress } from "./lzma.js";

// location label → bank number (gnwmanager: 0=ext, 1=bank1, 2=bank2).
const LOCATION_BANK = { ext: 0, bank1: 1, bank2: 2 };

/**
 * Parse a size/offset. Decimal by default ("4096"); hex if prefixed ("0x1000");
 * optional k/m/g (or kb/mb/gb) binary suffix ("4k", "1m"). Empty → 0.
 */
export function parseAddr(str) {
  const s = String(str).trim().toLowerCase();
  if (s === "") return 0;
  if (s.startsWith("0x")) {
    const n = parseInt(s, 16);
    if (!Number.isFinite(n) || n < 0) throw new Error(`invalid hex number: "${str}"`);
    return n;
  }
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(kb?|mb?|gb?)?$/);
  if (!m) throw new Error(`invalid number: "${str}"`);
  const mult = { k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3 };
  return Math.round(parseFloat(m[1]) * (m[2] ? mult[m[2]] : 1));
}

/**
 * Flash a binary file to the selected location at the given offset.
 * @returns {Promise<object>} a small result summary.
 */
export async function flashBinary(
  { location, offset, file, compress = true, verify = true },
  logEl = null,
  onProgress = null,
) {
  const bank = LOCATION_BANK[location];
  if (bank === undefined) throw new Error(`unknown location: ${location}`);
  if (!file) throw new Error("no file selected");
  const off = parseAddr(offset);
  const data = new Uint8Array(await file.arrayBuffer());

  return withStub(logEl, async (flasher, _meta, log) => {
    log(`Flashing "${file.name}" (${data.length} B) → ${location} @ 0x${off.toString(16)}${compress ? " (lzma)" : ""}`);
    await flasher.flash(bank, off, data, {
      log,
      compress: compress ? lzmaCompress : undefined,
      verify,
      onProgress,
    });
    return { ok: true, location, offset: "0x" + off.toString(16), bytes: data.length, compressed: compress };
  });
}

/**
 * Dump `size` bytes from the selected location at the given offset and trigger
 * a browser download.
 * @returns {Promise<object>} a small result summary.
 */
export async function dumpRegion({ location, offset, size }, logEl = null, onProgress = null) {
  const bank = LOCATION_BANK[location];
  if (bank === undefined) throw new Error(`unknown location: ${location}`);
  const off = parseAddr(offset);
  const requested = parseAddr(size); // 0 / blank → whole region from offset

  return withStub(logEl, async (flasher, _meta, log) => {
    let len = requested;
    if (len === 0) {
      const region = await flasher.regionSize(bank);
      if (!region) throw new Error(`could not determine ${location} size (flash undetected?)`);
      len = region - off;
      if (len <= 0) throw new Error(`offset ${off} is beyond the ${location} size (${region})`);
      log(`size omitted → dumping whole region: ${len} B`);
    }
    log(`Dumping ${len} B from ${location} @ 0x${off.toString(16)}…`);
    const data = await flasher.readFlash(bank, off, len, onProgress);

    const name = `dump_${location}_0x${off.toString(16)}_${len}.bin`;
    const url = URL.createObjectURL(new Blob([data], { type: "application/octet-stream" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    log(`Saved ${name} (${data.length} B).`);
    return { ok: true, location, offset: "0x" + off.toString(16), bytes: data.length, file: name };
  });
}
