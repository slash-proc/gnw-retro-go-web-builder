/** Synchronous SHA-1 (hex) — the engine hashes inline for stock-ROM verification
 * and the compressed-memory memo, where Web Crypto's async digest won't do. */
export function sha1Hex(msg: Uint8Array): string {
  const ml = msg.length;
  const withOne = ml + 1;
  const total = withOne + ((56 - (withOne % 64) + 64) % 64) + 8;
  const data = new Uint8Array(total);
  data.set(msg);
  data[ml] = 0x80;
  const bitLen = ml * 8;
  // 64-bit big-endian length (bitLen < 2^53, high word from division).
  const hi = Math.floor(bitLen / 0x1_0000_0000);
  const lo = bitLen >>> 0;
  const dv = new DataView(data.buffer);
  dv.setUint32(total - 8, hi);
  dv.setUint32(total - 4, lo);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const hex = (x: number) => x.toString(16).padStart(8, "0");
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4);
}
