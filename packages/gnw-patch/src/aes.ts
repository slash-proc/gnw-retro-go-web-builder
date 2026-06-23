/**
 * Minimal AES-128 block encryption (ECB primitive) for the OTFDEC keystream in
 * ExtFirmware.crypt. The patcher uses raw single-block AES encryption of a
 * counter block (Web Crypto has no ECB), so this provides exactly that.
 * Standard FIPS-197 algorithm; validated against the FIPS-197 test vector.
 */

const SBOX = new Uint8Array(256);
const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

// Build the AES S-box from first principles (multiplicative inverse + affine).
(function buildSbox() {
  const p = new Uint8Array(256);
  const inv = new Uint8Array(256);
  let x = 1;
  // Generate log/antilog tables over GF(2^8) with generator 3.
  const exp = new Uint8Array(256);
  const log = new Uint8Array(256);
  let a = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = a;
    log[a] = i;
    a ^= xtime(a); // a * 3 = a ^ (a*2)
  }
  for (let i = 0; i < 256; i++) {
    inv[i] = i === 0 ? 0 : exp[(255 - log[i]) % 255];
  }
  for (let i = 0; i < 256; i++) {
    let s = inv[i];
    let xformed = s;
    for (let j = 0; j < 4; j++) {
      s = ((s << 1) | (s >> 7)) & 0xff;
      xformed ^= s;
    }
    xformed ^= 0x63;
    SBOX[i] = xformed;
  }
  void p;
})();

function xtime(b: number): number {
  return ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff;
}

function mul(a: number, b: number): number {
  let res = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) res ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return res;
}

/** Expand a 16-byte key into 11 round keys (176 bytes). */
function expandKey(key: Uint8Array): Uint8Array {
  const w = new Uint8Array(176);
  w.set(key.subarray(0, 16));
  let bytes = 16;
  let rconIdx = 0;
  const temp = new Uint8Array(4);
  while (bytes < 176) {
    for (let i = 0; i < 4; i++) temp[i] = w[bytes - 4 + i];
    if (bytes % 16 === 0) {
      // rotate
      const t = temp[0];
      temp[0] = temp[1];
      temp[1] = temp[2];
      temp[2] = temp[3];
      temp[3] = t;
      for (let i = 0; i < 4; i++) temp[i] = SBOX[temp[i]];
      temp[0] ^= RCON[rconIdx++];
    }
    for (let i = 0; i < 4; i++) {
      w[bytes] = w[bytes - 16] ^ temp[i];
      bytes++;
    }
  }
  return w;
}

/** Encrypt one 16-byte block with AES-128. Returns a new 16-byte array. */
export function aes128EncryptBlock(roundKeys: Uint8Array, input: Uint8Array): Uint8Array {
  const s = new Uint8Array(input.subarray(0, 16));
  addRoundKey(s, roundKeys, 0);
  for (let round = 1; round < 10; round++) {
    subBytes(s);
    shiftRows(s);
    mixColumns(s);
    addRoundKey(s, roundKeys, round * 16);
  }
  subBytes(s);
  shiftRows(s);
  addRoundKey(s, roundKeys, 160);
  return s;
}

/** Convenience: expand `key` once and return a block-encrypt function. */
export function aes128Encryptor(key: Uint8Array): (block: Uint8Array) => Uint8Array {
  const rk = expandKey(key);
  return (block: Uint8Array) => aes128EncryptBlock(rk, block);
}

function addRoundKey(s: Uint8Array, rk: Uint8Array, off: number): void {
  for (let i = 0; i < 16; i++) s[i] ^= rk[off + i];
}
function subBytes(s: Uint8Array): void {
  for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
}
function shiftRows(s: Uint8Array): void {
  const t = s.slice();
  // column-major (AES state): index = col*4 + row
  for (let row = 1; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      s[col * 4 + row] = t[((col + row) % 4) * 4 + row];
    }
  }
}
function mixColumns(s: Uint8Array): void {
  for (let c = 0; c < 4; c++) {
    const i = c * 4;
    const a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
    s[i] = mul(a0, 2) ^ mul(a1, 3) ^ a2 ^ a3;
    s[i + 1] = a0 ^ mul(a1, 2) ^ mul(a2, 3) ^ a3;
    s[i + 2] = a0 ^ a1 ^ mul(a2, 2) ^ mul(a3, 3);
    s[i + 3] = mul(a0, 3) ^ a1 ^ a2 ^ mul(a3, 2);
  }
}
