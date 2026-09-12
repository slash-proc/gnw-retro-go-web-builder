/**
 * Host-side reader for the firmware's ABI table.
 *
 * The Retro-Go SD firmware publishes a versioned function/data table for runtime-loaded
 * plugin overlays (cores, homebrew). Contract:
 * `references/game-and-watch-retro-go-sd/Core/Inc/retro-go/gw_firmware_abi.h`.
 *
 *   - The linker pins the `.firmware_abi` section to `ORIGIN(FLASH) + 0x400` — a FIXED offset
 *     from the start of whichever intflash bank the firmware lives in. Both linker scripts
 *     agree (`STM32H7B0VBTx_FLASH.ld` and `STM32H7B0VBTx_SDCARD.ld`, both at line ~731/735).
 *   - The first two words are the whole header: `uint32_t version; uint32_t size;`.
 *
 * THERE IS NO MAGIC NUMBER. The header has none — nothing but version and size — so a fixed
 * offset in a bank that holds stock OFW, an old pre-ABI Retro-Go, or erased flash would
 * otherwise hand us two arbitrary words and we would report them as an ABI. Everything below
 * exists to make that impossible: the header must be self-consistent AND the first four
 * function-pointer slots after it (memchr/memcmp/memcpy/memmem, and they are function
 * pointers in every build — they are the first fields of the struct and the ABI's own rules
 * forbid reordering) must all look like real Thumb code addresses in internal flash. Random
 * firmware bytes do not clear that bar; the cost of a false positive is a wrong compatibility
 * claim, which is worse than reporting "unknown".
 *
 * This module reads NOTHING itself: it parses a buffer the intflash bank scan already
 * downloaded (same idiom as the layout-superblock probe in `intflashscan.ts`), so learning
 * the device's ABI costs zero extra SWD transactions. See CLAUDE.md on ST-Link saturation —
 * the cheapest read is the one you don't issue.
 */

/** Offset of the `.firmware_abi` section from the start of the firmware's intflash bank. */
export const FIRMWARE_ABI_OFFSET = 0x400;

/** Header: `version` + `size`, 4 bytes each. */
const HEADER_SIZE = 8;
/** How many leading function-pointer slots are checked for plausibility. */
const PROBE_POINTERS = 4;

/** Highest `version` we will believe. The contract bumps this by one at a time from 1; a word
 *  outside this range is noise, not a firmware from the future. */
const MAX_PLAUSIBLE_VERSION = 255;
/** Highest `sizeof(gw_firmware_abi_t)` we will believe. v1 is a few hundred pointers; 16 KiB
 *  of table would be a different data structure entirely. */
const MAX_PLAUSIBLE_SIZE = 16 << 10;

/** What the device's firmware says about its own ABI. */
export interface FirmwareAbi {
  /** `GW_FIRMWARE_ABI_VERSION` this firmware was built with. */
  version: number;
  /** `sizeof(gw_firmware_abi_t)` for this build — grows as append-only fields are added. */
  size: number;
}

const u32 = (b: Uint8Array, i: number) =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** A plausible Thumb function pointer into internal flash (banks 1 and 2). */
const thumbCodePtr = (v: number) =>
  (v & 1) === 1 && (v & ~1) >= 0x08000000 && (v & ~1) < 0x08200000;

/**
 * Parse the ABI table out of `image` — the bytes of ONE intflash bank, starting at that
 * bank's base address. Returns null unless every consistency check passes; a null means
 * "this firmware does not publish an ABI we recognise", which callers must surface as
 * unknown, never as incompatible.
 */
export function parseFirmwareAbi(image: Uint8Array): FirmwareAbi | null {
  const at = FIRMWARE_ABI_OFFSET;
  if (image.length < at + HEADER_SIZE + PROBE_POINTERS * 4) return null;

  const version = u32(image, at);
  const size = u32(image, at + 4);

  if (version < 1 || version > MAX_PLAUSIBLE_VERSION) return null;
  // `size` is a `sizeof` of a struct of 4-byte-aligned members: word-aligned, and at least
  // the header it is describing.
  if (size < HEADER_SIZE || size > MAX_PLAUSIBLE_SIZE || size % 4 !== 0) return null;
  // The table must actually fit inside the bank image we read.
  if (at + size > image.length) return null;
  // …and it must contain the pointers we are about to check.
  if (size < HEADER_SIZE + PROBE_POINTERS * 4) return null;

  for (let i = 0; i < PROBE_POINTERS; i++) {
    if (!thumbCodePtr(u32(image, at + HEADER_SIZE + i * 4))) return null;
  }

  return { version, size };
}

/**
 * Is a plugin declaring `requiresAbi` loadable by a firmware publishing `abi`?
 *
 * Append-only is the whole point of the contract (gw_firmware_abi.h, "Backwards-compat
 * rules"): a plugin may run against a LARGER table than it was built for, and it may ignore
 * fields it does not know. So a newer firmware still runs an older plugin; only a plugin
 * asking for more than the firmware has is out of luck.
 */
export function abiSatisfies(
  abi: FirmwareAbi,
  requires: { version: number; minSize: number },
): boolean {
  return abi.version >= requires.version && abi.size >= requires.minSize;
}
