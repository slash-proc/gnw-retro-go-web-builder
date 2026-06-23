/**
 * Dependency-free zip reader (stored + deflate) using the browser's native
 * `DecompressionStream` — no fflate, keeping the no-bundler-deps rule.
 *
 * Our artifact bundles are simple zips (produced by Python `zipfile`: deflate,
 * no zip64). Sizes/offsets are read from the **central directory**, so entries
 * written with a data descriptor are handled correctly. Returns a map of
 * `path → bytes` (directory entries skipped). Validated against the real
 * CI-produced web-artifacts.zip.
 */

const SIG_EOCD = 0x06054b50; // end of central directory
const SIG_CDH = 0x02014b50; // central directory file header

async function inflateRaw(comp: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  // .slice().buffer → a freshly-allocated ArrayBuffer (unambiguous BodyInit,
  // sidestepping the Uint8Array<ArrayBufferLike> vs <ArrayBuffer> generic).
  const stream = new Response(comp.slice().buffer).body!.pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Find the EOCD record by scanning backwards (comment is normally empty).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip (no end-of-central-directory)");

  const count = dv.getUint16(eocd + 10, true);
  let cd = dv.getUint32(eocd + 16, true);

  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(cd, true) !== SIG_CDH) throw new Error("corrupt central directory");
    const method = dv.getUint16(cd + 10, true);
    const compSize = dv.getUint32(cd + 20, true);
    const nameLen = dv.getUint16(cd + 28, true);
    const extraLen = dv.getUint16(cd + 30, true);
    const commentLen = dv.getUint16(cd + 32, true);
    const localOff = dv.getUint32(cd + 42, true);
    const name = dec.decode(buf.subarray(cd + 46, cd + 46 + nameLen));

    // Locate the compressed data: skip the local header (30) + its name + extra.
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(start, start + compSize);

    let data: Uint8Array;
    if (method === 0) data = comp.slice();
    else if (method === 8) data = await inflateRaw(comp);
    else throw new Error(`unsupported zip compression method ${method} for ${name}`);

    if (!name.endsWith("/")) out.set(name, data);
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
