/** BIOS archive indexing runs in a worker for native browser handles; payloads remain lazy. */
import { zipExtractOne } from "../unzip.js";
import type { BiosCandidate } from "./bios.js";
import { scanBiosArchiveFiles, type BiosSourceFolder, type BiosArchiveFile } from "./biosArchiveIndex.js";
export { scanBiosArchiveFiles } from "./biosArchiveIndex.js";
export type { BiosSourceFolder } from "./biosArchiveIndex.js";

async function scanInWorker(folders: readonly BiosSourceFolder[], filenames: readonly string[]): Promise<BiosArchiveFile[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./biosArchives.worker.ts", import.meta.url), { type: "module" });
    const finish = () => {
      window.removeEventListener("pagehide", cancel);
      worker.terminate();
    };
    const cancel = () => {
      finish();
      reject(new Error("BIOS archive scan interrupted by navigation"));
    };
    window.addEventListener("pagehide", cancel, { once: true });
    worker.onerror = (event) => {
      finish();
      reject(event.error ?? new Error(event.message));
    };
    worker.onmessage = (event: MessageEvent<{ files: BiosArchiveFile[]; error?: string }>) => {
      finish();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.files);
    };
    try { worker.postMessage({ folders, filenames }); }
    catch (error) { finish(); reject(error); }
  });
}

/** Return matching members from ZIPs under ready BIOS source folders. */
export async function scanBiosSourceArchives(
  folders: readonly BiosSourceFolder[],
  filenames: readonly string[],
): Promise<BiosCandidate[]> {
  if (filenames.length === 0) return [];
  const ready = folders.filter((folder) => folder.status === "ready" && folder.handle);
  const browserFolders = typeof Worker !== "undefined" && typeof FileSystemDirectoryHandle !== "undefined"
    ? ready.filter((folder) => folder.handle instanceof FileSystemDirectoryHandle) : [];
  // Native directory iterators belong to the short-lived worker, so an interrupted walk
  // cannot retain the UI's previous page context across reloads. Electron and input shims
  // continue to use their existing directory adapter.
  const archives = [
    ...(browserFolders.length ? await scanInWorker(browserFolders, filenames) : []),
    ...await scanBiosArchiveFiles(ready.filter((folder) => !browserFolders.includes(folder)), filenames),
  ];
  const out: BiosCandidate[] = [];
  for (const { path, file, matches } of archives) {
    let archiveBytes: Promise<Uint8Array> | undefined;
    const getArchiveBytes = () => archiveBytes ??= file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
    for (const entry of matches) {
      let memberBytes: Promise<Uint8Array> | undefined;
      out.push({
        where: "folder", path: `${path}!/${entry.name}`, size: entry.size,
        bytes: {
          length: entry.size,
          bytes: () => memberBytes ??= getArchiveBytes().then((bytes) => zipExtractOne(bytes, entry)),
        },
      });
    }
  }
  return out;
}
