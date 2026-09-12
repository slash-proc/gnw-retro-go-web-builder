/**
 * Dependency-free zip reader (stored + deflate) using the browser's native
 * `DecompressionStream` — no fflate, keeping the no-bundler-deps rule.
 *
 * Our artifact bundles are simple zips (produced by Python `zipfile`: deflate,
 * no zip64). Sizes/offsets are read from the **central directory**, so entries
 * written with a data descriptor are handled correctly. Returns a map of
 * `path → bytes` (directory entries skipped). Validated against the real
 * CI-produced web-artifacts.zip.
 *
 * THREE ENTRY POINTS, ONE PARSER. `zipList` reads the central directory only (names, sizes,
 * method) and inflates nothing; `zipExtractOne` inflates exactly one listed entry; `unzip`
 * inflates the lot. A zipped ROM library needs the first two — the whole-archive map is the
 * wrong shape when an archive holds one ROM and you want its declared size before deciding
 * whether to spend anything on it.
 */

const SIG_EOCD = 0x06054b50; // end of central directory
const SIG_CDH = 0x02014b50; // central directory file header

/** 0xFFFFFFFF in a size/offset field means "the real value is in a zip64 extra field". */
const ZIP64_MARK = 0xffffffff;

/**
 * The central directory starts before the slice the caller read.
 *
 * Its own signal rather than a generic failure: a tail-reading caller answers this by reading
 * more, and treating it as "not a zip" would turn a fine archive with a long comment into a
 * skipped ROM.
 */
export class CentralDirectoryOutOfRange extends Error {
  constructor(readonly centralDirectoryOffset: number) {
    super(`central directory at ${centralDirectoryOffset} is before the bytes read`);
    this.name = "CentralDirectoryOutOfRange";
  }
}

/** One central-directory record. No bytes are read from the entry itself. */
export interface ZipEntry {
  /** The stored name, exactly as written (may contain `/`). */
  name: string;
  /** UNCOMPRESSED length. This is the number every size, budget and fit check wants. */
  size: number;
  compressedSize: number;
  /** 0 = stored, 8 = deflate. Anything else this reader refuses. */
  method: number;
  /** General-purpose bit 0: the entry is encrypted and cannot be read without a password. */
  encrypted: boolean;
  /** True when the name ends in `/` — a directory record, never a file. */
  isDirectory: boolean;
  localOffset: number;
}

async function inflateRaw(comp: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  // .slice().buffer → a freshly-allocated ArrayBuffer (unambiguous BodyInit,
  // sidestepping the Uint8Array<ArrayBufferLike> vs <ArrayBuffer> generic).
  const stream = new Response(comp.slice().buffer).body!.pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The central directory, and nothing else.
 *
 * Costs a scan backwards for the EOCD plus a walk of the fixed-size records, so it is
 * proportional to the NUMBER of entries rather than to their bytes: listing 375 single-entry
 * archives measures at about 1 ms, against about 360 ms to inflate the same corpus.
 *
 * Throws rather than guessing: zip64 is refused by name here instead of being read as a
 * truncated 32-bit size, which is the shape of bug that produces a plausible wrong number.
 */
export function zipList(buf: Uint8Array, baseOffset = 0): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // `baseOffset` is where `buf` starts inside the real file, so a caller that read only the TAIL
  // of an archive can still be handed absolute offsets. Every offset in a zip is file-absolute;
  // the arithmetic below is the only place that difference exists.
  const at = (abs: number): number => abs - baseOffset;

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
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === ZIP64_MARK) {
    throw new Error("zip64 archives are not supported");
  }
  if (at(cdOffset) < 0) throw new CentralDirectoryOutOfRange(cdOffset);

  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  let cd = at(cdOffset);
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(cd, true) !== SIG_CDH) throw new Error("corrupt central directory");
    const flags = dv.getUint16(cd + 8, true);
    const method = dv.getUint16(cd + 10, true);
    const compressedSize = dv.getUint32(cd + 20, true);
    const size = dv.getUint32(cd + 24, true);
    const nameLen = dv.getUint16(cd + 28, true);
    const extraLen = dv.getUint16(cd + 30, true);
    const commentLen = dv.getUint16(cd + 32, true);
    const localOffset = dv.getUint32(cd + 42, true);
    const name = dec.decode(buf.subarray(cd + 46, cd + 46 + nameLen));

    if (size === ZIP64_MARK || compressedSize === ZIP64_MARK || localOffset === ZIP64_MARK) {
      throw new Error(`zip64 archives are not supported (${name})`);
    }

    out.push({
      name,
      size,
      compressedSize,
      method,
      encrypted: (flags & 0x1) !== 0,
      isDirectory: name.endsWith("/"),
      localOffset,
    });
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Inflate exactly one listed entry. `entry` must have come from `zipList(buf)` for this `buf`. */
export async function zipExtractOne(buf: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new Error(`encrypted zip entry ${entry.name}`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Locate the compressed data: skip the local header (30) + its name + extra. The local
  // header's own name/extra lengths are read, not the central directory's: the two are allowed
  // to differ, and the local ones are what the payload actually sits behind.
  const lNameLen = dv.getUint16(entry.localOffset + 26, true);
  const lExtraLen = dv.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + lNameLen + lExtraLen;
  const comp = buf.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return comp.slice();
  if (entry.method === 8) return inflateRaw(comp);
  throw new Error(`unsupported zip compression method ${entry.method} for ${entry.name}`);
}

export async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const entry of zipList(buf)) {
    if (entry.isDirectory) continue;
    out.set(entry.name, await zipExtractOne(buf, entry));
  }
  return out;
}
