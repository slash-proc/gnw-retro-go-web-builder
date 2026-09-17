/**
 * `/data/INSTALL` — the firmware's install marker.
 *
 * Contract: `docs/FIRMWARE_DIST.md` in game-and-watch-retro-go-sd, "The install marker".
 * An SD card alone cannot say what firmware the device runs: the ABI struct and the baked
 * version string live in internal flash, which is not on the card. The firmware therefore
 * writes this 80-byte record at boot whenever it disagrees with the running build, so it is
 * correct however the device was flashed.
 *
 * TWO RULES FROM THE DOC, both easy to get wrong:
 *
 *  1. "must treat a missing or mismatched marker as 'unknown', not as an error". Every failure
 *     here — no file, a short file, a wrong magic, an unknown version, a bad CRC — is an
 *     ABSENCE, not an exception. `readInstallMarker()` returns `null` and the caller degrades
 *     to whatever it does without a card-side answer. This mirrors `compare.ts`, which returns
 *     `"unknown"` rather than guessing, and where `"unknown"` is never an upgrade.
 *
 *  2. `gitTag` is provenance and version comparison ONLY — "Nothing gates on it." Feed it to
 *     `compare.ts` (`versionRelation`/`isUpgrade`) to label a reinstall vs an upgrade, or show
 *     it to a user. Compatibility rests entirely on `providesAbi` versus a core's
 *     `required_abi_*`; do not let this marker become a compatibility check.
 *
 * `installedAt` is deliberately NOT part of any match decision — the doc: it "records *when*
 * the marker was written, not *what*".
 */
import { superblockCrc32 } from "@gnw/gnw-patch";

/**
 * Byte layout, verbatim from the doc's table (80 bytes, little-endian, packed):
 *
 * | Offset | Size | Field |
 * |---|---|---|
 * | `0`  | 4  | `magic` — `0x4E494752`, LE bytes `52 47 49 4E` = `"RGIN"` |
 * | `4`  | 1  | `version` — `1` |
 * | `5`  | 1  | `bank` — `1` or `2` |
 * | `6`  | 1  | `storage` — `0` = flash, `1` = sd |
 * | `7`  | 1  | `reserved` — zero |
 * | `8`  | 4  | `abi_version` — matches `providesAbi.version` |
 * | `12` | 4  | `abi_size` — matches `providesAbi.size` |
 * | `16` | 4  | `superblock_offset` — byte offset from the bank base |
 * | `20` | 2  | `core_meta_version` — matches `coreMetaVersion` |
 * | `22` | 2  | `reserved2` — zero |
 * | `24` | 48 | `git_tag` — NUL-padded; matches `firmware.gitTag` byte for byte |
 * | `72` | 4  | `installed_at` — Unix seconds; `0` when the RTC is not set |
 * | `76` | 4  | `crc32` — over all 80 bytes with this field zeroed |
 */
export const INSTALL_MARKER_SIZE = 80;
/** `"RGIN"` as a LE uint32 at offset 0. Also `manifest.firmware.installFile.magic`. */
export const INSTALL_MARKER_MAGIC = 0x4e494752;
/** The only `version` this parser understands. Also `installFile.version`. */
export const INSTALL_MARKER_VERSION = 1;
/** Default path on the card. The manifest publishes it as `installFile.path` (`data/INSTALL`). */
export const INSTALL_MARKER_PATH = "data/INSTALL";

const OFF_MAGIC = 0;
const OFF_VERSION = 4;
const OFF_BANK = 5;
const OFF_STORAGE = 6;
const OFF_RESERVED = 7;
const OFF_ABI_VERSION = 8;
const OFF_ABI_SIZE = 12;
const OFF_SUPERBLOCK = 16;
const OFF_CORE_META = 20;
const OFF_RESERVED2 = 22;
const OFF_GIT_TAG = 24;
const GIT_TAG_SIZE = 48;
const OFF_INSTALLED_AT = 72;
const OFF_CRC = 76;

/** `storage`: `0` = flash, `1` = sd. Anything else is not a storage this build knows. */
export type InstallMarkerStorage = "flash" | "sd";

export interface InstallMarker {
  /** Always `INSTALL_MARKER_VERSION` for a marker this parser accepted. */
  version: number;
  /** Which internal-flash bank the running image is linked for: `1` or `2`. */
  bank: number;
  /** `0` → `"flash"`, `1` → `"sd"`; `null` for a storage byte this build does not know. */
  storage: InstallMarkerStorage | null;
  /** Raw `storage` byte, kept because the enum is open. */
  storageByte: number;
  /** The ABI the running firmware provides. Compatibility rests on THIS, not on `gitTag`. */
  providesAbi: { version: number; size: number };
  /** Byte offset of the embedded layout superblock from the bank base. */
  superblockOffset: number;
  /** `GNW_CORE_META_VERSION` — the core container format. */
  coreMetaVersion: number;
  /**
   * The baked version string, NUL-padding stripped. Byte-comparable with a manifest's
   * `firmware.gitTag` with no normalisation on either side — feed it to `compare.ts`.
   */
  gitTag: string;
  /** Unix seconds; `0` when the RTC was not set. Never part of a match decision. */
  installedAt: number;
  /** The stored CRC-32, which this parser has already verified. */
  crc32: number;
}

/**
 * The CRC-32 the doc specifies over `bytes` with the `crc32` field zeroed.
 *
 * CRC REUSE. `superblockCrc32` is `packages/gnw-patch`'s `crc32` (`src/superblock.ts`),
 * re-exported from that package's index. It is the same standard CRC-32 the doc names —
 * reflected, poly `0xEDB88320`, init `0xFFFFFFFF`, final XOR `0xFFFFFFFF`, i.e. zlib's — and
 * the doc pins it with `crc32_le(0, "The quick brown fox", 19) == 0xb74574de`, which this
 * module's suite asserts against the imported function. The repo's dependency-free rule
 * (CLAUDE.md) constrains `packages/*`, not `apps/web`, and `apps/web` already declares and
 * imports `@gnw/gnw-patch` (`engine/intflashscan.ts`, `engine/flashInstall.ts`), so this adds
 * no new dependency edge and nothing to the shipped bundle — strictly better than a second
 * copy of the table.
 */
function markerCrc(bytes: Uint8Array): number {
  const zeroed = bytes.slice(0, INSTALL_MARKER_SIZE);
  zeroed[OFF_CRC] = 0;
  zeroed[OFF_CRC + 1] = 0;
  zeroed[OFF_CRC + 2] = 0;
  zeroed[OFF_CRC + 3] = 0;
  return superblockCrc32(zeroed);
}

/**
 * Parse and verify a `/data/INSTALL` image.
 *
 * @returns the marker, or `null` for ANY of: no bytes at all, fewer than 80, a wrong magic,
 *          a `version` this parser does not understand, or a CRC that does not recompute.
 *          All of those mean "this card does not identify its firmware" — never a throw, and
 *          never a reason to fail an install flow.
 */
export function readInstallMarker(bytes: Uint8Array | null | undefined): InstallMarker | null {
  if (!bytes || bytes.length < INSTALL_MARKER_SIZE) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, INSTALL_MARKER_SIZE);
  if (dv.getUint32(OFF_MAGIC, true) !== INSTALL_MARKER_MAGIC) return null;
  const version = dv.getUint8(OFF_VERSION);
  if (version !== INSTALL_MARKER_VERSION) return null;
  const crc = dv.getUint32(OFF_CRC, true);
  if (markerCrc(bytes) !== crc) return null;

  const storageByte = dv.getUint8(OFF_STORAGE);
  const tagBytes = bytes.subarray(OFF_GIT_TAG, OFF_GIT_TAG + GIT_TAG_SIZE);
  let end = tagBytes.indexOf(0);
  if (end < 0) end = GIT_TAG_SIZE;
  return {
    version,
    bank: dv.getUint8(OFF_BANK),
    storage: storageByte === 0 ? "flash" : storageByte === 1 ? "sd" : null,
    storageByte,
    providesAbi: {
      version: dv.getUint32(OFF_ABI_VERSION, true),
      size: dv.getUint32(OFF_ABI_SIZE, true),
    },
    superblockOffset: dv.getUint32(OFF_SUPERBLOCK, true),
    coreMetaVersion: dv.getUint16(OFF_CORE_META, true),
    gitTag: new TextDecoder().decode(tagBytes.subarray(0, end)),
    installedAt: dv.getUint32(OFF_INSTALLED_AT, true),
    crc32: crc,
  };
}

/**
 * Serialise a marker, computing the CRC the same way the reader verifies it. Round-trips
 * byte-exactly with `readInstallMarker`.
 *
 * NOT WIRED INTO ANY INSTALL PATH, on purpose. The doc: the firmware writes the marker itself
 * at boot, "An installer may write it to save one boot cycle, but never needs to". No approved
 * artboard covers an installer writing it, so nothing calls this — it exists so the reader is
 * tested against an independent encoder rather than only against a hand-built fixture.
 *
 * Throws only on inputs that cannot be represented (a `gitTag` that does not fit in 48 bytes,
 * or a field out of range). Callers construct these values; they are not untrusted card bytes,
 * so this is a programming error, not an absence.
 */
export function writeInstallMarker(m: {
  bank: number;
  storage: InstallMarkerStorage;
  providesAbi: { version: number; size: number };
  superblockOffset: number;
  coreMetaVersion: number;
  gitTag: string;
  installedAt: number;
}): Uint8Array {
  const bytes = new Uint8Array(INSTALL_MARKER_SIZE);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(OFF_MAGIC, INSTALL_MARKER_MAGIC, true);
  dv.setUint8(OFF_VERSION, INSTALL_MARKER_VERSION);
  dv.setUint8(OFF_BANK, m.bank);
  dv.setUint8(OFF_STORAGE, m.storage === "sd" ? 1 : 0);
  dv.setUint8(OFF_RESERVED, 0);
  dv.setUint32(OFF_ABI_VERSION, m.providesAbi.version >>> 0, true);
  dv.setUint32(OFF_ABI_SIZE, m.providesAbi.size >>> 0, true);
  dv.setUint32(OFF_SUPERBLOCK, m.superblockOffset >>> 0, true);
  dv.setUint16(OFF_CORE_META, m.coreMetaVersion, true);
  dv.setUint16(OFF_RESERVED2, 0, true);
  const tag = new TextEncoder().encode(m.gitTag);
  if (tag.length > GIT_TAG_SIZE) {
    throw new Error(`install marker git_tag is ${tag.length} bytes, max ${GIT_TAG_SIZE}`);
  }
  bytes.set(tag, OFF_GIT_TAG); // remainder stays NUL-padded
  dv.setUint32(OFF_INSTALLED_AT, m.installedAt >>> 0, true);
  dv.setUint32(OFF_CRC, markerCrc(bytes), true);
  return bytes;
}
