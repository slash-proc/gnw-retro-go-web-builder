// LZMA1 compressor for the gnwmanager flash path, backed by the vendored
// (patched, 16 KiB dict) LZMA-JS loaded as the window.LZMA global. Produces the
// raw LZMA1 stream the device decoder expects: lc=3/lp=0/pb=2, 16 KiB dict,
// end-of-stream marker, with the 13-byte .lzma header stripped. See PLAN.md §"L2".

/**
 * Compress to a raw LZMA1 stream (device-compatible).
 * @param {Uint8Array} data
 * @returns {Uint8Array} raw stream (no .lzma header)
 */
export function lzmaCompress(data) {
  const LZMA = window.LZMA;
  if (!LZMA) throw new Error("LZMA-JS (window.LZMA) not loaded — check the vendor script tag.");
  // Mode 1 is patched to a 16 KiB dictionary. Synchronous when no callback.
  const out = LZMA.compress(data, 1);
  const full = Uint8Array.from(out, (b) => b & 0xff);
  // Strip the 13-byte .lzma header (5 props + 8 size); device supplies its own.
  return full.subarray(13);
}
