/**
 * Host-side external-flash partition scan over SWD.
 *
 * A faithful port of gnwmanager's on-device `gnwmanager_action_scan_geometry`
 * (branch autodetect-lfs-partition-geometry, Core/Src/gnwmanager.c) — SAME signatures
 * and SAME multi-stride walk — but run entirely host-side, reading raw flash through
 * the debug connection instead of executing on the device. This mirrors how gnwmanager
 * already drives LittleFS: the device exposes raw flash; all filesystem/partition
 * recognition happens on the host. We do NOT depend on gnwmanager delivering geometry.
 *
 * The on-device scanner reads memory-mapped extflash at 0x90000000 + phys_addr; here
 * each such read is a `read(phys_addr, len)` over SWD (extflash bank, base 0x90000000).
 */

/** A filesystem a future gnwmanager-style browser can mount in-place. */
export type FsKind = "littlefs" | "frogfs" | "fat";

export interface ExtPartition {
  /** Physical extflash offset (0 == 0x90000000). */
  offset: number;
  /** Size in bytes. */
  size: number;
  /** gnwmanager's type label, e.g. "LittleFS", "FrogFS", "FAT", "Mario OFW",
   *  "Zelda Assets", "Mario Pat(Int)". */
  type: string;
  /** Mountable filesystem kind, when this partition is a browsable FS. Lets the
   *  future file browser mount it directly from the scan output. */
  fs?: FsKind;
  /** FS-specific geometry captured during the scan (no extra reads): LittleFS
   *  {blockSize, blockCount}; FAT {bytesPerSector, totalSectors}; FrogFS {binSize}. */
  meta?: Record<string, number>;
}

/** Reads `len` bytes of external flash at physical `offset` (i.e. 0x90000000+offset). */
export type ExtReadFn = (offset: number, len: number) => Promise<Uint8Array>;

// 4-byte internal-flash reset-vector signatures (start of a relocated OFW backup).
const MARIO_INT_SIG = [0x30, 0x13, 0x01, 0x20];
const ZELDA_INT_SIG = [0x20, 0xb6, 0x01, 0x20];
// 8-byte asset-blob signatures.
const ZELDA_STOCK_SIG = [0x3c, 0x13, 0x96, 0xc5, 0x79, 0x38, 0x71, 0xd6];
const ZELDA_PATCHED_SIG = [0x22, 0x21, 0x23, 0x22, 0x22, 0x22, 0x22, 0x22];
const MARIO_STOCK_SIG = [0xfe, 0x6e, 0xf8, 0x01, 0x30, 0x77, 0x2d, 0x3a];
const MARIO_PATCHED_SIG = [0x78, 0xd8, 0xa9, 0x10, 0x8d, 0x00, 0x20, 0xa2];

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const eq = (b: Uint8Array, i: number, sig: number[]) => sig.every((v, k) => b[i + k] === v);
const ascii = (b: Uint8Array, i: number, s: string) =>
  [...s].every((c, k) => b[i + k] === c.charCodeAt(0));

/** is_lfs_superblock: "littlefs"@+8, disk version major 2, sane block_size/count. */
function isLfsSuperblock(b: Uint8Array): boolean {
  if (b.length < 32 || !ascii(b, 8, "littlefs")) return false;
  const version = u32(b, 20);
  const blockSize = u32(b, 24);
  const blockCount = u32(b, 28);
  return version >>> 16 === 2 && blockSize >= 128 && blockSize <= 8192 && blockCount > 0;
}

/**
 * Scan the external flash for partitions. `flashSize` is the chip size in bytes
 * (from the mainline mailbox, info().externalFlashSizeBytes). `read` reads raw
 * extflash. Returns partitions in discovery order (matches gnwmanager).
 */
export async function scanExtflashPartitions(
  read: ExtReadFn,
  flashSize: number,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtPartition[]> {
  // 32-byte read cache (lfs neighbour probes hit ±4096; the walk re-reads anchors).
  const cache = new Map<number, Uint8Array>();
  const readCached = async (off: number, len: number): Promise<Uint8Array | null> => {
    if (off < 0 || off + len > flashSize) return null;
    const key = off * 8 + len;
    let v = cache.get(key);
    if (!v) {
      v = await read(off, len);
      cache.set(key, v);
    }
    return v;
  };
  const lfsAt = async (off: number): Promise<Uint8Array | null> => {
    const b = await readCached(off, 32);
    return b && isLfsSuperblock(b) ? b : null;
  };

  const parts: ExtPartition[] = [];
  const add = (p: ExtPartition) => {
    if (!parts.some((q) => q.offset === p.offset && q.size === p.size)) parts.push(p);
  };

  const strides = [1 << 20, 512 << 10, 256 << 10, 128 << 10];
  // Probe-point count (after geometric skip) for progress.
  const total = Math.floor(flashSize / strides[strides.length - 1]) + strides.length;
  let done = 0;

  for (let s = 0; s < strides.length; s++) {
    const stride = strides[s];
    for (let addr = 0; addr <= flashSize; addr += stride) {
      // Geometric skip: addresses already visited by a 2× larger stride.
      if (stride < 1 << 20 && addr % (stride * 2) === 0) continue;
      onProgress?.(Math.min(++done, total), total);

      // --- LittleFS (forward: superblock at addr; or +4096 anchor) ---
      let isLfs = false;
      const fwd = await lfsAt(addr);
      if (fwd) {
        isLfs = true;
        let anchorOff = addr;
        let block = fwd;
        const nxt = await lfsAt(addr + 4096);
        if (nxt) {
          anchorOff = addr + 4096;
          block = nxt;
        }
        addLfsPartition(add, anchorOff, block, flashSize);
      } else {
        // --- LittleFS (inverted: superblock at addr-4096) ---
        const inv = addr >= 4096 ? await lfsAt(addr - 4096) : null;
        if (inv) {
          isLfs = true;
          addLfsPartition(add, addr - 4096, inv, flashSize);
        }
      }
      if (isLfs) continue;

      // Coverage skip: inside an already-found partition.
      // We skip if we are inside a known partition's bounds, EXCEPT on the 1MB sweep,
      // where we want to unconditionally probe for ghost partitions. We still skip 
      // if addr exactly equals a known partition's offset to avoid duplicates.
      const isInside = parts.some((p) => addr >= p.offset && addr < p.offset + p.size);
      const isExact = parts.some((p) => addr === p.offset);
      if (isExact || (isInside && stride < (1 << 20))) continue;

      const sec = await readCached(addr, 512);
      if (!sec) continue;

      // --- FAT ---
      if (sec[510] === 0x55 && sec[511] === 0xaa && (sec[0] === 0xeb || sec[0] === 0xe9)) {
        const bps = sec[0x0b] | (sec[0x0c] << 8);
        const tot16 = sec[0x13] | (sec[0x14] << 8);
        const tot32 = u32(sec, 0x20);
        const totalSectors = tot16 || tot32;
        if (bps >= 512 && bps <= 4096 && totalSectors)
          add({ offset: addr, size: totalSectors * bps, type: "FAT", fs: "fat", meta: { bytesPerSector: bps, totalSectors } });
      }
      // --- FrogFS ---
      else if (ascii(sec, 0, "FROG")) {
        const binSize = u32(sec, 8);
        add({ offset: addr, size: binSize, type: "FrogFS", fs: "frogfs", meta: { binSize } });
      }
      // --- Internal-flash backup (128 KiB), stock vs patched via last byte ---
      else if (addr + 131072 <= flashSize && (eq(sec, 0, MARIO_INT_SIG) || eq(sec, 0, ZELDA_INT_SIG))) {
        // last byte (131071) decides stock vs patched; read it as a 4-aligned word
        // (the transport requires 4-byte-aligned reads) — byte 131071 is index 3.
        const w = await readCached(addr + 131068, 4);
        const patched = !!w && w[3] !== 0xff;
        const dev = eq(sec, 0, MARIO_INT_SIG) ? "Mario" : "Zelda";
        add({ offset: addr, size: 131072, type: `${dev} ${patched ? "Pat(Int)" : "OFW (Int)"}` });
      }
      // --- Asset blobs (stock OFW vs patched assets) ---
      else if (eq(sec, 0, ZELDA_STOCK_SIG) && addr + 4 * (1 << 20) <= flashSize) {
        add({ offset: addr, size: 4 << 20, type: "Zelda OFW" });
      } else if (eq(sec, 0, ZELDA_PATCHED_SIG) && addr >= 0x20000 && addr - 0x20000 + 4 * (1 << 20) <= flashSize) {
        add({ offset: addr - 0x20000, size: 4 << 20, type: "Zelda Assets" });
      } else if (eq(sec, 0, MARIO_STOCK_SIG) && addr + (1 << 20) <= flashSize) {
        add({ offset: addr, size: 1 << 20, type: "Mario OFW" });
      } else if (eq(sec, 0, MARIO_PATCHED_SIG) && addr + (1 << 20) <= flashSize) {
        add({ offset: addr, size: 1 << 20, type: "Mario Assets" });
      }
    }
  }
  return parts;
}

/** Derive a LittleFS partition from a superblock anchor (mirrors the C size math). */
function addLfsPartition(
  add: (p: ExtPartition) => void,
  anchorOff: number,
  block: Uint8Array,
  flashSize: number,
): void {
  const bsize = u32(block, 24);
  const bcount = u32(block, 28);
  const pSize = bsize * bcount;
  if (pSize > 0 && bsize > 0 && pSize <= flashSize && anchorOff + bsize >= pSize) {
    const pStart = anchorOff + bsize - pSize;
    if (pStart + pSize <= flashSize && pStart % 4096 === 0)
      add({ offset: pStart, size: pSize, type: "LittleFS", fs: "littlefs", meta: { blockSize: bsize, blockCount: bcount } });
  }
}

export async function readFrogfsState(
  read: ExtReadFn,
  offset: number,
  size: number
): Promise<{ order: string[]; dataStart: number }> {
  // Read the first 64KB, which is more than enough to cover the FrogFS head, 
  // hash table, and all file headers for a typical installation. 
  // Doing a single bulk read prevents hundreds of individual WebUSB requests.
  const MAX_HEADER_READ = 65536;
  const raw = await read(offset, Math.min(size, MAX_HEADER_READ));
  
  if (!ascii(raw, 0, "FROG")) return { order: [], dataStart: 0 };
  const numFiles = u16(raw, 6);
  if (numFiles === 0 || numFiles > 10000) return { order: [], dataStart: 0 };

  const hashDataOffs = 12;
  const hashSize = numFiles * 8;
  if (hashDataOffs + hashSize > raw.length) return { order: [], dataStart: 0 }; // Exceeded buffer

  let dataStart = size;
  const files: { dest: string; dataOffs: number }[] = [];
  const utf8 = new TextDecoder();

  const getPath = (headerOffs: number): string => {
    if (headerOffs === 0 || headerOffs + 16 > raw.length) return "";
    const nameLen = raw[headerOffs + 6];
    if (headerOffs + 16 + nameLen > raw.length) return "";
    
    const nameData = raw.subarray(headerOffs + 16, headerOffs + 16 + nameLen);
    const name = utf8.decode(nameData);
    
    const parentOffs = u32(raw, headerOffs);
    if (parentOffs === 0) return name;
    const parentPath = getPath(parentOffs);
    return parentPath ? `${parentPath}/${name}` : name;
  };

  for (let i = 0; i < numFiles; i++) {
    const headerOffs = u32(raw, hashDataOffs + i * 8 + 4);
    if (headerOffs === 0 || headerOffs + 16 > raw.length) continue;

    const childCount = u16(raw, headerOffs + 4);
    const dataOffs = u32(raw, headerOffs + 8);

    if (childCount === 0xFFFF) { // FILE_CHILD_COUNT
      if (dataOffs > 0 && dataOffs < dataStart) dataStart = dataOffs;
      const path = getPath(headerOffs);
      if (path) files.push({ dest: path, dataOffs });
    }
  }

  files.sort((a, b) => a.dataOffs - b.dataOffs);
  return { order: files.map(f => f.dest), dataStart: dataStart === size ? 0 : dataStart };
}
