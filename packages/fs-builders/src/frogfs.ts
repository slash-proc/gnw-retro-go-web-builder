/**
 * FrogFS image builder — byte-exact with retro-go's `mkfrogfs.py` (raw path).
 *
 * retro-go-sd compiles only `decomp_raw.c`, so its FrogFS images store every
 * file UNCOMPRESSED. This builder therefore implements the raw container only
 * (no zlib/heatshrink/gzip). ROM-level `.lzma` sidecars are a separate step the
 * game decodes — FrogFS just stores those bytes raw, like any other file.
 *
 * 1:1 port of `tools/mkfrogfs.py` Stage 2 + `tools/format.py` + `tools/frogfs.py`
 * (`align`/`djb2_hash`/`pad`). See docs/FROGFS.md for the format tables and the
 * builder algorithm. Validated byte-for-byte by test/frogfs.mjs vs mkfrogfs.py.
 */

// ── format.py constants ──────────────────────────────────────────────────────
const FROGFS_MAGIC = 0x474f5246; // "FROG"
const FROGFS_VER_MAJOR = 1;
const FROGFS_VER_MINOR = 0;

const HEAD_SIZE = 12; // <IBBHI  magic, ver_major, ver_minor, num_ent, bin_sz
const HASH_SIZE = 8; //  <II    hash, header_offs
const DIR_SIZE = 8; //   <IHBB  parent, child_count, seg_sz, opts
const FILE_SIZE = 16; //  <IHBBII parent, child_count, seg_sz, opts, data_offs, data_sz
const FOOT_SIZE = 4; //   <I     crc32

// child_count sentinel marking a plain (uncompressed) file entry.
const FILE_CHILD_COUNT = 0xff00;

// ── frogfs.py helpers ────────────────────────────────────────────────────────
/** Round n up to the next multiple of 4. */
function align(n: number): number {
  return ((n + 3) >>> 2) << 2;
}

/** Return a copy of `data` zero-padded up to its 4-byte alignment. */
function pad(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(align(data.length));
  out.set(data);
  return out;
}

/**
 * djb2 string hash, matching frogfs.py exactly:
 *   hash = ((hash << 5) + hash ^ c) & 0xFFFFFFFF   (Python precedence: (((h<<5)+h)^c))
 * Python uses arbitrary-precision ints then masks; replicate with float math so
 * the `<< 5` (i.e. ×32) doesn't lose bits the way JS 32-bit `<<` would.
 */
function djb2Hash(bytes: Uint8Array): number {
  let hash = 5381;
  for (const c of bytes) {
    // (hash*33) can reach ~1.4e11 — well within Number's safe-integer range.
    const mixed = (hash * 33) % 0x100000000; // == ((hash<<5)+hash) & 0xFFFFFFFF
    hash = (mixed ^ c) >>> 0; // XOR with a byte only touches low bits → exact
  }
  return hash >>> 0;
}

const utf8 = new TextEncoder();

// POSIX path helpers mirroring os.path semantics on normalized dests.
function basename(dest: string): string {
  const i = dest.lastIndexOf("/");
  return i < 0 ? dest : dest.slice(i + 1);
}
function dirname(dest: string): string {
  const i = dest.lastIndexOf("/");
  return i < 0 ? "" : dest.slice(0, i);
}
function slashCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 47) n++;
  return n;
}

interface Entry {
  type: "file" | "dir";
  name: string;
  dest: string;
  data?: Uint8Array;
  // computed during build():
  header: Uint8Array;
  headerOffs: number;
  dataOffs: number;
  dataSize: number;
  parent: Entry | null;
  children: Entry[];
}

export class FrogFsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrogFsError";
  }
}

/**
 * Builds a raw FrogFS image. Add files (ancestor dirs + root are created
 * automatically, matching mkfrogfs.collect_entries), then call build().
 */
export class FrogFsImage {
  // keyed by normalized dest, mirroring mkfrogfs's `entries` dict
  #entries = new Map<string, Entry>();

  /** Normalize like add_file(): strip leading slashes, backslashes → '/'. */
  static #normalize(dest: string): string {
    return dest.replace(/\\/g, "/").replace(/^\/+/, "");
  }

  /** Add a file at POSIX `destPath` (e.g. "roms/nes/smb.nes"). */
  addFile(destPath: string, data: Uint8Array): void {
    const dest = FrogFsImage.#normalize(destPath);
    if (dest === "" || dest.endsWith("/")) {
      throw new FrogFsError(`invalid file dest: ${JSON.stringify(destPath)}`);
    }
    this.#entries.set(dest, {
      type: "file",
      name: basename(dest),
      dest,
      data,
      header: new Uint8Array(0),
      headerOffs: 0,
      dataOffs: 0,
      dataSize: data.length,
      parent: null,
      children: [],
    });
  }

  /** Explicitly add a directory (normally implicit via addFile). */
  addDir(destPath: string): void {
    const dest = FrogFsImage.#normalize(destPath);
    this.#ensureDir(dest);
  }

  #ensureDir(dest: string): void {
    if (this.#entries.has(dest) && this.#entries.get(dest)!.type === "dir")
      return;
    this.#entries.set(dest, {
      type: "dir",
      name: basename(dest),
      dest,
      header: new Uint8Array(0),
      headerOffs: 0,
      dataOffs: 0,
      dataSize: 0,
      parent: null,
      children: [],
    });
  }

  /** Create every ancestor directory (incl. the root '') for each file. */
  #addAncestorDirs(): void {
    for (const dest of [...this.#entries.keys()]) {
      let d = dest;
      // matches: while True: d = dirname(d); add dir; if not d.rstrip('/'): break
      // (run for every entry that has at least one ancestor)
      // Note: mkfrogfs iterates over the original file set; running over all
      // present dests is equivalent because dirs only re-create themselves.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        d = dirname(d);
        this.#ensureDir(d);
        if (d.replace(/\/+$/, "") === "") break;
      }
    }
  }

  build(opts?: { previousOrder?: string[]; dataStart?: number }): Uint8Array {
    this.#addAncestorDirs();

    // entries sorted by dest string (Python `dict(sorted(entries.items()))`).
    const entries = [...this.#entries.values()].sort((a, b) =>
      a.dest < b.dest ? -1 : a.dest > b.dest ? 1 : 0,
    );
    const num = entries.length;

    // ── generate_entry_headers ──────────────────────────────────────────────
    for (const ent of entries) {
      if (ent.type === "file") ent.header = this.#fileHeader(ent);
      else ent.header = this.#dirHeader(ent, entries);
    }

    // ── append_frogfs_header (compute offsets + emit head) ───────────────────
    let bin = align(HEAD_SIZE) + align(HASH_SIZE * num);
    for (const ent of entries) {
      ent.headerOffs = bin;
      bin += align(ent.header.length);
    }
    
    // align the start of the data section to a 4KB boundary (or previous dataStart)
    // so that headers can fluctuate in size without shifting data chunks.
    if (opts?.dataStart && opts.dataStart > bin) {
      bin = opts.dataStart;
    } else {
      const padding = (4096 - (bin % 4096)) % 4096;
      bin += padding;
    }

    const dataStart = bin;
    const files = entries.filter((e) => e.type === "file");
    if (opts?.previousOrder) {
      files.sort((a, b) => {
        const idxA = opts.previousOrder!.indexOf(a.dest);
        const idxB = opts.previousOrder!.indexOf(b.dest);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.dest < b.dest ? -1 : a.dest > b.dest ? 1 : 0;
      });
    }

    for (const ent of files) {
      ent.dataOffs = bin;
      bin += align(ent.dataSize);
    }
    bin += FOOT_SIZE;

    const head = new Uint8Array(HEAD_SIZE);
    {
      const dv = new DataView(head.buffer);
      dv.setUint32(0, FROGFS_MAGIC, true);
      dv.setUint8(4, FROGFS_VER_MAJOR);
      dv.setUint8(5, FROGFS_VER_MINOR);
      dv.setUint16(6, num, true);
      dv.setUint32(8, bin, true);
    }

    // ── apply_fixups (parent / data / child offsets) ─────────────────────────
    for (const ent of entries) {
      const dv = new DataView(
        ent.header.buffer,
        ent.header.byteOffset,
        ent.header.byteLength,
      );
      if (ent.parent) dv.setUint32(0, ent.parent.headerOffs, true);
      if (ent.type === "file") {
        dv.setUint32(8, ent.dataOffs, true);
      } else {
        ent.children.forEach((child, i) => {
          dv.setUint32(DIR_SIZE + i * 4, child.headerOffs, true);
        });
      }
    }

    // ── append_hashtable (sorted by hash ascending) ──────────────────────────
    const hashed: { hash: number; offs: number }[] = [];
    const seen = new Map<number, string>();
    for (const ent of entries) {
      const h = djb2Hash(utf8.encode(ent.dest));
      if (seen.has(h)) {
        throw new FrogFsError(
          `djb2 hash collision between ${JSON.stringify(seen.get(h))} and ` +
            `${JSON.stringify(ent.dest)} (0x${h.toString(16)})`,
        );
      }
      seen.set(h, ent.dest);
      hashed.push({ hash: h, offs: ent.headerOffs });
    }
    hashed.sort((a, b) => a.hash - b.hash);

    // ── assemble: head · hashtable · headers · file-data · footer ────────────
    const chunks: Uint8Array[] = [head];
    for (const { hash, offs } of hashed) {
      const e = new Uint8Array(HASH_SIZE);
      const dv = new DataView(e.buffer);
      dv.setUint32(0, hash >>> 0, true);
      dv.setUint32(4, offs, true);
      chunks.push(e);
    }
    for (const ent of entries) chunks.push(pad(ent.header));
    
    if (dataStart > bin) {
      // Not possible since dataStart <= bin, but dataStart > header end
    }
    // we need to add padding chunk if needed!
    // Wait, the data chunks must start at dataStart.
    // Right now chunks size is head + hashes + headers.
    const currentLen = chunks.reduce((n, c) => n + c.length, 0);
    if (dataStart > currentLen) {
      chunks.push(new Uint8Array(dataStart - currentLen));
    }
    
    for (const ent of files) {
      chunks.push(pad(ent.data!));
    }

    const bodyLen = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(bodyLen + FOOT_SIZE);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    // ── append_footer: crc32 over everything so far ──────────────────────────
    const crc = crc32(out.subarray(0, bodyLen));
    new DataView(out.buffer).setUint32(bodyLen, crc >>> 0, true);
    return out;
  }

  #fileHeader(ent: Entry): Uint8Array {
    const name = utf8.encode(ent.name);
    const header = new Uint8Array(FILE_SIZE + name.length);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, 0, true); // parent (fixed up later)
    dv.setUint16(4, FILE_CHILD_COUNT, true);
    dv.setUint8(6, name.length); // seg_sz
    dv.setUint8(7, 0); // opts
    dv.setUint32(8, 0, true); // data_offs (fixed up later)
    dv.setUint32(12, ent.dataSize, true);
    header.set(name, FILE_SIZE);
    return header;
  }

  #dirHeader(dirent: Entry, entries: Entry[]): Uint8Array {
    const depth = dirent.dest === "" ? 0 : slashCount(dirent.dest) + 1;
    const seg = utf8.encode(dirent.name);

    // children = entries exactly one level under this dir (mkfrogfs order = sorted)
    const children: Entry[] = [];
    for (const ent of entries) {
      const count = slashCount(ent.dest);
      if (count !== depth || ent.dest === "") continue;
      const underRoot = count === 0 && depth === 0;
      if (underRoot || ent.dest.startsWith(dirent.dest + "/")) {
        children.push(ent);
        if (ent.dest !== "") ent.parent = dirent;
      }
    }
    dirent.children = children;

    const header = new Uint8Array(DIR_SIZE + 4 * children.length + seg.length);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, 0, true); // parent (fixed up later)
    dv.setUint16(4, children.length, true); // child_count
    dv.setUint8(6, seg.length); // seg_sz
    dv.setUint8(7, 0); // opts
    // child offset array [DIR_SIZE .. ) stays zero until apply_fixups
    header.set(seg, DIR_SIZE + 4 * children.length);
    return header;
  }
}

// ── crc32 (IEEE, matching Python zlib.crc32) ─────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++)
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
