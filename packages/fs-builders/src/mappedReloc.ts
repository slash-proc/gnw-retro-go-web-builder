/**
 * Sentinel relocation for a `mapped` artifact inside a packed FrogFS image.
 *
 * A 1:1 port of the firmware repo's build-time pass:
 *   - `scripts/pico8_ro_build_patch.py`  `patch_pico8_ro_bytes` -- the word scan
 *   - `scripts/frogfs_pico8_ro.py`       `patch_frogfs_pico8_ro_inplace` -- find the
 *                                        entry, derive the address, patch, rewrite the CRC
 *
 * WHY A POST-PASS AND NOT A LAYOUT DECISION. A mapped file is memory, not data: the device
 * executes or indexes it where it lies, so it needs a real address, and the address is not
 * knowable until the image is packed. `frogfs_pico8_ro.py` computes
 * `extflash_base + extflash_offset + data_offs` against the BUILT `frogfs.bin`; we do the
 * same against ours. Nothing earlier can know it, and nothing later may move it.
 *
 * THE SAME RELOCATION LIVES IN THREE PLACES, differing only in where the pointer comes from
 * (`references/game-and-watch-retro-go-sd/Core/Src/retro-go/rg_emulators.c:162`): on SD the
 * core copies the file into the flash cache and patches in place; from FrogFS on-device it
 * writes a patched copy to a dedicated cache window, because the source is read-only there.
 * We are the third case -- we own the image before it ships, so we patch in place.
 *
 * SD INSTALLS NEED NONE OF THIS. Per `gwrg-dist-spec` `spec/05-host.md`, an installer writing
 * to a card has nothing extra to do; the core does the caching and patching at load time.
 */
import { parseFrogfs, FrogFsParseError } from "./frogfsParse.js";
import { crc32 } from "./frogfs.js";

/** Extflash memory-mapped base (`apps/web/src/lib/engine/addr.ts`'s `EXTBASE`). */
export const EXTFLASH_BASE = 0x90000000;

/** The trailing `<I crc32` the builder appends (`frogfs.ts`'s `append_footer`). */
const FOOT_SIZE = 4;

export class MappedRelocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappedRelocError";
  }
}

/** One mapped artifact, keyed by its FrogFS dest path (e.g. `cores/gba.xip`). */
export interface MappedSpec {
  /**
   * The sentinel the blob was linked at, from the manifest. ABSENT means the file must be
   * addressable but needs no relocation -- the spec allows `mapped` without `relocBase`, so
   * absence is not an error and not a reason to skip the placement checks.
   */
  relocBase?: number;
  /**
   * Where this blob's addresses ALREADY point, when the bytes came off the device rather than
   * from the manifest's artifact. Takes precedence over `relocBase`.
   *
   * `relocBase` is the base for the FIRST relocation only. A blob already installed holds
   * addresses in `[placedAt, placedAt + bytes)`, and `placedAt` need not be remembered: it is
   * derived from the on-device image exactly as the new address is derived from the new one
   * (`EXTFLASH_BASE + oldFrogfsOffset + oldDataOffs`). So moving a blob -- a removal earlier in
   * the image shifting everything after it -- is the identical scan with a different base and
   * a delta of `newAddress - placedAt`. Nothing has to be kept: no pristine copy, no recorded
   * delta, no pinned offset, and the artifact bundle need not still be cached.
   */
  placedAt?: number;
  /** The manifest's own `bytes`, checked against the packed entry. Optional: absent skips that check. */
  bytes?: number;
  /**
   * How many words the previous placement relocated, when `placedAt` is set.
   *
   * WHY THIS EXISTS, and why only on a move. The spec justifies the window test by the sentinel
   * being unmistakable: "The sentinel is an impossible address, so a word in range is a pointer
   * and not a coincidence." That argument does not survive a move, where the base is a REAL
   * QSPI address a non-pointer word can plausibly hold. Neither reference implementation faces
   * this, because neither ever moves a placed blob.
   *
   * The invariant is that the same words relocate every time: relocation shifts a pointer's
   * value but not which words are pointers. So a count that differs from the first placement's
   * means the window caught something that is not a pointer, and the blob is refused rather
   * than written with a corrupted data word. Cheap, and it is the only signal available.
   */
  expectPatched?: number;
}

export interface MappedResult {
  path: string;
  /** The real address the blob now sits at. */
  address: number;
  /** Words rewritten. `undefined` when the spec carried no `relocBase`. */
  patched?: number;
}

/**
 * Relocate one blob. Ported from `patch_pico8_ro_bytes`, including the detail that decides
 * whether the result runs: bit 0 is masked **for the range test only**, and the delta is
 * added to the UNMASKED value, so a Thumb function pointer keeps its low bit. Adding to the
 * masked value instead yields a blob that looks patched and faults on the first indirect call.
 *
 * `base` is where the blob's addresses currently point, which is NOT always `relocBase`:
 * see `relocateInPlace`.
 */
export function relocateWords(blob: Uint8Array, base: number, target: number): number {
  // Signed 32-bit delta, matching the Python's explicit two's-complement fold: a blob moving
  // DOWN in memory needs a negative delta, and `>>> 0` arithmetic alone would wrap it.
  const deltaU32 = (target - base) >>> 0;
  const delta = deltaU32 >= 0x80000000 ? deltaU32 - 0x100000000 : deltaU32;

  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const upper = base + blob.length;
  const n = (blob.length >>> 2) << 2;
  let patched = 0;
  for (let i = 0; i < n; i += 4) {
    const value = dv.getUint32(i, true);
    // `>>> 0` is load-bearing: JS bitwise operators yield a SIGNED int32, so `0x90300000 & ~1`
    // is negative and would fail every window test -- silently patching nothing for any base at
    // or above 0x80000000, which is every address either the sentinel or real QSPI actually uses.
    const masked = (value & ~1) >>> 0;
    if (masked >= base && masked < upper) {
      dv.setUint32(i, (value + delta) >>> 0, true);
      patched++;
    }
  }
  return patched;
}

/**
 * Patch every mapped artifact in a packed FrogFS image, in place, and rewrite the trailing
 * CRC32 over everything before it (`frogfs_pico8_ro.py:144`). The image length never changes,
 * so a layout computed from it stays valid.
 *
 * REFUSES RATHER THAN GUESSES, per `spec/05-host.md`: "A host or builder with no memory-mapped
 * region to give the file, or no way to relocate it, has not got a partial install -- it has
 * one that hardfaults. Say so and stop."
 *
 * The checks below are asserted rather than assumed even where they hold today. Both
 * compression guarantees are currently properties of where the file happens to sit -- our
 * FrogFS container has no compressed mode, and `.lzma` sidecars only touch `roms/` -- not
 * rules about mapped files. Relying on incidental structure is how a core ended up at
 * `roms/cores/doom.bin` on a real card.
 */
export function relocateMappedInFrogfs(
  image: Uint8Array,
  frogfsOffset: number,
  mapped: ReadonlyMap<string, MappedSpec>,
  extflashBase: number = EXTFLASH_BASE,
): MappedResult[] {
  if (mapped.size === 0) return [];
  if (image.length < FOOT_SIZE) throw new MappedRelocError("image too small to carry a CRC footer");

  let parsed;
  try {
    parsed = parseFrogfs(image);
  } catch (e) {
    // A compressed entry surfaces here as a FrogFsParseError. Naming the cause matters: the
    // refusal a user sees must not read as a corrupt image when the image is fine and the
    // file simply cannot be executed in place.
    const why = e instanceof FrogFsParseError ? e.message : String(e);
    throw new MappedRelocError(`cannot read the packed image to place a mapped artifact: ${why}`);
  }

  const byPath = new Map(parsed.files.map((f) => [f.path, f]));
  const out: MappedResult[] = [];

  for (const [path, spec] of mapped) {
    const entry = byPath.get(path);
    if (!entry) throw new MappedRelocError(`${path}: mapped artifact is not in the packed image`);
    if (entry.dataOffs % 4 !== 0) {
      throw new MappedRelocError(`${path}: data offset ${entry.dataOffs} is not 4-byte aligned`);
    }
    if (entry.dataOffs + entry.dataSize > image.length - FOOT_SIZE) {
      throw new MappedRelocError(`${path}: data runs past the end of the image`);
    }
    if (spec.bytes !== undefined && entry.dataSize !== spec.bytes) {
      // A size that disagrees with the manifest means the bytes in the image are not the
      // artifact -- a packer substituted something (an `.lzma` sidecar is the way that
      // happens) and relocating them would corrupt whatever they are.
      throw new MappedRelocError(
        `${path}: packed size ${entry.dataSize} does not match the declared ${spec.bytes}`,
      );
    }

    const address = extflashBase + frogfsOffset + entry.dataOffs;
    // Where the blob's addresses point NOW: the sentinel on a first placement, its own last
    // address once it has been placed.
    const base = spec.placedAt ?? spec.relocBase;
    if (base === undefined) {
      out.push({ path, address });
      continue;
    }
    if (base === address) {
      // It has not moved. Scanning would be a no-op with a real chance of a false hit, so the
      // honest thing is to leave the bytes alone.
      out.push({ path, address, patched: 0 });
      continue;
    }

    const blob = image.subarray(entry.dataOffs, entry.dataOffs + entry.dataSize);
    const patched = relocateWords(blob, base, address);
    if (spec.expectPatched !== undefined && patched !== spec.expectPatched) {
      throw new MappedRelocError(
        `${path}: relocated ${patched} words, expected ${spec.expectPatched}`,
      );
    }
    out.push({ path, address, patched });
  }

  // The footer is over the body only, and it must be rewritten whatever else happened --
  // a mapped artifact needing no relocation still moved the file's bytes into a new image.
  const body = image.subarray(0, image.length - FOOT_SIZE);
  new DataView(image.buffer, image.byteOffset, image.byteLength).setUint32(
    image.length - FOOT_SIZE,
    crc32(body) >>> 0,
    true,
  );
  return out;
}
