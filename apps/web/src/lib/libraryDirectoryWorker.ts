import type { NativeArchiveRules } from "./nativeRomArchives.js";
import { scanRomDirectory, scanRomFileSnapshot, type RomDirHandle, type RomFileSnapshot, type RomScanResult, type ZipScanCacheEntry } from "./romScan.js";

export type DirectorySnapshotEntry = RomFileSnapshot;

const workers = new Set<Worker>();
let paused = false;

export function setLibraryDirectoryPaused(active: boolean): void {
  if (paused === active) return;
  paused = active;
  for (const worker of workers) worker.postMessage({ type: active ? "pause" : "resume" });
}

export async function scanLibraryDirectory(
  dir: RomDirHandle,
  onProgress: (path: string, count: number) => Promise<void>,
  cached: Map<string, ZipScanCacheEntry>,
  waitForUi: () => Promise<void>,
  archiveRules?: NativeArchiveRules,
): Promise<RomScanResult> {
  if (typeof Worker === "undefined" || typeof FileSystemDirectoryHandle === "undefined" || !(dir instanceof FileSystemDirectoryHandle)) {
    return scanRomDirectory(dir, (path) => onProgress(path, 1), undefined, cached, archiveRules);
  }
  const entries = await new Promise<DirectorySnapshotEntry[]>((resolve, reject) => {
    const worker = new Worker(new URL("./libraryDirectory.worker.ts", import.meta.url), { type: "module" });
    workers.add(worker);
    let reported = 0;
    const finish = () => {
      workers.delete(worker);
      worker.terminate();
    };
    worker.onerror = (event) => {
      finish();
      reject(event.error ?? new Error(event.message));
    };
    worker.onmessage = async (event: MessageEvent<
      { type: "progress"; path: string; done: number }
      | { type: "complete"; entries: DirectorySnapshotEntry[]; cached: Map<string, ZipScanCacheEntry> }
      | { type: "error"; message: string }
    >) => {
      try {
        const message = event.data;
        if (message.type === "error") throw new Error(message.message);
        if (message.type === "progress") {
          await waitForUi();
          await onProgress(message.path, message.done - reported);
          reported = message.done;
          await new Promise<void>((resolve) => {
            if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
            else setTimeout(resolve, 16);
          });
          worker.postMessage({ type: "ack" });
        } else {
          for (const [path, metadata] of message.cached) cached.set(path, metadata);
          finish();
          resolve(message.entries);
        }
      } catch (error) {
        finish();
        reject(error);
      }
    };
    try {
      if (paused) worker.postMessage({ type: "pause" });
      worker.postMessage({ type: "scan", dir, cached, archiveRules });
    } catch (error) {
      finish();
      reject(error);
    }
  });
  const result = await scanRomFileSnapshot(dir, entries, (path) => onProgress(path, 0), cached, waitForUi, archiveRules);
  return { ...result, dir };
}
