/**
 * Shared "which build is this core from" logic — used to validate that installed emulator
 * cores agree with the installed retro-go firmware/each other (Flash-mode LittleFS cores,
 * SD-mode SD-card cores). See references/game-and-watch-retro-go-sd Makefile.common's
 * EXTRACT_INTERNAL_CORE_BIN_WITH_HEADER: every core .bin is built with a fixed header
 * prepended to the raw core binary:
 *
 *   offset 0..3   "CORI"            4-byte ASCII magic
 *   offset 4..5   header_format_ver u16 LE (currently always 0)
 *   offset 6..7   header_len        u16 LE (1 + tag_len)
 *   offset 8      tag_len           u8
 *   offset 9..    git_tag           ASCII, tag_len bytes (e.g. "Retro-Go SD v1.3.2-13-g44866fae+")
 *   offset 9+tag_len..  <raw core binary>
 *
 * This is the SAME GIT_TAG the main firmware embeds (Core/Inc/gittag.h) — an exact string
 * match between a core's tag and the running firmware's version means they're from the same
 * build. Deliberately only needs the first few bytes of a core file, not its full content.
 */

const CORE_HEADER_MAGIC = "CORI";
/** Header is at most magic(4) + format_ver(2) + header_len(2) + tag_len(1) + a generously
 *  long tag string — real tags are ~40 chars, so 96 bytes leaves headroom without needing a
 *  second read. */
export const CORE_HEADER_PROBE_BYTES = 96;

export function parseCoreHeader(bytes: Uint8Array): { tag: string } | null {
  if (bytes.length < 9) return null;
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== CORE_HEADER_MAGIC) return null;
  const tagLen = bytes[8];
  if (bytes.length < 9 + tagLen) return null;
  const tag = new TextDecoder("latin1").decode(bytes.subarray(9, 9 + tagLen));
  return { tag };
}

export type CoreVersionCheck = {
  /** The running/target firmware's version tag, if known (null when validating an SD card
   *  with no connected/booted device to read it from). */
  firmwareVersion: string | null;
  /** Per-core path → parsed tag (null if the file had no valid CORI header, e.g. unreadable
   *  or corrupt). */
  cores: Record<string, string | null>;
  /** Core paths whose tag disagrees with the majority/firmware tag. */
  mismatches: string[];
  /** True iff every readable core agrees with each other, AND with firmwareVersion when known. */
  consistent: boolean;
  checkedAt: number;
};

/** Given a firmware version (or null) and a path→tag map, compute the mismatch/consistency
 *  verdict. Shared by both the Flash (LittleFS) and SD-card check paths. */
export function evaluateCoreVersions(
  firmwareVersion: string | null,
  cores: Record<string, string | null>,
): CoreVersionCheck {
  const readableTags = Object.values(cores).filter((t): t is string => t !== null);
  // Reference tag to compare against: the firmware's, if known; otherwise the majority tag
  // among the cores themselves (SD card with no connected/booted device — see module doc).
  const referenceTag =
    firmwareVersion ??
    (readableTags.length > 0
      ? [...readableTags]
          .sort(
            (a, b) =>
              readableTags.filter((t) => t === b).length - readableTags.filter((t) => t === a).length,
          )[0]
      : null);

  const mismatches = Object.entries(cores)
    .filter(([, tag]) => tag !== null && referenceTag !== null && tag !== referenceTag)
    .map(([path]) => path);

  return {
    firmwareVersion,
    cores,
    mismatches,
    consistent: mismatches.length === 0,
    checkedAt: Date.now(),
  };
}
