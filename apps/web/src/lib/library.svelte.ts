// Shared library (ROM-folder) state. Library management is gated on a selected ROM folder (NOT on a
// device connection — ROMs are the prerequisite; a device is only needed to flash-install
// or SD-push). The folder is picked + scanned once via romScan and reused across the tab.
// (RomSection in the Retro-Go tab can migrate onto this store later.)
import {
  pickRomFolder,
  pickAndScanRomFolder,
  scanRomDirectory,
  countRomDirectory,
  folderPickerSupported,
  dirSupportsWriteBack,
  summarize,
  type RomScanResult,
  type RomDirHandle,
  romBytes,
  type LibraryFile,
} from "./romScan.js";
import { saveDir, loadDir, handlePermission } from "./persist.js";
import { toGWCover } from "./screenscraper/gw.js";
import { isLazy } from "./lazyBytes.js";
import { device } from "./device.svelte.js";
import { dbg } from "./debug.js";
import { lipProgress } from "./lipProgress.svelte.js";
import { auditLog } from "./auditLog.svelte.js";
import { msg } from "./logEntry.js";
import { localFolders, displayName } from "./sources/localFolders.svelte.js";
import { sources } from "./sources/store.svelte.js";
import {
  scanLibraryFolders,
  migrateLegacyRomDir,
  romFolderGateNeeded,
  defaultLibraryScanDeps,
  romFolderSources,
  romFolderSignature,
  libraryListState,
  type LibraryListState,
  isDuplicateKey,
  type DuplicateGroup,
  type PathCollision,
  type SkippedFolder,
} from "./sources/libraryScan.js";
import { coreRegistry } from "./sources/coreRegistry.svelte.js";
import { dedicatedFolderPlacement, isLibrarySource } from "./sources/coreRegistry.js";

const COVER_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".bmp"]);

/**
 * Convert all cover images in the userRoms map to retro-go .img (JPEG) format.
 * Runs on ingest — originals on disk are untouched; only the in-memory session
 * cache holds the converted bytes.
 */
async function convertCoversInMap(userRoms: Map<string, LibraryFile>): Promise<void> {
  const toConvert: string[] = [];
  for (const path of userRoms.keys()) {
    // A non-first variant of a doubled path (see sources/libraryScan.ts). Its .img sidecar
    // would have to be named after the base path, i.e. the FIRST variant's sidecar - so the
    // first variant is the one that gets converted and this one is left as the raw source.
    if (isDuplicateKey(path)) continue;
    if (path.startsWith("covers/") && path.endsWith(".img")) continue; // already in .img format
    
    // Do not convert Pico-8 cartridges (which are .png files in the pico8/ folder)
    const lower = path.toLowerCase();
    const parts = lower.split("/");
    if (parts[0] === "pico8" && (lower.endsWith(".png") || lower.endsWith(".p8.png"))) {
      continue;
    }

    const dot = path.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = path.slice(dot).toLowerCase();
    if (COVER_IMAGE_EXTS.has(ext)) toConvert.push(path);
  }

  for (const path of toConvert) {
    try {
      const source = userRoms.get(path)!;
      const data = await romBytes(source);
      const blob = new Blob([data as BlobPart]);
      const gwBlob = await toGWCover(blob);
      if (gwBlob) {
        let imgPath = path.slice(0, path.lastIndexOf(".")) + ".img";
        if (!imgPath.startsWith("covers/")) {
          imgPath = "covers/" + imgPath;
        }
        // Retain the original high-quality image in userRoms for the UI to display,
        // but generate the .img sidecar for flashing.
        userRoms.set(imgPath, new Uint8Array(await gwBlob.arrayBuffer()));
      }
      // The original remains available through its file handle. Do not retain a second full
      // decoded copy for every cover after the background conversion pass.
      if (isLazy(source)) source.release?.();
    } catch (e) {
      dbg(`[covers] converting ${path} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

class LibraryStore {
  scan = $state<RomScanResult | null>(null);
  /** Set when a folder is required but not yet selected — drives FolderGateModal. */
  folderGatePrompt = $state<{
    sd: boolean;
    resolve: () => void;
    reject: (e: Error) => void;
  } | null>(null);
  savesScan = $state<RomScanResult | null>(null);
  /**
   * Paths offered by more than one folder with DIFFERENT content. Nothing is dropped: every
   * distinct variant is in `scan.userRoms` under its own key (see `sources/libraryScan.ts`), so
   * both show up as ordinary rows wherever the library is listed. This array is the index of
   * WHICH paths are doubled — diagnostic, not rendered.
   */
  scanCollisions = $state<PathCollision[]>([]);
  /** The same fact in full: every doubled path with each of its variants. Not rendered. */
  scanDuplicates = $state<DuplicateGroup[]>([]);
  /** Folders that contributed nothing, and why (duplicate, nested, unreadable, errored). */
  scanSkipped = $state<SkippedFolder[]>([]);
  /** Surviving path -> the `LocalFolderRow.id` its bytes came from. */
  fileOrigin = $state<Map<string, string>>(new Map());
  dirtyFiles = $state<Set<string>>(new Set());
  folderScanning = $state(false);
  /**
   * True once a registry-driven scan has FINISHED at least once. Distinguishes "not read yet"
   * from "nothing configured": before this, the Library is loading, never empty. It is never
   * reset — the registry is loaded once per session and rescans are incremental from there.
   */
  loaded = $state(false);
  /**
   * What the scan is currently chewing through. `done`/`total` count FOLDERS (the only real
   * denominator we have — a folder's file count is unknown until it has been walked), and
   * `current` is the relative path of the file being read. Both are runtime-derived; neither
   * is UI copy. Null whenever no scan is running.
   */
  /** Files read / files to read, plus the folder and file being read right now. FILES, not
   *  folders: with one ROM folder a folder-denominated bar sat at 0% while names streamed past
   *  and then jumped to 100%. `folder` is the local-folder id, so the line can say where. */
  progress = $state<{
    done: number; total: number; current: string; folder: string;
    layers?: { id: string; name: string; phase: string; done: number; total: number; status: "pending" | "active" | "done" }[];
    finalizing?: string | null;
  } | null>(null);
  error = $state<string | null>(null);
  // A remembered folder location from a prior visit that needs a permission re-grant before use.
  pendingHandle = $state<RomDirHandle | null>(null);
  // A remembered folder whose handle cannot be restored (the Firefox webkitdirectory fallback).
  // Reconnecting this row re-runs the picker and keeps its id, label, and associations.
  pendingFolderId = $state<string | null>(null);

  /** Folder selection is always supported (native FSAA or webkitdirectory fallback). */
  get supported(): boolean {
    return folderPickerSupported();
  }

  /** A folder has been picked + scanned. */
  get selected(): boolean {
    return this.scan !== null;
  }

  /** Source folder that owns a scanned path; falls back to the legacy primary folder. */
  writeDirFor(path: string): RomDirHandle | null {
    const id = this.fileOrigin.get(path);
    return (id ? localFolders.get(id)?.handle : undefined) as RomDirHandle | null ?? this.scan?.dir ?? null;
  }

  /**
   * The registry rows that feed the library, as one string. Reading this in an `$effect` is how
   * the UI subscribes to "the Sources list changed" — add/remove/repoint/grant all
   * reassign `localFolders.folders`, so all of them land here.
   */
  /**
   * Are the SOURCES still resolving?
   *
   * The library scan's signature includes each folder's resolved prefix, which comes from the
   * core registry, which is built from the active sources' manifests. Those arrive over the
   * network one at a time, so on a cold start the signature changed once per arrival and every
   * change threw away the scan and walked the folders again: four core sources meant up to four
   * full scans, which is why the progress bar appeared to restart.
   *
   * A row is "loading" until its manifest resolves. Waiting for that to clear means ONE scan on
   * startup, against a registry that already knows every console. After startup the signature
   * still drives rescans, which is what makes activating a core update the library immediately.
   */
  readonly sourcesResolving: boolean = $derived(sources.rows.some((r) => r.status === "loading"));

  readonly romFolderSignature: string = $derived(
    romFolderSignature(localFolders.folders, coreRegistry.current),
  );

  /** Which of the three list states the Library should render. See `libraryListState`. */
  readonly listState: LibraryListState = $derived(
    libraryListState({
      registryReady: localFolders.ready,
      loaded: this.loaded,
      scanning: this.folderScanning,
      hasScan: this.scan !== null,
    }),
  );

  private syncedSignature: string | null = null;
  private syncing = false;
  private syncPending = false;

  /**
   * THE library entry point for the UI. Rescans whenever the local-folder registry differs from
   * what is currently in `this.scan`, and no-ops otherwise — so it is safe to call from an
   * `$effect` that reads `romFolderSignature`.
   *
   * Replaces `restoreLast()`'s one-shot latch, which was the bug the owner reported: the latch
   * meant a ROM folder registered in the Sources tab after the first scan never appeared in the
   * Library until a reload.
   */
  async sync(): Promise<void> {
    if (this.syncing) {
      // A second consumer can call sync() while the first walk is still running. Queue another
      // pass only when the registry really changed; otherwise the duplicate call is already
      // covered by the walk in progress.
      // During the initial hydration there is no meaningful snapshot yet; a second consumer
      // observing the empty pre-load signature must not turn that into a queued duplicate pass.
      if (this.syncedSignature !== null && this.romFolderSignature !== this.syncedSignature) {
        this.syncPending = true;
      }
      return;
    }
    this.syncing = true;
    try {
      // Hydrate the folder registry before taking the signature snapshot. If the snapshot is
      // taken first, IndexedDB hydration changes `romFolderSignature` during the walk and the
      // in-flight guard correctly (but unnecessarily) queues a second full scan on startup.
      await localFolders.load();
      // The legacy single-folder record is also a registry mutation. Adopt it before taking the
      // snapshot; doing this inside `scanAllFolders()` makes the first pass observe a changed
      // signature and schedule a second pass for users migrating from the old storage key.
      try {
        const legacy = (await loadDir("romDir")) as RomDirHandle | null;
        if (legacy) await migrateLegacyRomDir(legacy, localFolders, defaultLibraryScanDeps);
      } catch {
        // `scanAllFolders()` retains the guarded migration path and will report any real failure.
      }
      do {
        this.syncPending = false;
        const sig = this.romFolderSignature;
        if (this.loaded && this.syncedSignature === sig) break;
        this.syncedSignature = sig;
        await this.scanAllFolders();
      } while (this.syncPending);
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Force a rescan of every registered library folder, even when the registry has not changed.
   *
   * `sync()` deliberately no-ops on an unchanged `romFolderSignature`, which is what makes it
   * safe to call from an `$effect` on every tick. That is exactly wrong for a refresh the user
   * asked for: the signature covers the REGISTRY (which folders, their grants, their resolved
   * prefixes), not the files inside them, so adding a ROM on disk changes nothing it can see.
   * Clearing the synced signature first is the same idiom `pickFolder` and `reconnect` already
   * use; this is its one public door, so a caller never reaches into the private field.
   */
  async refresh(): Promise<void> {
    this.syncedSignature = null;
    await this.sync();
  }

  /** Prompt for a folder, register it + rebuild the library. No-op on cancel. */
  async pickFolder(): Promise<void> {
    this.folderScanning = true;
    this.error = null;
    try {
      const dir = await pickRomFolder();
      if (dir) {
        // Register the pick in `localFolders` (the multi-folder list is the source of truth
        // now) and then re-merge EVERY ROM folder, so a second pick adds to the library
        // instead of replacing it. `migrateLegacyRomDir` is the idempotent add: it no-ops
        // when this exact directory is already registered.
        await localFolders.load();
        await migrateLegacyRomDir(dir, localFolders, defaultLibraryScanDeps);
        this.pendingHandle = null;
        // Only persist native FSAA handles — InputDirHandle shims aren't structured-cloneable
        // "romDir" is an IndexedDB STORAGE KEY, not a name: it identifies data already
        // persisted in real users' browsers. It was deliberately left alone when the store
        // was renamed roms -> library, because renaming it would silently orphan every
        // existing user's remembered folder.
        if (dirSupportsWriteBack(dir)) void saveDir("romDir", dir);
        this.folderScanning = false;
        // Never scan eagerly before registration — the pick is now registered, so the library
        // rebuilds once from the registry via sync().
        this.syncedSignature = null;
        await this.sync();
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      // `library.error` is write-only: NO component reads it, so this was the quietest failure
      // in the app. `pickRomFolder` returns null on a cancel rather than throwing, so
      // anything arriving here is a real read failure and not the user closing the picker.
      auditLog.add("error", "sources", msg((t) => t.shared.auditLog.foldersFailed, this.error));
    } finally {
      this.folderScanning = false;
    }
  }

  async pickSavesFolder(): Promise<void> {
    this.folderScanning = true;
    try {
      const result = await pickAndScanRomFolder();
      if (!result) return;
      this.savesScan = result;
    } catch (e) {
      dbg(`[saves] picking the saves folder failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.folderScanning = false;
    }
  }

  /** Silently re-adopt every registered ROM folder if permission is still granted (no prompt).
   *  If a remembered folder needs a re-grant, or Firefox can only restore its metadata, stash
   *  the recovery target so the UI can offer a reconnect button. */
  /** @deprecated Kept as a thin alias for `sync()`; there is only one entry point now. */
  async restoreLast(): Promise<void> {
    await this.sync();
  }

  /**
   * Walk every library directory in `localFolders` (see `romFolderSources` for which those
   * are) and merge them into one de-duplicated
   * scan. The dedup itself lives in `sources/libraryScan.ts` (identity, then path+size, then
   * hash — in that order, so a duplicate-free library hashes nothing at all).
   *
   * A folder that cannot be read is skipped and reported in `scanSkipped`, never treated as an
   * empty folder and never allowed to take the readable folders down with it.
   */
  async scanAllFolders(): Promise<void> {
    this.folderScanning = true;
    this.error = null;
    this.pendingHandle = null;
    this.pendingFolderId = null;
    let lipClaimed = false;
    try {
      await localFolders.load();

      // Migration: a user who only ever had the single "romDir" folder keeps it, as an "Any"
      // directory. Idempotent (isSameEntry against what is already registered), and the
      // "romDir" key is deliberately left in place so this stays reversible.
      // "romDir": storage key, not a name — see the note at the saveDir() call above.
      const legacy = (await loadDir("romDir")) as RomDirHandle | null;
      if (legacy) await migrateLegacyRomDir(legacy, localFolders, defaultLibraryScanDeps);

      // The registry, and only the registry. See `romFolderSources` — the core registry is
      // passed so a folder dedicated to a single-system core files its loose ROMs under that
      // console instead of dropping them for having no console directory.
      const sources = romFolderSources(localFolders.folders, coreRegistry.current);
      const pendingSource = sources.find((s) => s.status !== "ready");
      this.pendingFolderId = pendingSource?.id ?? null;
      if (pendingSource?.handle) this.pendingHandle = pendingSource.handle as RomDirHandle;
      // WHERE A FOLDER'S LOOSE FILES ARE GOING, per folder, before a byte is read. A BIOS that
      // is in a marked folder and still reported missing fails somewhere between the marking and
      // the placement, and none of those steps says anything today. Prints the decision INPUTS
      // (`usedBy` verbatim) beside the decision (`placement`), because the interesting failures
      // are a key that is not what it was expected to be and a placement that came out null.
      // Once per scan, not per file. Runtime diagnostic text, so no string table entry.
      dbg("[library] folders:", JSON.stringify(
        localFolders.folders.map((f) => ({
          id: f.id,
          status: f.status,
          usedBy: f.usedBy,
          scanned: isLibrarySource(coreRegistry.current, f.usedBy ?? []),
          placement: dedicatedFolderPlacement(coreRegistry.current, f.usedBy ?? []),
        })),
      ));
      dbg("[library] registry:", JSON.stringify({
        authoritative: coreRegistry.current.systems.length > 0,
        systems: coreRegistry.current.systems.length,
        biosNames: coreRegistry.current.systems
          .filter((sys) => sys.biosFilenames.length > 0)
          .map((sys) => `${sys.id}:${sys.biosFilenames.join("|")}`),
      }));
      this.progress = { done: 0, total: 0, current: "", folder: "" };

      // Nothing readable, but we do hold a remembered folder: offer the recovery affordance
      // rather than showing an empty library.
      if (!sources.some((s) => s.status === "ready")) {
        if (sources.length === 0) return;
      }

      // Count first, read second. Enumerating entries opens no files, so this is cheap next to
      // the walk it measures, and it gives the bar a denominator it can actually reach.
      let totalFiles = 0;
      const sourceTotals = new Map<string, number>();
      for (const src of sources) {
        if (src.status !== "ready") continue;
        try {
          const count = await countRomDirectory(src.handle as RomDirHandle);
          sourceTotals.set(src.id, count);
          totalFiles += count;
        } catch {
          // A folder that cannot be counted is one that cannot be read either; the scan below
          // reports it through `scanSkipped`. Leaving it out of the total keeps the bar honest.
        }
      }
      let doneFiles = 0;
      let lastTick = 0;
      const layers: { id: string; name: string; phase: string; done: number; total: number; status: "pending" | "active" | "done" }[] = sources.filter((s) => s.status === "ready").map((s) => ({
        id: s.id,
        name: displayName(localFolders.get(s.id) ?? { name: "", folderName: s.id }),
        phase: "Finding games",
        done: 0,
        total: sourceTotals.get(s.id) ?? 0,
        status: "pending" as const,
      }));
      this.progress = { done: 0, total: totalFiles, current: "", folder: "", layers, finalizing: null };
      lipProgress.operationProgress("library-scan", 0);
      lipClaimed = true;
      const merged = await scanLibraryFolders(sources, {
        ...defaultLibraryScanDeps,
        scan: async (src) => {
          const layer = layers.find((l) => l.id === src.id);
          if (layer) {
            layer.status = "active";
            layer.phase = "Loading games";
            this.progress = { ...this.progress!, layers: [...layers] };
          }
          const r = await scanRomDirectory(src.handle as RomDirHandle, (rel) => {
            doneFiles++;
            // Throttled: a 1000-ROM folder must not queue 1000 reactive updates. The COUNT is
            // still exact -- only the repaint is throttled.
            const now = Date.now();
            if (now - lastTick < 80) return;
            lastTick = now;
            if (layer) {
              layer.done++;
            }
            this.progress = { done: doneFiles, total: totalFiles, current: rel, folder: src.id, layers: [...layers], finalizing: null };
            if (totalFiles > 0) lipProgress.operationProgress("library-scan", doneFiles / totalFiles);
          });
          if (layer) {
            layer.status = "done";
            layer.phase = "Ready";
            layer.done = layer.total;
          }
          this.progress = { done: doneFiles, total: totalFiles, current: "", folder: src.id, layers: [...layers], finalizing: null };
          // `hasRomsPrefix` is kept PER FOLDER: one folder's `roms/` layout must never
          // reinterpret another's (scanRomDirectory has already stripped the prefix locally).
          return { files: r.userRoms, hasRomsPrefix: !!r.hasRomsPrefix };
        },
      });

      this.scanCollisions = merged.collisions;
      this.scanDuplicates = merged.duplicates;
      this.scanSkipped = merged.skipped;
      if (merged.scanned.length === 0) return;

      const userRoms = merged.files;
      if (this.progress) this.progress = { ...this.progress, finalizing: "Organizing library" };
      const primaryId = merged.scanned[0].id;
      this.scan = {
        userRoms,
        summary: summarize(userRoms),
        // The write-back target (cover art, etc.) is the FIRST readable folder — a single
        // handle is all `saveFileToDirOrDownload` can take, and a deterministic choice beats
        // a random one. `fileOrigin` says where each file actually came from.
        dir: localFolders.get(primaryId)?.handle as RomDirHandle,
        hasRomsPrefix: merged.scanned[0].hasRomsPrefix,
      };
      this.fileOrigin = merged.origin;
      this.pendingHandle = null;
      this.clearDirty();

      // Cover conversion is derived session data. Publish the library first, then build .img
      // sidecars in the background so a large cover set cannot delay the first usable list.
      void convertCoversInMap(userRoms).catch((e) => {
        dbg(`[covers] background conversion failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      // `library.error` is write-only: NO component reads it, so this was the quietest failure
      // in the app. `pickAndScanRomFolder` returns null on a cancel rather than throwing, so
      // anything arriving here is a real read failure and not the user closing the picker.
      auditLog.add("error", "sources", msg((t) => t.shared.auditLog.foldersFailed, this.error));
    } finally {
      if (lipClaimed) lipProgress.operationProgress("library-scan", null);
      this.folderScanning = false;
      this.loaded = true;
      this.progress = null;
    }
  }

  /**
   * Reconnect the remembered folder (call from a user gesture) and rebuild. Native handles get a
   * permission re-grant; Firefox's read-only picker fallback re-picks the folder into the
   * existing row.
   *
   * This used to call `adoptHandle()`, which scanned that ONE directory and assigned the result
   * straight to `this.scan` — a second, registry-bypassing way for games to enter the Library,
   * and one that silently dropped every other registered ROM folder. Now the re-grant is
   * recorded on the registry row that owns the handle (so the Sources tab shows it as `ready`
   * too) and the library is rebuilt from the registry like any other change.
   */
  async reconnect(): Promise<void> {
    const handle = this.pendingHandle;
    const folderId = this.pendingFolderId;
    if (!handle && !folderId) return;
    if (handle && dirSupportsWriteBack(handle)) {
      if (!(await handlePermission(handle, "readwrite", true))) return;
      for (const f of localFolders.folders) {
        if (!f.handle) continue;
        if (await defaultLibraryScanDeps.isSameEntry(f.handle, handle)) {
          await localFolders.grant(f.id);
          break;
        }
      }
    } else {
      // Firefox's webkitdirectory fallback returns an in-memory, read-only tree. There is no
      // permission to re-grant and no native handle to restore, but the persisted row still
      // gives us a stable recovery target. Re-pick it rather than creating a second row.
      const picked = await pickRomFolder();
      if (!picked) return;
      if (!folderId) throw new Error("Cannot reconnect a folder without an id.");
      await localFolders.repoint(folderId, picked);
    }
    this.pendingHandle = null;
    this.pendingFolderId = null;
    this.syncedSignature = null;
    await this.sync();
  }

  clear(): void {
    this.scan = null;
    this.syncedSignature = null;
    this.savesScan = null;
    this.scanCollisions = [];
    this.scanDuplicates = [];
    this.scanSkipped = [];
    this.fileOrigin = new Map();
    this.clearDirty();
    this.error = null;
    this.pendingHandle = null;
    this.pendingFolderId = null;
  }

  /** Ensure the required folders are available. Resolves immediately if already satisfied;
   *  otherwise surfaces FolderGateModal and waits for the user to provide them. */
  async ensureFolders(sd: boolean): Promise<void> {
    // The remembered card is read back from IndexedDB, so it is NOT there synchronously on a
    // fresh load. Without this await the gate reads `device.sdHandle` while the restore is
    // still in flight, concludes there is no card and raises the modal for one the app is
    // about to hold -- which is exactly how a remembered card still asked to be picked again.
    // Resolves instantly once the restore has settled, so a later call costs nothing.
    if (sd) await device.whenSdRestored();
    // Gate on a REGISTERED ROM folder, never on `this.selected` (= "a scan is in memory this
    // session"), which is false after every reload and before the first scan resolves. See
    // `romFolderGateNeeded` in sources/libraryScan.ts for the full rule, including why a
    // needs-permission/missing row still counts and how the not-yet-loaded store is handled.
    if (!(await romFolderGateNeeded(localFolders)) && (!sd || !!device.sdHandle)) return;
    return new Promise<void>((resolve, reject) => {
      this.folderGatePrompt = { sd, resolve, reject };
    });
  }

  /** Always surface FolderGateModal, even if folders are already satisfied — for a "change
   *  folder(s)" affordance (unlike ensureFolders, which no-ops when already satisfied). */
  openFolderGate(sd: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.folderGatePrompt = { sd, resolve, reject };
    });
  }

  resolveFolderGate(): void {
    const p = this.folderGatePrompt;
    this.folderGatePrompt = null;
    p?.resolve();
  }

  cancelFolderGate(): void {
    const p = this.folderGatePrompt;
    this.folderGatePrompt = null;
    p?.reject(new Error("Folder selection cancelled."));
  }

  markDirty(path: string) {
    this.dirtyFiles.add(path);
    // Force reactivity in Svelte 5 by reassigning the Set
    this.dirtyFiles = new Set(this.dirtyFiles);
  }

  clearDirty() {
    this.dirtyFiles = new Set();
  }
}

export const library = new LibraryStore();
