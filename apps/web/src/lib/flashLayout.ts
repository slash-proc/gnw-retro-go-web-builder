/**
 * External-flash layout computation for the Guided Setup install. Pure — no device I/O, no UI.
 *
 * ── What the firmware actually parameterises ──────────────────────────────────
 * The upstream layout knobs live in `references/game-and-watch-retro-go-sd/Makefile.common`
 * and are BUILD-time (`EXTFLASH_OFFSET`, `EXTFLASH_SIZE_MB`, `FILESYSTEM_SIZE`,
 * `EXTFLASH_TOTAL_LENGTH`, `SD_CARD`). We ship a PREBUILT firmware, so the only ones we can
 * honour at install time are those the layout superblock exposes
 * (`Core/Src/retro-go/gw_layout_superblock.c`, patched by `@gnw/gnw-patch`'s
 * `patchSuperblock`):
 *
 *   frogfs_offset   → FrogFS (content) base   = the bottom-reserved size   [patchable]
 *   frogfs_length   → packed content length                               [patchable, informational]
 *   extflash_size   → total chip bytes (overrides the runtime SFDP read)   [patchable]
 *   reserved_offset → bottom-reserved bytes (SD builds: ROM-cache floor)   [patchable]
 *   littlefs_length → read-write partition bytes, anchored at the TOP      [patchable]
 *
 * Everything else the Makefile decides — whether FrogFS is compiled in at all (`SD_CARD`),
 * the LittleFS *direction* (it always grows down from the top of extflash; see
 * `gw_layout_littlefs_top()`), the internal-flash bank layout, `EXTFLASH_FORCE_SPI` — is
 * baked into the binary and cannot be influenced here.
 *
 * ── Invariants this module must not emit a layout that breaks ────────────────
 * • `EXTFLASH_OFFSET + EXTFLASH_SIZE` must be a power of two (Makefile.common ~line 152).
 *   Our regions always span the WHOLE chip (reserved at the bottom, content in the middle,
 *   LittleFS pinned to the top), so END == the detected chip size — a power of two by
 *   construction for any real part. `layoutSupported()` reports false for a probe that says
 *   otherwise, and the caller then lets the builder size the partition itself rather than
 *   emitting a layout the firmware's own build rule would have rejected.
 * • Every boundary must be erase-block aligned, or the flash write misaligns
 *   (`planFlashLayout().aligned` in `@gnw/fs-builders`).
 * • FrogFS and LittleFS must not overlap (`planFlashLayout().fits`) — enforced here by only
 *   returning a LittleFS size that leaves at least one erase block for content, and finally
 *   by `buildFlashInstall`, which throws once the real content length is known.
 */

import { LITTLEFS_FLOOR, SAVES_HEADROOM } from "@gnw/fs-builders";
import type { ExtPartition } from "./engine/fsscan.js";

/** Chip sizes are powers of two; the Makefile's END rule depends on it (see header). */
export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * The bottom-reserved size this DEVICE already has, in bytes — not a preference.
 *
 * Preferred source is the existing FrogFS partition's own base (that is literally where a
 * previous install put the content region); otherwise the top of everything that is neither
 * FrogFS nor LittleFS — i.e. the original-firmware assets — rounded up to an erase block.
 * Lifted verbatim out of Wizard.svelte's runStep2.
 */
export function scanReservedOffset(partitions: readonly ExtPartition[], blockSize: number): number {
  const frogfsPart = partitions.find((p) => p.fs === "frogfs");
  if (frogfsPart && frogfsPart.offset % blockSize === 0) return frogfsPart.offset;
  const reservedEnd = partitions
    .filter((p) => p.fs !== "littlefs" && p.fs !== "frogfs")
    .reduce((m, p) => Math.max(m, p.offset + p.size), 0);
  return Math.ceil(reservedEnd / blockSize) * blockSize;
}

/**
 * `FILESYSTEM_SIZE` when the Makefile is left to its own devices:
 * `EXTFLASH_SIZE / 10 / 4096 * 4096` (Makefile.common ~line 163) — a tenth of the chip,
 * rounded DOWN to 4096. Reproduced exactly, including the truncating division.
 */
export function firmwareDefaultLittlefsLength(extflashSize: number): number {
  return Math.floor(extflashSize / 10 / 4096) * 4096;
}

const roundUp = (n: number, m: number) => Math.ceil(n / m) * m;

export interface LayoutInputs {
  /** Detected total external flash, bytes (`device.extFlashBytes`). */
  extflashSize: number;
  /** Erase block size, bytes (`device.info.minEraseSizeBytes`). */
  blockSize: number;
  /** Bytes the bottom region keeps (`scanReservedOffset`). */
  reservedOffset: number;
}

/**
 * The read-write (LittleFS) partition size to install with, in bytes — or null when no size
 * fits and the builder should apply its own cores+headroom sizing instead.
 *
 * Every candidate is a number that already exists somewhere authoritative: the Makefile's own
 * 10%-of-chip default, this builder's floor (`LITTLEFS_FLOOR` — our LittleFS also carries the
 * cores, which upstream's does not, so the Makefile default alone can be far too
 * small), and that floor plus the builder's saves headroom (`SAVES_HEADROOM`). The default is
 * the smallest candidate that satisfies BOTH the floor and the firmware's own default, falling
 * back to the largest that fits on a chip too small to host it. Anything that would not leave
 * at least one erase block for content is not offered — a layout `planFlashLayout()` would
 * mark `fits: false`.
 *
 * This replaces a hardcoded 8 MiB, which on an 8 MB part was the entire chip.
 */
export function defaultLittlefsLength(inp: LayoutInputs): number | null {
  if (!layoutSupported(inp.extflashSize, inp.blockSize)) return null;
  const available = inp.extflashSize - inp.reservedOffset;
  const fitting = [
    firmwareDefaultLittlefsLength(inp.extflashSize),
    LITTLEFS_FLOOR,
    LITTLEFS_FLOOR + SAVES_HEADROOM,
  ]
    .map((raw) => roundUp(raw, inp.blockSize))
    .filter((bytes) => bytes > 0 && bytes + inp.blockSize <= available)
    .sort((a, b) => a - b);
  if (fitting.length === 0) return null;
  const want = Math.max(LITTLEFS_FLOOR, firmwareDefaultLittlefsLength(inp.extflashSize));
  return fitting.find((bytes) => bytes >= want) ?? fitting[fitting.length - 1];
}

/**
 * Is a host-computed layout meaningful for this device at all?
 *
 * Requires a probed chip size that is both known and a power of two (the Makefile's END
 * rule), and an erase block size the size divides by. When this is false the install runs
 * with the builder's own defaults rather than a layout we cannot guarantee.
 */
export function layoutSupported(extflashSize: number, blockSize: number): boolean {
  return (
    extflashSize > 0 &&
    isPowerOfTwo(extflashSize) &&
    blockSize > 0 &&
    extflashSize % blockSize === 0
  );
}
