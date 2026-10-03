/**
 * Find BIOS members inside ZIPs in explicitly BIOS-marked local folders.
 *
 * This walks the folder handles independently of the game-library scan. A multi-file ZIP is
 * often not a valid wrapped ROM, so that scan correctly drops it; BIOS discovery still needs to
 * inspect the ZIP's central directory without changing how any game archive is classified.
 */
import { readZipDirectory } from "../zipScan.js";
import { zipExtractOne } from "../unzip.js";
import type { BiosCandidate } from "./bios.js";

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

async function walk(
  dir: DirLike,
  prefix: string,
  depth: number,
  wanted: ReadonlySet<string>,
  out: BiosCandidate[],
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

      // Keep the archive lazy. Only the manifest-matched members are ever inflated, and several
      // BIOS entries in one bundle share one read of the containing ZIP.
      let archiveBytes: Promise<Uint8Array> | undefined;
      const getArchiveBytes = () => archiveBytes ??= file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
      for (const entry of matches) {
        let memberBytes: Promise<Uint8Array> | undefined;
        out.push({
          where: "folder",
          path: `${path}!/${entry.name}`,
          size: entry.size,
          bytes: {
            length: entry.size,
            bytes: () => memberBytes ??= getArchiveBytes().then((bytes) => zipExtractOne(bytes, entry)),
          },
        });
      }
    } catch {
      // An unreadable or unsupported archive contributes no candidates; other files still scan.
    }
  }
}

/** Return matching members from ZIPs under ready BIOS source folders. */
export async function scanBiosSourceArchives(
  folders: readonly BiosSourceFolder[],
  filenames: readonly string[],
): Promise<BiosCandidate[]> {
  const wanted = new Set(filenames.map((name) => name.toLowerCase()));
  if (wanted.size === 0) return [];
  const out: BiosCandidate[] = [];
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
