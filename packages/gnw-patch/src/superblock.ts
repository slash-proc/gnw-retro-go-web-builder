/**
 * Layout-superblock host patcher — locates the `GnwLayoutSuperblock` baked into a
 * prebuilt retro-go FrogFS binary (any intflash bank; located by magic scan, so the
 * struct's link-address offset is irrelevant) and rewrites its fields so one binary
 * serves any extflash offset/geometry. No toolchain; mirrors the stock patcher's
 * locate-and-edit model. See docs/BINARY_PATCHING.md.
 *
 * Byte-exact with the firmware contract: the device validates
 * `crc32_le(0, struct, 0x1C) == struct.crc32`, where crc32_le is the standard
 * reflected IEEE CRC-32 (poly 0xEDB88320, init/final ~) — so we use that exactly.
 * Validated against test/superblock_oracle.py (Python zlib.crc32).
 */

export const GNW_LAYOUT_MAGIC = 0x424c5747; // "GWLB" (LE bytes 47 57 4C 42)
export const GNW_LAYOUT_VERSION = 2;
export const SUPERBLOCK_SIZE = 36;

export const FLAG_FROGFS_OFFSET = 1 << 0;
export const FLAG_EXTFLASH_SIZE = 1 << 1;
export const FLAG_RESERVED_OFFSET = 1 << 2;
export const FLAG_LITTLEFS_LENGTH = 1 << 3;

const MAGIC_LE = Uint8Array.of(0x47, 0x57, 0x4c, 0x42);

// Field byte offsets within the 32-byte struct.
const OFF_VERSION = 0x04;
const OFF_STRUCT_SIZE = 0x06;
const OFF_FROGFS_OFFSET = 0x08;
const OFF_FROGFS_LENGTH = 0x0c;
const OFF_EXTFLASH_SIZE = 0x10;
const OFF_RESERVED_OFFSET = 0x14;
const OFF_LITTLEFS_LENGTH = 0x18;
const OFF_FLAGS = 0x1c;
const OFF_CRC = 0x20; // CRC covers bytes [0x00, 0x20)

export class SuperblockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuperblockError";
  }
}

export interface SuperblockFields {
  magic: number;
  version: number;
  structSize: number;
  frogfsOffset: number;
  frogfsLength: number;
  extflashSize: number;
  reservedOffset: number;
  littlefsLength: number;
  flags: number;
  crc32: number;
}

export interface SuperblockPatch {
  /** FrogFS base = 0x90000000 + frogfsOffset (4 KiB-aligned). Sets FLAG_FROGFS_OFFSET. */
  frogfsOffset: number;
  /** Packed FrogFS image size in bytes (advisory; 0/omitted = unknown). */
  frogfsLength?: number;
  /** Total extflash size override; omit to let the device use OSPI_GetFlashSize(). */
  extflashSize?: number;
  /** Bottom-reserved bytes override; omit to let the device use OFW metadata. */
  reservedOffset?: number;
  /** LittleFS partition size (bytes); omit to let the device use linker defaults.
   * Host derives this from the detected chip size minus the FrogFS region. */
  littlefsLength?: number;
}

// ── standard reflected IEEE CRC-32 (== firmware crc32_le(0, …)) ───────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++)
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(dv: DataView, off: number): number {
  return dv.getUint32(off, true);
}

/**
 * Find the single superblock in `image` by scanning for the magic on 4-byte
 * boundaries and validating version + struct_size. Returns its byte offset.
 * Throws if zero or more than one valid candidate is found.
 */
export function locateSuperblock(image: Uint8Array): number {
  const hits: number[] = [];
  for (let i = 0; i + SUPERBLOCK_SIZE <= image.length; i += 4) {
    if (
      image[i] === MAGIC_LE[0] &&
      image[i + 1] === MAGIC_LE[1] &&
      image[i + 2] === MAGIC_LE[2] &&
      image[i + 3] === MAGIC_LE[3]
    ) {
      const dv = new DataView(image.buffer, image.byteOffset + i, SUPERBLOCK_SIZE);
      const version = dv.getUint16(OFF_VERSION, true);
      const structSize = dv.getUint16(OFF_STRUCT_SIZE, true);
      if (version >= 1 && version <= GNW_LAYOUT_VERSION && structSize >= SUPERBLOCK_SIZE) {
        hits.push(i);
      }
    }
  }
  if (hits.length === 0) throw new SuperblockError("layout superblock not found (no GWLB magic)");
  if (hits.length > 1)
    throw new SuperblockError(`multiple layout superblocks found at ${hits.map((h) => "0x" + h.toString(16)).join(", ")} — build bug`);
  return hits[0];
}

/** Decode the superblock at `off` (default: located by magic). */
export function readSuperblock(image: Uint8Array, off = locateSuperblock(image)): SuperblockFields {
  const dv = new DataView(image.buffer, image.byteOffset + off, SUPERBLOCK_SIZE);
  return {
    magic: u32(dv, 0x00),
    version: dv.getUint16(OFF_VERSION, true),
    structSize: dv.getUint16(OFF_STRUCT_SIZE, true),
    frogfsOffset: u32(dv, OFF_FROGFS_OFFSET),
    frogfsLength: u32(dv, OFF_FROGFS_LENGTH),
    extflashSize: u32(dv, OFF_EXTFLASH_SIZE),
    reservedOffset: u32(dv, OFF_RESERVED_OFFSET),
    littlefsLength: u32(dv, OFF_LITTLEFS_LENGTH),
    flags: u32(dv, OFF_FLAGS),
    crc32: u32(dv, OFF_CRC),
  };
}

/** True iff the superblock's stored crc32 matches crc32 over bytes [0x00,0x1C) —
 * exactly the check the firmware's gw_layout_valid() performs. */
export function superblockCrcValid(image: Uint8Array, off = locateSuperblock(image)): boolean {
  const computed = crc32(image.subarray(off, off + OFF_CRC));
  const got = new DataView(image.buffer, image.byteOffset + off + OFF_CRC, 4).getUint32(0, true);
  return computed === got;
}

/**
 * Return a COPY of `image` with the superblock patched: writes the given fields
 * (OR-ing in the corresponding override flags) and recomputes crc32. Pure;
 * does not mutate the input.
 */
export function patchSuperblock(image: Uint8Array, patch: SuperblockPatch): Uint8Array {
  const off = locateSuperblock(image);
  const out = image.slice();
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);

  let flags = dv.getUint32(off + OFF_FLAGS, true);

  if (!Number.isInteger(patch.frogfsOffset) || patch.frogfsOffset < 0)
    throw new SuperblockError(`invalid frogfsOffset ${patch.frogfsOffset}`);
  if (patch.frogfsOffset & 0xfff)
    throw new SuperblockError(`frogfsOffset 0x${patch.frogfsOffset.toString(16)} not 4 KiB-aligned`);
  dv.setUint32(off + OFF_FROGFS_OFFSET, patch.frogfsOffset >>> 0, true);
  flags |= FLAG_FROGFS_OFFSET;

  if (patch.frogfsLength !== undefined)
    dv.setUint32(off + OFF_FROGFS_LENGTH, patch.frogfsLength >>> 0, true);
  if (patch.extflashSize !== undefined) {
    dv.setUint32(off + OFF_EXTFLASH_SIZE, patch.extflashSize >>> 0, true);
    flags |= FLAG_EXTFLASH_SIZE;
  }
  if (patch.reservedOffset !== undefined) {
    dv.setUint32(off + OFF_RESERVED_OFFSET, patch.reservedOffset >>> 0, true);
    flags |= FLAG_RESERVED_OFFSET;
  }
  if (patch.littlefsLength !== undefined) {
    dv.setUint32(off + OFF_LITTLEFS_LENGTH, patch.littlefsLength >>> 0, true);
    flags |= FLAG_LITTLEFS_LENGTH;
  }

  dv.setUint32(off + OFF_FLAGS, flags >>> 0, true);
  const crc = crc32(out.subarray(off, off + OFF_CRC));
  dv.setUint32(off + OFF_CRC, crc >>> 0, true);
  return out;
}
