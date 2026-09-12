/**
 * On-device FrogFS read — list the games currently installed in the device's
 * FrogFS, reading only the small metadata prefix (head + hashtable + entry
 * headers) over SWD rather than the whole multi-MB image. Extflash reads require
 * the RAM util's memory-mapped mode (same as the partition scan), so this runs
 * after the stub is up and a frogfs partition is known.
 */
import {
  parseFrogfs,
  parseFrogfsHead,
  hashtableOffset,
  type FrogfsFile,
  type InstallPaths,
} from "@gnw/fs-builders";
import { deviceInstallPaths, homebrewDirs } from "./devicePaths.js";
import type { MemReadFn as ExtReadFn } from "./addr.js";
export type { ExtReadFn };

const align4 = (n: number): number => ((n + 3) >>> 2) << 2;

/** A game installed in FrogFS, derived from a `<roms>/<system>/<file>` (or homebrew) entry. */
export interface InstalledGame {
  /** Full FrogFS path, e.g. "roms/nes/smb.nes". */
  path: string;
  /** System dir under roms/, e.g. "nes". */
  system: string;
  /** File name, e.g. "smb.nes". */
  name: string;
  /** Raw data size in bytes. */
  size: number;
  /** Byte offset of this game's data within the FrogFS image (to re-read it from the device). */
  dataOffs: number;
}

/**
 * Map a FrogFS file to a game, or null for a non-game asset.
 *
 * The directories are the firmware's, not this repo's: `paths` comes from the manifest
 * (installPaths.ts) via `devicePaths.ts`. Homebrew is checked FIRST because the pre-manifest
 * default homebrew directory (`roms/homebrew`) sits inside the roms directory — checking
 * `roms/` first would classify a homebrew binary as system "homebrew" only by accident of the
 * layout, and would classify one under the live manifest's `/homebrews` as nothing at all.
 */
function toGame(f: FrogfsFile, paths: InstallPaths, hbDirs: string[]): InstalledGame | null {
  for (const dir of hbDirs) {
    const prefix = `${dir}/`;
    if (f.path.startsWith(prefix)) {
      const name = f.path.slice(prefix.length);
      if (!name) return null;
      return { path: f.path, system: "homebrew", name, size: f.dataSize, dataOffs: f.dataOffs };
    }
  }
  const romsPrefix = `${paths.roms}/`;
  if (!f.path.startsWith(romsPrefix)) return null;
  const rest = f.path.slice(romsPrefix.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null; // a file directly under the roms dir with no system
  const system = rest.slice(0, slash);
  const name = rest.slice(slash + 1); // may contain subdirs; kept as-is
  if (!system || !name) return null;
  return { path: f.path, system, name, size: f.dataSize, dataOffs: f.dataOffs };
}

export interface InstalledFrogfs {
  binSize: number;
  /** Every FrogFS file (incl. bios/fonts), for a file browser. */
  files: FrogfsFile[];
  /** Just the games: `<roms>/<system>/…` plus the homebrew directory (system "homebrew"). */
  games: InstalledGame[];
}

/**
 * Read + parse the device's FrogFS metadata at `frogfsOffset`. Throws if there's
 * no valid FrogFS there (bad magic) — callers treat that as "no games installed".
 */
export async function readInstalledFrogfs(
  read: ExtReadFn,
  frogfsOffset: number,
  paths: InstallPaths = deviceInstallPaths(),
): Promise<InstalledFrogfs> {
  // head: 12 bytes (read 16 for safety) → numEntries + binSize, validates magic.
  const head = parseFrogfsHead(await read(frogfsOffset, 16));
  if (head.numEntries === 0) return { binSize: head.binSize, files: [], games: [] };

  // hashtable → every entry's header offset; find the furthest header.
  const htLen = align4(8 * head.numEntries);
  const htBuf = await read(frogfsOffset + hashtableOffset(), htLen);
  const dv = new DataView(htBuf.buffer, htBuf.byteOffset, htBuf.byteLength);
  let maxOffs = 0;
  for (let i = 0; i < head.numEntries; i++) {
    const o = dv.getUint32(i * 8 + 4, true);
    if (o > maxOffs) maxOffs = o;
  }

  // One contiguous read from the base through the header region (a file header is
  // at most 16 + 255-byte name + padding). All headers precede the first file data.
  const end = Math.min(maxOffs + 512, head.binSize);
  const full = await read(frogfsOffset, end);
  const { files } = parseFrogfs(full);
  const games: InstalledGame[] = [];
  const hbDirs = homebrewDirs(paths);
  for (const f of files) {
    const g = toGame(f, paths, hbDirs);
    if (g) games.push(g);
  }
  return { binSize: head.binSize, files, games };
}

/** Re-read a single installed game's raw bytes from the device FrogFS (for non-destructive
 *  repacks that preserve games present on the device but absent from the user's folder). */
export async function readGameData(
  read: ExtReadFn,
  frogfsOffset: number,
  game: Pick<InstalledGame, "dataOffs" | "size">,
): Promise<Uint8Array> {
  return read(frogfsOffset + game.dataOffs, game.size);
}
