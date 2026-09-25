import { zipList, CentralDirectoryOutOfRange, type ZipEntry } from "./unzip.js";

const ZIP_TAIL_STEPS = [4_096, 66_000] as const;

/** The central directory of an archive, reading as little of it as possible. */
export async function readZipDirectory(file: File): Promise<ZipEntry[]> {
  const size = file.size;

  for (let step = 0; step < ZIP_TAIL_STEPS.length; step++) {
    const want = ZIP_TAIL_STEPS[step];
    const from = Math.max(0, size - want);
    const tail = new Uint8Array(await file.slice(from).arrayBuffer());
    try {
      return zipList(tail, from);
    } catch (e) {
      if (e instanceof CentralDirectoryOutOfRange) {
        // The archive told us where to look. One exact read, still far less than the payload.
        const rest = new Uint8Array(await file.slice(e.centralDirectoryOffset).arrayBuffer());
        return zipList(rest, e.centralDirectoryOffset);
      }
      // No end-of-central-directory in this slice. If the slice was the whole file, that is the
      // verdict; otherwise it may simply be further back, so try a longer tail before deciding.
      const sawWholeFile = from === 0;
      const lastStep = step === ZIP_TAIL_STEPS.length - 1;
      if (sawWholeFile || lastStep) throw e;
    }
  }
  // Unreachable: the loop either returns or throws on its last step.
  throw new Error("not a zip (no end-of-central-directory)");
}

/**
 * ZIPPED ROMS: one archive, one ROM, and the INNER name is the identity.
 *
 * The owner's library is 375 archives that each hold exactly one `.gb`, and the archive name is
 * not the ROM name -- `Aladdin.zip` holds `Disney's Aladdin (USA) (SGB Enhanced).gb`. The inner
 * name is the No-Intro one, which is what cover art and cheat databases key on, so that is the
 * name the library takes. A zipped ROM then behaves exactly like a loose one of the same name:
 * same dedup, same collision refusal, same console classification, same size.
 *
 * WHICH ARCHIVES ARE ROMS is deliberately NOT asked here. A dedicated folder (`Gameboy/*.zip`,
 * his actual layout) is mapped onto its console AFTER the scan by `libraryScan.ts`'s
 * `applyPlacement`, so at this point there is no folder to classify against and a registry lookup
 * would have to guess. Unpacking to the inner name and letting the normal rules judge it is both
 * simpler and more accurate: an archive holding `notes.txt` yields `notes.txt`, which is dropped
 * exactly where a loose `notes.txt` is dropped. No fourth console table, per CLAUDE.md.
 */
export type ZipRomVerdict =
  | { ok: true; entry: ZipEntry; name: string }
  | { ok: false; reason: string };

/**
 * Decide what a zip archive contributes, from its central directory alone.
 *
 * Every refusal names what was found. The owner's library contains none of these cases, which
 * is exactly why they must fail loudly: an untested path that silently picks entry 0 would
 * install the wrong file with no way to notice.
 */
export function resolveZipRom(entries: readonly ZipEntry[]): ZipRomVerdict {
  const files = entries.filter((e) => !e.isDirectory);
  if (files.length === 0) return { ok: false, reason: "holds no files" };
  if (files.length > 1) {
    const names = files.slice(0, 3).map((f) => f.name).join(", ");
    return {
      ok: false,
      reason: `holds ${files.length} files (${names}${files.length > 3 ? ", …" : ""}); a ROM archive must hold exactly one`,
    };
  }
  const only = files[0];
  if (only.encrypted) return { ok: false, reason: `holds ${only.name}, which is encrypted` };
  if (only.method !== 0 && only.method !== 8) {
    return { ok: false, reason: `holds ${only.name}, compressed with method ${only.method} (only stored and deflate are supported)` };
  }
  // A single entry may still carry a directory component. The destination is `<system>/<name>`
  // either way, so the basename is the identity; an entry that is all path and no name is not a
  // file we can place.
  const base = only.name.slice(only.name.lastIndexOf("/") + 1);
  if (!base) return { ok: false, reason: `holds ${only.name}, which has no file name` };
  return { ok: true, entry: only, name: base };
}
