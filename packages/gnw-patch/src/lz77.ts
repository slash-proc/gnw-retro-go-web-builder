/**
 * LZ77 decompression for the rwdata initialization tables — a 1:1 port of
 * gnwmanager's `compression.lz77_decompress` (cli/gnw_patch/compression.py).
 * Custom opcode format; used by RWData to decode the stock init data.
 */
export function lz77Decompress(data: Uint8Array): Uint8Array {
  let index = 0;
  const out: number[] = [];

  while (index < data.length) {
    const opcode = data[index];
    index += 1;

    let directLen = opcode & 0x03;
    let offset256 = (opcode >> 2) & 0x03;
    let patternLen = opcode >> 4;

    if (directLen === 0) {
      directLen = data[index] + 3;
      index += 1;
    }
    directLen -= 1;

    if (patternLen === 0xf) {
      patternLen += data[index];
      index += 1;
    }

    // Direct copy
    for (let i = 0; i < directLen; i++) {
      out.push(data[index]);
      index += 1;
    }

    // Pattern replay
    if (patternLen > 0) {
      const offsetAdd = data[index];
      index += 1;

      if (offset256 === 0x03) {
        offset256 = data[index];
        index += 1;
      }

      const offset = offsetAdd + offset256 * 256;
      for (let i = 0; i < patternLen + 2; i++) {
        out.push(out[out.length - offset]);
      }
    }
  }

  return Uint8Array.from(out);
}
