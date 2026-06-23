/**
 * FrogFS image PARSER — reverse of frogfs.ts (the byte-exact mkfrogfs builder).
 *
 * Reads a raw FrogFS image's metadata (head + hashtable + entry headers) and
 * returns the file list with each file's data offset + size, WITHOUT needing the
 * file data to be present. That lets the on-device reader fetch only the small
 * metadata prefix over SWD (head → hashtable → headers) instead of the whole
 * multi-MB image to learn which games are installed.
 *
 * Format (see frogfs.ts / docs/FROGFS.md):
 *   head      @0                 : <IBBHI magic,ver_major,ver_minor,num_ent,bin_sz   (12 B)
 *   hashtable @align(12)         : num_ent × <II hash,header_offs                     (8 B each)
 *   headers   @each header_offs  : <IHBB parent,child_count,seg_sz,opts  then:
 *                                    file (child_count==0xff00): <II data_offs,data_sz then name[seg_sz]
 *                                    dir : child_offs[child_count]×<I        then name[seg_sz]
 */

const FROGFS_MAGIC = 0x474f5246; // "FROG"
const HEAD_SIZE = 12;
const HASH_SIZE = 8;
const DIR_SIZE = 8;
const FILE_SIZE = 16;
const FILE_CHILD_COUNT = 0xff00;

const align = (n: number): number => ((n + 3) >>> 2) << 2;
const utf8d = new TextDecoder();

export class FrogFsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrogFsParseError";
  }
}

export interface FrogfsHead {
  magic: number;
  verMajor: number;
  verMinor: number;
  numEntries: number;
  /** Total image size in bytes (the head's bin_sz) — image self-describes its end. */
  binSize: number;
}

export interface FrogfsFile {
  /** Full POSIX path, e.g. "roms/nes/smb.nes". */
  path: string;
  /** Byte offset of the file data within the image. */
  dataOffs: number;
  /** File data length in bytes. */
  dataSize: number;
}

/** Parse just the 12-byte head. Throws on a bad magic. */
export function parseFrogfsHead(buf: Uint8Array): FrogfsHead {
  if (buf.length < HEAD_SIZE) throw new FrogFsParseError("buffer too small for FrogFS head");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = dv.getUint32(0, true);
  if (magic !== FROGFS_MAGIC) {
    throw new FrogFsParseError(`bad FrogFS magic 0x${magic.toString(16)} (expected 0x${FROGFS_MAGIC.toString(16)})`);
  }
  return {
    magic,
    verMajor: dv.getUint8(4),
    verMinor: dv.getUint8(5),
    numEntries: dv.getUint16(6, true),
    binSize: dv.getUint32(8, true),
  };
}

/** Lowest header offset needs the hashtable, which sits right after the head. */
export function hashtableOffset(): number {
  return align(HEAD_SIZE);
}

/** End of the hashtable / start of the entry-header region (caller can read up to here + headers). */
export function headersStart(numEntries: number): number {
  return align(HEAD_SIZE) + align(HASH_SIZE * numEntries);
}

interface RawEntry {
  offs: number;
  parent: number;
  isFile: boolean;
  name: string;
  dataOffs: number;
  dataSize: number;
}

/**
 * Parse a FrogFS image (or a metadata prefix that includes head + hashtable +
 * all entry headers) into its head + file list. File DATA need not be present.
 */
export function parseFrogfs(buf: Uint8Array): { head: FrogfsHead; files: FrogfsFile[] } {
  const head = parseFrogfsHead(buf);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Hashtable → every entry's header offset.
  const htOffs = hashtableOffset();
  const need = htOffs + HASH_SIZE * head.numEntries;
  if (buf.length < need) throw new FrogFsParseError("buffer too small for FrogFS hashtable");
  const headerOffsets: number[] = [];
  for (let i = 0; i < head.numEntries; i++) {
    headerOffsets.push(dv.getUint32(htOffs + i * HASH_SIZE + 4, true));
  }

  // Parse each entry header.
  const byOffs = new Map<number, RawEntry>();
  for (const offs of headerOffsets) {
    if (offs + DIR_SIZE > buf.length) throw new FrogFsParseError(`header at ${offs} past end of buffer`);
    const parent = dv.getUint32(offs, true);
    const childCount = dv.getUint16(offs + 4, true);
    const segSz = dv.getUint8(offs + 6);
    const isFile = childCount === FILE_CHILD_COUNT;
    let dataOffs = 0;
    let dataSize = 0;
    let nameAt: number;
    if (isFile) {
      dataOffs = dv.getUint32(offs + 8, true);
      dataSize = dv.getUint32(offs + 12, true);
      nameAt = offs + FILE_SIZE;
    } else {
      nameAt = offs + DIR_SIZE + 4 * childCount;
    }
    if (nameAt + segSz > buf.length) throw new FrogFsParseError(`entry name at ${offs} past end of buffer`);
    const name = utf8d.decode(buf.subarray(nameAt, nameAt + segSz));
    byOffs.set(offs, { offs, parent, isFile, name, dataOffs, dataSize });
  }

  // Reconstruct full paths by walking the parent chain (parent==0 ⇒ root, name "").
  const pathOf = (e: RawEntry): string => {
    const segs: string[] = [];
    let cur: RawEntry | undefined = e;
    const guard = new Set<number>();
    while (cur && cur.parent !== 0) {
      if (guard.has(cur.offs)) throw new FrogFsParseError("cycle in FrogFS parent chain");
      guard.add(cur.offs);
      if (cur.name) segs.push(cur.name);
      cur = byOffs.get(cur.parent);
    }
    return segs.reverse().join("/");
  };

  const files: FrogfsFile[] = [];
  for (const e of byOffs.values()) {
    if (e.isFile) files.push({ path: pathOf(e), dataOffs: e.dataOffs, dataSize: e.dataSize });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { head, files };
}
