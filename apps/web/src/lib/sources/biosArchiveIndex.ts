/**
 * Find BIOS members inside ZIPs in explicitly BIOS-marked local folders.
 *
 * This walks the folder handles independently of the game-library scan. A multi-file ZIP is
 * often not a valid wrapped ROM, so that scan correctly drops it; BIOS discovery still needs to
 * inspect the ZIP's central directory without changing how any game archive is classified.
 */
import { readZipDirectory } from "../zipScan.js";
import type { ZipEntry } from "../unzip.js";

interface DirLike {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, DirLike | FileLike]>;
}
interface FileLike {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}
export interface BiosSourceFolder {
  id: string;
  handle: unknown;
  status: string;
}

const MAX_DEPTH = 8;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

export interface BiosArchiveFile {
  path: string;
  file: File;
  matches: ZipEntry[];
}

async function walk(
  dir: DirLike,
  prefix: string,
  depth: number,
  wanted: ReadonlySet<string>,
  out: BiosArchiveFile[],
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith(".")) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      if (depth < MAX_DEPTH) await walk(handle, path, depth + 1, wanted, out);
      continue;
    }
    if (!/\.zip$/i.test(name)) continue;
    try {
      const file = await handle.getFile();
      if (file.size > MAX_ARCHIVE_BYTES) continue;
      const entries = await readZipDirectory(file);
      const matches = entries.filter((entry) =>
        !entry.isDirectory && wanted.has(entry.name.slice(entry.name.lastIndexOf("/") + 1).toLowerCase()) &&
        !entry.encrypted && entry.size <= 4 * 1024 * 1024 && (entry.method === 0 || entry.method === 8)
      );
      if (matches.length === 0) continue;

      out.push({ path, file, matches });
    } catch {
      // An unreadable or unsupported archive contributes no candidates; other files still scan.
    }
  }
}

/** Index archive metadata only; File snapshots can cross the worker boundary without payload reads. */
export async function scanBiosArchiveFiles(
  folders: readonly BiosSourceFolder[],
  filenames: readonly string[],
): Promise<BiosArchiveFile[]> {
  const wanted = new Set(filenames.map((name) => name.toLowerCase()));
  if (wanted.size === 0) return [];
  const out: BiosArchiveFile[] = [];
  for (const folder of folders) {
    if (folder.status !== "ready" || !folder.handle || typeof folder.handle !== "object") continue;
    try {
      await walk(folder.handle as DirLike, "", 0, wanted, out);
    } catch {
      // Revoked permission or an unreadable directory does not block the other BIOS sources.
    }
  }
  return out;
}

