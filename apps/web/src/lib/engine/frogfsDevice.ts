/**
 * On-device FrogFS read — list the games currently installed in the device's
 * FrogFS, reading only the small metadata prefix (head + hashtable + entry
 * headers) over SWD rather than the whole multi-MB image. Extflash reads require
 * the RAM util's memory-mapped mode (same as the partition scan), so this runs
 * after the stub is up and a frogfs partition is known.
 */
import { parseFrogfs, parseFrogfsHead, hashtableOffset, type FrogfsFile } from "@gnw/fs-builders";

/** Read `len` bytes of external flash at physical `offset` (0 == 0x90000000). */
export type ExtReadFn = (offset: number, len: number) => Promise<Uint8Array>;

const align4 = (n: number): number => ((n + 3) >>> 2) << 2;

/** A game installed in FrogFS, derived from a `roms/<system>/<file>` entry. */
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

const ROMS = "roms/";

/** Map a FrogFS file to a game (roms/<system>/<name>), or null for non-game assets. */
function toGame(f: FrogfsFile): InstalledGame | null {
  if (!f.path.startsWith(ROMS)) return null;
  const rest = f.path.slice(ROMS.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null; // a file directly under roms/ with no system
  const system = rest.slice(0, slash);
  const name = rest.slice(slash + 1); // may contain subdirs; kept as-is
  if (!system || !name) return null;
  return { path: f.path, system, name, size: f.dataSize, dataOffs: f.dataOffs };
}

export interface InstalledFrogfs {
  binSize: number;
  /** Every FrogFS file (incl. bios/fonts), for a file browser. */
  files: FrogfsFile[];
  /** Just the games under roms/<system>/. */
  games: InstalledGame[];
}

/**
 * Read + parse the device's FrogFS metadata at `frogfsOffset`. Throws if there's
 * no valid FrogFS there (bad magic) — callers treat that as "no games installed".
 */
export async function readInstalledFrogfs(
  read: ExtReadFn,
  frogfsOffset: number,
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
  for (const f of files) {
    const g = toGame(f);
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
