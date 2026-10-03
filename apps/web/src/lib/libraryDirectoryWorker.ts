import type { NativeArchiveRules } from "./nativeRomArchives.js";
import { scanRomDirectory, scanRomFileSnapshot, type LibraryFile, type RomDirHandle, type RomFileSnapshot, type RomScanResult, type ZipScanCacheEntry } from "./romScan.js";
import { dbg } from "./debug.js";
import { electronFs, isElectronDirectoryMarker } from "./electronFs.js";

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
  snapshot?: DirectorySnapshotEntry[],
  previousFiles?: ReadonlyMap<string, LibraryFile>,
): Promise<RomScanResult> {
  if (isElectronDirectoryMarker(dir)) {
    const desktop = electronFs();
    if (!desktop) throw new Error("Electron filesystem bridge unavailable");
    const scanStarted = performance.now();
    const entries = await desktop.scanDirectory(dir.__gnwElectronRootId);
    const snapshotStarted = performance.now();
    dbg(`[library perf] directory snapshot received entries=${entries.length} elapsed=${Math.round(snapshotStarted - scanStarted)}ms`);
    const result = await scanRomFileSnapshot(dir, entries, (path) => onProgress(path, 0), cached, waitForUi, archiveRules, previousFiles);
    dbg(`[library perf] renderer snapshot parsed entries=${entries.length} roms=${result.userRoms.size} elapsed=${Math.round(performance.now() - snapshotStarted)}ms total=${Math.round(performance.now() - scanStarted)}ms`);
    return { ...result, dir };
  }
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
      | { type: "complete"; entries: DirectorySnapshotEntry[]; cached: Map<string, ZipScanCacheEntry>; stats?: { files: number; zipChecks: number; zipBytes: number } }
      | { type: "error"; message: string }
    >) => {
      try {
        const message = event.data;
        if (message.type === "error") throw new Error(message.message);
        if (message.type === "progress") {
          await waitForUi();
          await onProgress(message.path, message.done - reported);
          reported = message.done;
          // A backgrounded or unfocused Chromium window can throttle animation frames. This
          // acknowledgement must still reach the directory worker or the scan stops mid-folder.
          await new Promise<void>((resolve) => {
            let settled = false;
            let fallback: ReturnType<typeof setTimeout>;
            const finish = () => {
              if (settled) return;
              settled = true;
              clearTimeout(fallback);
              resolve();
            };
            fallback = setTimeout(finish, 100);
            if (typeof requestAnimationFrame === "function") requestAnimationFrame(finish);
          });
          worker.postMessage({ type: "ack" });
        } else {
          for (const [path, metadata] of message.cached) cached.set(path, metadata);
          if (new URLSearchParams(location.search).has("libraryTrace")) {
            console.info("[library trace] browser directory walk done", JSON.stringify({ ...message.stats, cachedZipEntries: message.cached.size }));
          }
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
      worker.postMessage({ type: "scan", dir, cached, archiveRules, snapshot });
    } catch (error) {
      finish();
      reject(error);
    }
  });
  const result = await scanRomFileSnapshot(dir, entries, (path) => onProgress(path, 0), cached, waitForUi, archiveRules, previousFiles);
  return { ...result, dir };
}
