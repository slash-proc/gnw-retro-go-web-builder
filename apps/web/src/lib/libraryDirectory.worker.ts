import { isNativeRomArchive, type NativeArchiveRules } from "./nativeRomArchives.js";
import { readZipDirectory, resolveZipRom } from "./zipScan.js";
import type { DirectorySnapshotEntry } from "./libraryDirectoryWorker.js";
import type { ZipScanCacheEntry } from "./romScan.js";

let paused = false;
let resume: (() => void) | undefined;
let acknowledge: (() => void) | undefined;

async function checkpoint(): Promise<void> {
  while (paused) await new Promise<void>((resolve) => { resume = resolve; });
}

async function scan(dir: FileSystemDirectoryHandle, cached: Map<string, ZipScanCacheEntry>, archiveRules?: NativeArchiveRules, snapshot?: DirectorySnapshotEntry[]): Promise<void> {
  const entries: DirectorySnapshotEntry[] = [];
  const known = new Map(snapshot?.map((entry) => [entry.path, entry]));
  let metadataReads = 0;
  let zipChecks = 0;
  let zipBytes = 0;
  let lastProgress = 0;
  let lastProgressCount = 0;
  let current = "";
  const progress = async () => {
    await checkpoint();
    const received = new Promise<void>((resolve) => { acknowledge = resolve; });
    self.postMessage({ type: "progress", done: entries.length, path: current });
    await received;
  };
  const walk = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const [name, handle] of directory.entries()) {
      if (name.startsWith(".")) continue;
      await checkpoint();
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") {
        await walk(handle as FileSystemDirectoryHandle, path);
        continue;
      }
      const fileHandle = handle as FileSystemFileHandle;
      const previousFile = known.get(path);
      // Startup checks namespace presence. A user-requested refresh supplies no snapshot
      // and reads every size/mtime, including files replaced in place.
      let file = previousFile ?? await fileHandle.getFile();
      if (!previousFile) metadataReads++;
      if (/\.zip$/i.test(name) && !isNativeRomArchive(path, archiveRules)) {
        zipChecks++;
        zipBytes += file.size;
        const previous = cached.get(path);
        if (!previous || previous.size !== file.size || previous.lastModified !== file.lastModified) {
          try {
            if (previousFile) {
              file = await fileHandle.getFile();
              metadataReads++;
            }
            cached.set(path, { size: file.size, lastModified: file.lastModified, verdict: resolveZipRom(await readZipDirectory(file as File)) });
          } catch (error) {
            cached.set(path, { size: file.size, lastModified: file.lastModified, verdict: { ok: false, reason: error instanceof Error ? error.message : String(error) } });
          }
        }
      }
      entries.push({ path, size: file.size, lastModified: file.lastModified });
      current = path;
      if (entries.length - lastProgressCount >= 24 || performance.now() - lastProgress >= 100) {
        await progress();
        lastProgress = performance.now();
        lastProgressCount = entries.length;
      }
    }
  };
  await walk(dir, "");
  await progress();
  await checkpoint();
  self.postMessage({ type: "complete", entries, cached, stats: { files: entries.length, zipChecks, zipBytes, metadataReads } });
}

self.onmessage = (event: MessageEvent<
  { type: "scan"; dir: FileSystemDirectoryHandle; cached: Map<string, ZipScanCacheEntry>; archiveRules?: NativeArchiveRules; snapshot?: DirectorySnapshotEntry[] }
  | { type: "pause" | "resume" | "ack" }
>) => {
  const message = event.data;
  if (message.type === "pause") paused = true;
  else if (message.type === "resume") {
    paused = false;
    resume?.();
    resume = undefined;
  } else if (message.type === "ack") {
    acknowledge?.();
    acknowledge = undefined;
  } else if (message.type === "scan") {
    void scan(message.dir, message.cached, message.archiveRules, message.snapshot).catch((error) => {
      self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    });
  }
};
