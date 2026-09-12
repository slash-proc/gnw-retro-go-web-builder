/**
 * BIOS files already sitting on the user's SD card.
 *
 * In SD mode the device's content is not in FrogFS at all — `SD_CARD=1` compiles FrogFS out
 * and Retro-Go reads plain files off the card (`/bios/coleco/coleco.bin`, `/bios/logo.bin`) —
 * so `device.installedFrogfs`, the Flash-mode candidate source, is empty and every BIOS on
 * the card reads as missing.
 *
 * Nothing else in the app enumerates these: `romScan.ts`'s `scanRomDirectory` does walk the
 * whole card and would include `bios/*` (only the `roms/` prefix is stripped), but its one
 * consumer for the card, `device.scanSdCardGames()`, explicitly skips `bios/` because it is
 * building a GAME list. Reusing that scan here would mean reading every ROM on the card —
 * hundreds of MiB — to look at a handful of small files. So this walks the `bios/` subtree
 * and nothing else.
 *
 * Unlike the FrogFS listing (metadata only), the card gives us bytes, so these candidates are
 * hashable and come back verified rather than `unchecked` — worth the read for files this
 * size. A file too large to be a plausible BIOS is still REPORTED (presence is the question
 * being asked) but is not read into memory.
 */
import type { BiosCandidate } from "./bios.js";

/** The bit of the File System Access API this needs. Mirrors `romScan.ts`'s local shape. */
interface DirLike {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, DirLike | FileLike]>;
}
interface FileLike {
  kind: "file";
  name: string;
  getFile(): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> }>;
}

/**
 * Ceiling on what is read into memory. The largest BIOS any published manifest declares is
 * the GBA one at 16 KiB; a MiB is generous by three orders of magnitude and still bounds a
 * card holding something odd under `bios/`.
 */
const MAX_READ_BYTES = 1024 * 1024;

/** Depth cap. Real trees are `bios/<core>/<file>`; this only stops a pathological card. */
const MAX_DEPTH = 4;

async function walk(dir: DirLike, prefix: string, depth: number, out: BiosCandidate[]): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith(".")) continue; // .DS_Store &c, same as the ROM walk
    const path = `${prefix}/${name}`;
    if (handle.kind === "directory") {
      if (depth < MAX_DEPTH) await walk(handle, path, depth + 1, out);
      continue;
    }
    const file = await handle.getFile();
    if (file.size > MAX_READ_BYTES) {
      out.push({ where: "device", path, size: file.size });
      continue;
    }
    out.push({ where: "device", path, bytes: new Uint8Array(await file.arrayBuffer()), size: file.size });
  }
}

/**
 * Candidates from the card's `bios/` directory, or an empty list when it has none.
 *
 * `root` is the card root as `romScan.ts`'s `getValidRoot` returns it — `bios/` lives beside
 * `roms/` at the root, never inside it. Paths come back spelled `bios/<…>`, matching what the
 * FrogFS side reports, because `bios.ts` matches on the FILENAME and shows the path.
 */
export async function scanSdBios(root: DirLike): Promise<BiosCandidate[]> {
  let biosDir: DirLike | undefined;
  for await (const [name, handle] of root.entries()) {
    if (handle.kind === "directory" && name.toLowerCase() === "bios") biosDir = handle;
  }
  if (!biosDir) return [];
  const out: BiosCandidate[] = [];
  await walk(biosDir, "bios", 1, out);
  return out;
}
