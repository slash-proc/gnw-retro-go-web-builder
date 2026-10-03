// Shared library (ROM-folder) state. Library management is gated on a selected ROM folder (NOT on a
// device connection — ROMs are the prerequisite; a device is only needed to flash-install
// or SD-push). The folder is picked + scanned once via romScan and reused across the tab.
// (RomSection in the Retro-Go tab can migrate onto this store later.)
import {
  pickAndScanRomFolder,
  folderPickerSupported,
  dirSupportsWriteBack,
  summarize,
  type RomScanResult,
  type RomDirHandle,
  romBytes,
  type LibraryFile,
  type ZipScanCacheEntry,
  LazyRom,
  readRomFile,
  sha1File,
} from "./romScan.js";
import { scanLibraryDirectory, setLibraryDirectoryPaused } from "./libraryDirectoryWorker.js";
import { saveDir, loadDir, deleteDir, handlePermission, loadSel, saveSel, loadLibraryIndex, saveLibraryIndex } from "./persist.js";
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
  basePath,
  type DuplicateGroup,
  type PathCollision,
  type SkippedFolder,
} from "./sources/libraryScan.js";
import { coreRegistry } from "./sources/coreRegistry.svelte.js";
import { dedicatedFolderPlacement, isLibrarySource, nativeArchiveRulesFor } from "./sources/coreRegistry.js";
import { coverBlobStore } from "./screenscraper/coverStore.js";
import { libraryCoverCacheKey, libraryFileMetaFromScan, sameLibraryFileMeta, type LibraryFileMeta, type LibraryRom } from "./sources/libraryModel.js";
import { zipExtractOne, type ZipEntry } from "./unzip.js";
import { measureLibraryPhase, measureLibraryPhaseAsync } from "./libraryPerformance.js";

const COVER_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
const ZIP_SCAN_CACHE_KEY = "library-zip-scan-cache.v1";
const LIBRARY_METADATA_KEY = "library-metadata-index.v1";
type PersistedZipScanCache = Record<string, Record<string, ZipScanCacheEntry>>;
type PersistedLibraryMetadata = Record<string, Record<string, LibraryFileMeta>>;

function jsHeapMiB(): string {
  const used = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize;
  return used === undefined ? "unavailable" : (used / 1048576).toFixed(1);
}

interface CachedLibraryFile {
  key: string;
  origin: string;
  meta: LibraryFileMeta;
  archive: string;
  zipEntry?: ZipEntry;
}
interface CachedLibraryIndex {
  version: 1;
  primaryId: string;
  hasRomsPrefix: boolean;
  /** The configured readable library sources when this snapshot was made. */
  sourceIds: string[];
  files: CachedLibraryFile[];
}

/** IndexedDB data is an optimization, never trusted input. A malformed/old record simply
 * behaves like a cache miss and the ordinary scanner rebuilds it. */
function isCachedLibraryIndex(value: unknown): value is CachedLibraryIndex {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CachedLibraryIndex>;
  return candidate.version === 1
    && typeof candidate.primaryId === "string"
    && typeof candidate.hasRomsPrefix === "boolean"
    && Array.isArray(candidate.sourceIds)
    && candidate.sourceIds.every((id) => typeof id === "string")
    && Array.isArray(candidate.files)
    && candidate.files.every((file) => !!file
      && typeof file.key === "string"
      && typeof file.origin === "string"
      && typeof file.archive === "string"
      && !!file.meta
      && typeof file.meta.relativePath === "string"
      && typeof file.meta.filename === "string"
      && typeof file.meta.extension === "string"
      && typeof file.meta.size === "number"
      && (file.meta.sha1 === undefined || typeof file.meta.sha1 === "string"));
}

function loadLibraryMetadata(): Map<string, Map<string, LibraryFileMeta>> {
  const persisted = loadSel<PersistedLibraryMetadata>(LIBRARY_METADATA_KEY, {});
  return new Map(Object.entries(persisted).map(([sourceId, entries]) => [
    sourceId,
    new Map(Object.entries(entries)),
  ]));
}

function saveLibraryMetadata(cache: Map<string, Map<string, LibraryFileMeta>>): void {
  const persisted: PersistedLibraryMetadata = {};
  for (const [sourceId, entries] of cache) persisted[sourceId] = Object.fromEntries(entries);
  saveSel(LIBRARY_METADATA_KEY, persisted);
}

let metadataSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleLibraryMetadataSave(cache: Map<string, Map<string, LibraryFileMeta>>): void {
  if (metadataSaveTimer) clearTimeout(metadataSaveTimer);
  metadataSaveTimer = setTimeout(() => {
    metadataSaveTimer = null;
    try {
      saveLibraryMetadata(cache);
    } catch (error) {
      // The metadata index is an optimization. Quota/private-mode failures must never turn a
      // successful ROM scan into a failed library or prevent SD sync.
      dbg(`[library] metadata index not persisted: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, 0);
}

function loadZipScanCache(): Map<string, Map<string, ZipScanCacheEntry>> {
  const persisted = loadSel<PersistedZipScanCache>(ZIP_SCAN_CACHE_KEY, {});
  return new Map(Object.entries(persisted).map(([sourceId, entries]) => [
    sourceId,
    new Map(Object.entries(entries)),
  ]));
}

function saveZipScanCache(cache: Map<string, Map<string, ZipScanCacheEntry>>): void {
  const persisted: PersistedZipScanCache = {};
  for (const [sourceId, entries] of cache) persisted[sourceId] = Object.fromEntries(entries);
  saveSel(ZIP_SCAN_CACHE_KEY, persisted);
}

/**
 * Convert all cover images in the userRoms map to retro-go .img (JPEG) format.
 * Runs when an SD sync or FrogFS flash needs device-format covers — originals on disk are untouched;
 * converted bytes are reused through the persistent OPFS cover cache and mirrored into
 * the in-memory session map for the current install.
 */
export async function convertCoversInMap(
  userRoms: Map<string, LibraryFile>,
  fileOrigin: ReadonlyMap<string, string> = new Map(),
  shouldConvert?: (path: string) => boolean,
): Promise<void> {
  const derivedCoverCache = coverBlobStore();
  const toConvert: string[] = [];
  for (const path of userRoms.keys()) {
    if (shouldConvert && !shouldConvert(path)) continue;
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

  const convertOne = async (path: string): Promise<void> => {
    try {
      const source = userRoms.get(path)!;
      const sourceStamp = typeof source === "object" && source !== null && "lastModified" in source
        ? (source as { lastModified?: number }).lastModified
        : undefined;
      const cacheKey = libraryCoverCacheKey(fileOrigin.get(path), path, source.length, sourceStamp);
      const cached = await derivedCoverCache.get(cacheKey);
      const imgPath = path.slice(0, path.lastIndexOf(".")) + ".img";
      const devicePath = imgPath.startsWith("covers/") ? imgPath : `covers/${imgPath}`;
      if (cached) {
        userRoms.set(devicePath, cached.bytes);
        if (isLazy(source)) source.release?.();
        return;
      }
      const data = await romBytes(source);
      const blob = new Blob([data as BlobPart]);
      const gwBlob = await toGWCover(blob);
      if (gwBlob) {
        const converted = new Uint8Array(await gwBlob.arrayBuffer());
        // Retain the original high-quality image in userRoms for the UI to display,
        // but generate the .img sidecar for flashing.
        userRoms.set(devicePath, converted);
        await derivedCoverCache.put(cacheKey, converted, "image/jpeg");
      }
      // The original remains available through its file handle. Do not retain a second full
      // decoded copy for every cover after the background conversion pass.
      if (isLazy(source)) source.release?.();
    } catch (e) {
      dbg(`[covers] converting ${path} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  // Cover conversion is an SD-sync operation, not a reason to serialize hundreds of unrelated
  // images. A small bounded batch keeps throughput high without creating an image decode and
  // OPFS-write storm that competes with the rest of the sync UI.
  const CONVERSION_CONCURRENCY = 4;
  for (let i = 0; i < toConvert.length; i += CONVERSION_CONCURRENCY) {
    await Promise.all(toConvert.slice(i, i + CONVERSION_CONCURRENCY).map(convertOne));
  }
}

/** Persist one already-converted device cover without forcing a whole-library conversion pass. */
export async function cacheDerivedCover(
  relativePath: string,
  sourceId: string | undefined,
  sourceSize: number,
  bytes: Uint8Array,
  lastModified?: number,
): Promise<void> {
  await coverBlobStore().put(
    libraryCoverCacheKey(sourceId, relativePath, sourceSize, lastModified),
    bytes,
    "image/jpeg",
  );
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
  /** Case-folded path lookup used by cover resolution; avoids scanning the whole library per tile. */
  private filePathIndex: Map<string, LibraryFile> | null = null;
  private filePathIndexFiles: Map<string, LibraryFile> | null = null;
  private filePathIndexSize = -1;
  dirtyFiles = $state<Set<string>>(new Set());
  folderScanning = $state(false);
  private scanPauseReasons = new Set<string>();
  private scanResumeWaiters = new Set<() => void>();
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
    stage: string; done: number; total: number; current: string; folder: string;
    layers?: { id: string; name: string; phase: string; done: number; total: number; status: "pending" | "active" | "done" }[];
    finalizing?: string | null;
  } | null>(null);
  backgroundTask = $state<{ id: number; stage: string; done: number; total: number; detail: string } | null>(null);
  error = $state<string | null>(null);
  // A remembered folder location from a prior visit that needs a permission re-grant before use.
  pendingHandle = $state<RomDirHandle | null>(null);

  setScanInteraction(reason: string, active: boolean): void {
    if (active) {
      this.scanPauseReasons.add(reason);
      setLibraryDirectoryPaused(true);
      return;
    }
    this.scanPauseReasons.delete(reason);
    if (this.scanPauseReasons.size === 0) {
      setLibraryDirectoryPaused(false);
      for (const resume of this.scanResumeWaiters) resume();
      this.scanResumeWaiters.clear();
    }
  }

  waitForUiIdle(): Promise<void> {
    if (this.scanPauseReasons.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.scanResumeWaiters.add(resolve));
  }

  private waitForScanResume(): Promise<void> {
    return this.waitForUiIdle();
  }

  /** Live, read-only state for diagnosing scans that stop advancing behind an interaction gate. */
  get scanDiagnostics() {
    return {
      pauseReasons: [...this.scanPauseReasons],
      resumeWaiters: this.scanResumeWaiters.size,
      progress: this.progress ? { stage: this.progress.stage, done: this.progress.done, total: this.progress.total, current: this.progress.current } : null,
    };
  }

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

  /** The writable directory that owns this ROM, even when another source has the same path. */
  writeDirForRom(rom: Pick<LibraryRom, "file" | "directorySource">): RomDirHandle | null {
    const id = rom.directorySource?.id;
    return (id ? localFolders.get(id)?.handle : undefined) as RomDirHandle | null
      ?? this.writeDirFor(rom.file.relativePath);
  }

  /**
   * Add or replace a source-owned runtime file without stealing an identically named file from
   * another shared directory.  Scraped covers use this before the next filesystem scan sees the
   * persisted original.
   */
  setFileForSource(path: string, file: LibraryFile, sourceId?: string): string {
    const files = this.scan?.userRoms;
    if (!files) return path;
    let key = path;
    if (sourceId && files.has(path) && this.fileOrigin.get(path) !== sourceId) {
      const existing = [...files.keys()].find((candidate) =>
        basePath(candidate).toLowerCase() === path.toLowerCase()
        && this.fileOrigin.get(candidate) === sourceId,
      );
      key = existing ?? `${path}\u0000import-${sourceId}`;
    }
    files.set(key, file);
    if (sourceId) this.fileOrigin.set(key, sourceId);
    this.filePathIndex = null;
    this.filePathIndexFiles = null;
    this.filePathIndexSize = -1;
    return key;
  }

  /** Resolve a source-relative path, including case-folded duplicate-key variants. */
  fileForPath(relativePath: string, sourceId?: string): LibraryFile | null {
    const files = this.scan?.userRoms;
    if (!files) return null;
    const exact = files.get(relativePath);
    if (exact && (!sourceId || this.fileOrigin.get(relativePath) === sourceId)) {
      return exact;
    }
    if (this.filePathIndexFiles !== files || this.filePathIndexSize !== files.size) {
      const index = new Map<string, LibraryFile>();
      for (const [key, entry] of files) {
        const folded = basePath(key).toLowerCase();
        const origin = this.fileOrigin.get(key) ?? "";
        const sourceKey = `${origin}\u0000${folded}`;
        if (!index.has(sourceKey)) index.set(sourceKey, entry);
        if (!index.has(`\u0000${folded}`)) index.set(`\u0000${folded}`, entry);
      }
      this.filePathIndex = index;
      this.filePathIndexFiles = files;
      this.filePathIndexSize = files.size;
    }
    const folded = relativePath.toLowerCase();
    return this.filePathIndex?.get(`${sourceId ?? ""}\u0000${folded}`)
      ?? (!sourceId ? this.filePathIndex?.get(`\u0000${folded}`) : null)
      ?? null;
  }

  /** Resolve a model ROM to its lazy scanned entry without making UI consumers parse keys. */
  fileForRom(rom: Pick<LibraryRom, "file" | "directorySource">): LibraryFile | null {
    return this.fileForPath(rom.file.relativePath, rom.directorySource?.id);
  }

  /** A payload digest is reusable only for this exact source-relative metadata record. */
  sha1ForPath(relativePath: string, sourceId: string): string | undefined {
    return this.sourceMetadataCache.get(sourceId)?.get(relativePath)?.sha1;
  }

  /** Record a discovery digest so later converter checks avoid rereading unchanged candidates. */
  rememberSha1ForPath(relativePath: string, sourceId: string, sha1: string): void {
    const files = this.scan?.userRoms;
    const entry = files ? this.fileForPath(relativePath, sourceId) : null;
    if (!entry) return;
    const byPath = this.sourceMetadataCache.get(sourceId) ?? new Map<string, LibraryFileMeta>();
    const current = byPath.get(relativePath);
    const meta = libraryFileMetaFromScan(relativePath, entry);
    if (current && sameLibraryFileMeta(sourceId, current, meta) && current.sha1 === sha1) return;
    byPath.set(relativePath, { ...meta, sha1 });
    this.sourceMetadataCache.set(sourceId, byPath);
    scheduleLibraryMetadataSave(this.sourceMetadataCache);
  }

  /** Resolve a ROM's source-side cover without making consumers rebuild sibling paths. */
  coverFileForRom(
    rom: Pick<LibraryRom, "file" | "directorySource" | "cover">,
    lowResolution = false,
  ): { path: string; file: LibraryFile } | null {
    const cover = rom.cover;
    if (!cover) return null;
    const paths = lowResolution
      ? [cover.carouselPath, cover.deviceImgPath, ...cover.originalPaths]
      : [...cover.originalPaths, cover.carouselPath, cover.deviceImgPath];
    for (const path of paths) {
      const file = this.fileForPath(path, rom.directorySource?.id);
      if (file) return { path, file };
    }
    return null;
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
  private cachedValidationPending = false;
  private fullMetadataReadRequested = false;
  /** Explicit metadata refresh also invalidates BIOS ZIPs omitted by the ROM classifier. */
  archiveRefreshRevision = $state(0);
  /** Per-source metadata cache. Values are lazy entries, never a second copy of ROM bytes. */
  private sourceFileCache = new Map<string, Map<string, LibraryFile>>();
  /** ZIP central-directory metadata only; archive bytes are never retained here. */
  private sourceZipCache = loadZipScanCache();
  /** Persisted metadata only; no handles, providers or payload bytes. */
  private sourceMetadataCache = loadLibraryMetadata();
  private cacheHydrationAttempted = false;

  /** Restore the previous scan as real lazy entries before the filesystem validation starts. */
  private async hydrateCachedIndex(): Promise<void> {
    return measureLibraryPhaseAsync("cached-index-hydration", null, () => this.hydrateCachedIndexImpl());
  }

  private async hydrateCachedIndexImpl(): Promise<void> {
    if (this.cacheHydrationAttempted || this.scan) return;
    this.cacheHydrationAttempted = true;
    const cached = await loadLibraryIndex<CachedLibraryIndex>();
    if (!isCachedLibraryIndex(cached) || cached.files.length === 0) return;
    const activeSources = romFolderSources(localFolders.folders, coreRegistry.current)
      .filter((source) => source.status === "ready" && !!source.handle);
    const available = new Map(
      activeSources.map((source) => [source.id, source.handle as RomDirHandle]),
    );
    const currentSourceIds = [...available.keys()].sort();
    if (!cached.sourceIds || cached.sourceIds.slice().sort().join("\0") !== currentSourceIds.join("\0")) return;
    if (!available.has(cached.primaryId)) return;
    const hydratedBySource = new Map<string, Map<string, LibraryFile>>();
    measureLibraryPhase("hydrate-index-build", cached.files.length, () => {
      for (const entry of cached.files) {
        const dir = available.get(entry.origin);
        if (!dir) continue;
        const load = async (): Promise<Uint8Array> => {
          const file = await readRomFile(dir, entry.archive);
          if (entry.zipEntry) return zipExtractOne(new Uint8Array(await file.arrayBuffer()), entry.zipEntry);
          return new Uint8Array(await file.arrayBuffer());
        };
        const sourceFiles = hydratedBySource.get(entry.origin) ?? new Map<string, LibraryFile>();
        sourceFiles.set(entry.key, new LazyRom(
          entry.meta.size,
          load,
          entry.archive,
          entry.meta.lastModified,
          entry.zipEntry,
          entry.zipEntry ? undefined : async () => {
            return sha1File(await readRomFile(dir, entry.archive));
          },
        ));
        hydratedBySource.set(entry.origin, sourceFiles);
        if (entry.meta.sha1) {
          const byPath = this.sourceMetadataCache.get(entry.origin) ?? new Map<string, LibraryFileMeta>();
          byPath.set(basePath(entry.key), entry.meta);
          this.sourceMetadataCache.set(entry.origin, byPath);
        }
      }
    });
    const files = new Map<string, LibraryFile>();
    const origin = new Map<string, string>();
    for (const [sourceId, sourceFiles] of hydratedBySource) {
      const reusedFiles = this.reuseUnchangedSourceFiles(sourceId, sourceFiles);
      for (const [key, file] of reusedFiles) {
        files.set(key, file);
        origin.set(key, sourceId);
      }
    }
    if (files.size === 0) return;
    const summary = measureLibraryPhase("hydrate-summary", files.size, () => summarize(files));
    this.scan = {
      userRoms: files,
      summary,
      dir: available.get(cached.primaryId)!,
      hasRomsPrefix: cached.hasRomsPrefix,
    };
    this.fileOrigin = origin;
    this.filePathIndex = null;
    this.filePathIndexFiles = null;
    this.filePathIndexSize = -1;
    this.loaded = true;
    this.cachedValidationPending = true;
    dbg(`[library] hydrated ${files.size} cached entries; validating sources in background`);
  }

  private cachedDirectorySnapshot(sourceId: string) {
    const known = new Map<string, { path: string; size: number; lastModified: number }>();
    const archives = this.sourceZipCache.get(sourceId);
    for (const file of this.sourceFileCache.get(sourceId)?.values() ?? []) {
      if (!isLazy(file)) continue;
      const lazy = file as LazyRom;
      if (lazy.lastModified === undefined) continue;
      if (lazy.zipEntry) {
        const archive = archives?.get(lazy.archive);
        if (archive?.lastModified !== undefined) known.set(lazy.archive, { path: lazy.archive, size: archive.size, lastModified: archive.lastModified });
      } else {
        known.set(lazy.archive, { path: lazy.archive, size: lazy.length, lastModified: lazy.lastModified });
      }
    }
    // Rejected archives are physical files too, even though they have no library row.
    for (const [path, archive] of archives ?? []) {
      if (archive.lastModified !== undefined) known.set(path, { path, size: archive.size, lastModified: archive.lastModified });
    }
    return [...known.values()];
  }

  private persistCachedIndex(
    files: Map<string, LibraryFile>,
    origin: ReadonlyMap<string, string>,
    primaryId: string,
    hasRomsPrefix: boolean,
    sourceIds: readonly string[],
  ): void {
    const index: CachedLibraryIndex = {
      version: 1,
      primaryId,
      hasRomsPrefix,
      sourceIds: [...sourceIds].sort(),
      files: [...files].flatMap(([key, file]) => {
        const sourceId = origin.get(key);
        if (!sourceId) return [];
        const lazy = isLazy(file) ? file as LazyRom : null;
        const scanMeta = libraryFileMetaFromScan(key, file);
        const remembered = this.sourceMetadataCache.get(sourceId)?.get(basePath(key));
        return [{
          key,
          origin: sourceId,
          meta: remembered && sameLibraryFileMeta(sourceId, remembered, scanMeta) && remembered.sha1
            ? { ...scanMeta, sha1: remembered.sha1 }
            : scanMeta,
          archive: lazy?.archive ?? basePath(key),
          ...(lazy?.zipEntry ? { zipEntry: lazy.zipEntry } : {}),
        }];
      }),
    };
    void saveLibraryIndex(index);
  }

  private reuseUnchangedSourceFiles(sourceId: string, files: Map<string, LibraryFile>): Map<string, LibraryFile> {
    const previous = this.sourceFileCache.get(sourceId);
    if (!previous) {
      this.sourceFileCache.set(sourceId, files);
      return files;
    }
    const next = new Map<string, LibraryFile>();
    for (const [path, entry] of files) {
      const old = previous.get(path);
      const unchanged = isLazy(old) && isLazy(entry) && sameLibraryFileMeta(
        sourceId,
        libraryFileMetaFromScan(path, old),
        libraryFileMetaFromScan(path, entry),
      );
      if (unchanged) {
        next.set(path, old);
        if (entry !== old) entry.release?.();
      } else {
        next.set(path, entry);
        if (old && old !== entry && isLazy(old)) old.release?.();
      }
    }
    for (const [path, old] of previous) {
      if (!next.has(path) && isLazy(old)) old.release?.();
    }
    this.sourceFileCache.set(sourceId, next);
    return next;
  }

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
      // A prompt may have been created while the registry was still hydrating. Once sync has
      // observed a registered directory, that setup prompt is stale and must not remain over the
      // configured library.
      if (localFolders.folders.length > 0 && this.folderGatePrompt) this.resolveFolderGate();
      // The saved index has only metadata plus source-relative file provenance. Hydrate it
      // before the normal scan so the UI is usable immediately; the loop below always performs
      // the real directory walk and atomically replaces this optimistic snapshot.
      await this.hydrateCachedIndex();
      do {
        this.syncPending = false;
        const sig = this.romFolderSignature;
        if (this.loaded && this.syncedSignature === sig && !this.fullMetadataReadRequested) break;
        const validateCachedNames = this.cachedValidationPending && !this.fullMetadataReadRequested;
        this.cachedValidationPending = false;
        this.fullMetadataReadRequested = false;
        this.syncedSignature = sig;
        await this.scanAllFolders(validateCachedNames);
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
    this.fullMetadataReadRequested = true;
    this.cachedValidationPending = false;
    if (this.syncing) this.syncPending = true;
    this.syncedSignature = null;
    await this.sync();
  }

  /** Prompt for a folder, scan it, store the result + remember the location. No-op on cancel. */
  async pickFolder(): Promise<void> {
    this.folderScanning = true;
    this.error = null;
    try {
      const r = await pickAndScanRomFolder("gnw-roms", nativeArchiveRulesFor(coreRegistry.current));
      if (r) {
        // Register the pick in `localFolders` (the multi-folder list is the source of truth
        // now) and then re-merge EVERY ROM folder, so a second pick adds to the library
        // instead of replacing it. `migrateLegacyRomDir` is the idempotent add: it no-ops
        // when this exact directory is already registered.
        await localFolders.load();
        await migrateLegacyRomDir(r.dir, localFolders, defaultLibraryScanDeps);
        this.pendingHandle = null;
        // Only persist native FSAA handles — InputDirHandle shims aren't structured-cloneable
        // "romDir" is an IndexedDB STORAGE KEY, not a name: it identifies data already
        // persisted in real users' browsers. It was deliberately left alone when the store
        // was renamed roms -> library, because renaming it would silently orphan every
        // existing user's remembered folder.
        if (dirSupportsWriteBack(r.dir)) void saveDir("romDir", r.dir);
        this.folderScanning = false;
        // Never adopt `r` directly — the pick is now registered, so the library rebuilds from
        // the registry like every other change to it.
        this.syncedSignature = null;
        await this.sync();
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      // `library.error` is write-only: NO component reads it, so this was the quietest failure
      // in the app. `pickAndScanRomFolder` returns null on a cancel rather than throwing, so
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
   *  If the legacy single folder needs a re-grant, stash it in `pendingHandle` so the UI can
   *  offer a reconnect button. */
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
  async scanAllFolders(validateCachedNames = false): Promise<void> {
    this.folderScanning = true;
    dbg(`[library memory] scan start jsHeapMiB=${jsHeapMiB()}`);
    this.error = null;
    this.progress = { stage: "Preparing library scan", done: 0, total: 0, current: "", folder: "" };
    let lipClaimed = false;
    try {
      await localFolders.load();

      // Migration: a user who only ever had the single "romDir" folder keeps it, as an "Any"
      // directory. Idempotent (isSameEntry against what is already registered). Once adopted,
      // remove the legacy key so a later delete cannot resurrect the folder.
      // "romDir": storage key, not a name — see the note at the saveDir() call above.
      const legacy = (await loadDir("romDir")) as RomDirHandle | null;
      if (legacy) {
        await migrateLegacyRomDir(legacy, localFolders, defaultLibraryScanDeps);
        await deleteDir("romDir");
      }

      // The registry, and only the registry. See `romFolderSources` — the core registry is
      // passed so a folder dedicated to a single-system core files its loose ROMs under that
      // console instead of dropping them for having no console directory.
      const sources = romFolderSources(localFolders.folders, coreRegistry.current);
      const activeSourceIds = new Set(sources.map((source) => source.id));
      for (const [sourceId, cached] of this.sourceFileCache) {
        if (activeSourceIds.has(sourceId)) continue;
        for (const entry of cached.values()) if (isLazy(entry)) entry.release?.();
        this.sourceFileCache.delete(sourceId);
        this.sourceMetadataCache.delete(sourceId);
      }
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
      this.progress = { stage: "Preparing library scan", done: 0, total: 0, current: "", folder: "" };

      // Nothing readable, but we do hold the legacy handle: offer the re-grant affordance
      // rather than showing an empty library.
      if (!sources.some((s) => s.status === "ready")) {
        if (legacy && !(await handlePermission(legacy, "readwrite", false))) {
          this.pendingHandle = legacy;
        }
        if (sources.length === 0) return;
      }

      // Do not enumerate every source twice just to manufacture a progress denominator. A
      // persisted metadata index gives later scans a useful estimate; a first scan reports an
      // indeterminate total while doing the only directory walk that actually matters.
      let totalFiles = 0;
      const sourceTotals = new Map<string, number>();
      let hasUnknownTotal = false;
      for (const src of sources) {
        if (src.status !== "ready") continue;
        const count = this.sourceMetadataCache.get(src.id)?.size ?? 0;
        if (count === 0) hasUnknownTotal = true;
        sourceTotals.set(src.id, count);
        totalFiles += count;
      }
      if (hasUnknownTotal) totalFiles = 0;
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
      this.progress = { stage: "Reading library files", done: 0, total: totalFiles, current: "", folder: "", layers, finalizing: null };
      lipProgress.operationProgress("library-scan", 0);
      lipClaimed = true;
      const scanMergeStarted = performance.now();
      const merged = await scanLibraryFolders(sources, {
        ...defaultLibraryScanDeps,
        scan: async (src) => {
          const layer = layers.find((l) => l.id === src.id);
          if (layer) {
            layer.status = "active";
            layer.phase = "Loading games";
            this.progress = { ...this.progress!, layers: [...layers] };
          }
          const zipCache = this.sourceZipCache.get(src.id) ?? new Map<string, ZipScanCacheEntry>();
          this.sourceZipCache.set(src.id, zipCache);
          const r = await scanLibraryDirectory(src.handle as RomDirHandle, async (rel, count) => {
            await this.waitForScanResume();
            doneFiles += count;
            if (layer) layer.done += count;
            // Throttled: scan progress is background UI, so it gets at most five repaints a
            // second. The COUNT remains exact; only the visible update is throttled.
            const now = Date.now();
            if (now - lastTick < 200) return;
            lastTick = now;
            this.progress = { stage: "Reading library files", done: doneFiles, total: totalFiles, current: rel, folder: src.id, layers: [...layers], finalizing: null };
            if (totalFiles > 0) lipProgress.operationProgress("library-scan", doneFiles / totalFiles);
          }, zipCache, () => this.waitForUiIdle(), nativeArchiveRulesFor(coreRegistry.current, src.placement),
          validateCachedNames ? this.cachedDirectorySnapshot(src.id) : undefined, this.sourceFileCache.get(src.id));
          const previousMetadata = this.sourceMetadataCache.get(src.id);
          const nextMetadata = new Map<string, LibraryFileMeta>();
          const metadataStarted = performance.now();
          for (const [path, entry] of r.userRoms) {
            const meta = libraryFileMetaFromScan(path, entry);
            const previous = previousMetadata?.get(path);
            nextMetadata.set(path, previous && sameLibraryFileMeta(src.id, previous, meta) && previous.sha1
              ? { ...meta, sha1: previous.sha1 }
              : meta);
          }
          this.sourceMetadataCache.set(src.id, nextMetadata);
          dbg(`[library perf] metadata reconciled source=${src.id} files=${r.userRoms.size} elapsed=${Math.round(performance.now() - metadataStarted)}ms`);
          if (layer) {
            layer.status = "done";
            layer.phase = "Ready";
            layer.done = layer.total;
          }
          this.progress = { stage: "Reconciling folders", done: doneFiles, total: totalFiles, current: "", folder: src.id, layers: [...layers], finalizing: null };
          // `hasRomsPrefix` is kept PER FOLDER: one folder's `roms/` layout must never
          // reinterpret another's (scanRomDirectory has already stripped the prefix locally).
          return {
            files: this.reuseUnchangedSourceFiles(src.id, r.userRoms),
            hasRomsPrefix: !!r.hasRomsPrefix,
          };
        },
      });
      dbg(`[library perf] source scans and folder merge complete sources=${merged.scanned.length} files=${merged.files.size} elapsed=${Math.round(performance.now() - scanMergeStarted)}ms`);
      dbg(`[library memory] scan merged files=${merged.files.size} jsHeapMiB=${jsHeapMiB()}`);

      if (this.progress) this.progress = { ...this.progress, stage: "Reconciling duplicates" };
      this.scanCollisions = merged.collisions;
      this.scanDuplicates = merged.duplicates;
      this.scanSkipped = merged.skipped;
      if (merged.scanned.length === 0) return;

      const userRoms = merged.files;
      // Hydration stores final, placed keys. Per-source scans may use loose keys instead,
      // so their early reuse pass cannot recognize every unchanged dedicated-folder file.
      // Reconcile once more using the merged key and source before invalidating UI models.
      if (this.scan) {
        for (const [key, file] of userRoms) {
          const old = this.scan.userRoms.get(key);
          if (old === file || !isLazy(old) || !isLazy(file)
            || this.fileOrigin.get(key) !== merged.origin.get(key)) continue;
          const oldLazy = old as LazyRom;
          const nextLazy = file as LazyRom;
          if (oldLazy.archive !== nextLazy.archive
            || JSON.stringify(oldLazy.zipEntry) !== JSON.stringify(nextLazy.zipEntry)
            || !sameLibraryFileMeta(merged.origin.get(key), libraryFileMetaFromScan(key, old), libraryFileMetaFromScan(key, file))) continue;
          file.release?.();
          userRoms.set(key, old);
        }
      }
      if (this.progress) this.progress = { ...this.progress, stage: "Organizing library", finalizing: "Organizing library" };
      const organizeStarted = performance.now();
      const primaryId = merged.scanned[0].id;
      const primaryDir = localFolders.get(primaryId)?.handle as RomDirHandle;
      const hasRomsPrefix = merged.scanned[0].hasRomsPrefix;
      if (new URLSearchParams(location.search).has("libraryTrace") && this.scan) {
        let changed = 0;
        const samples: string[] = [];
        for (const [key, file] of userRoms) {
          if (this.scan.userRoms.get(key) === file && this.fileOrigin.get(key) === merged.origin.get(key)) continue;
          changed++;
          const old = this.scan.userRoms.get(key);
          if (samples.length < 5) samples.push(JSON.stringify({ key, old: old ? libraryFileMetaFromScan(key, old) : null, next: libraryFileMetaFromScan(key, file) }));
        }
        console.info("[library trace] snapshot comparison", JSON.stringify({ oldCount: this.scan.userRoms.size, nextCount: userRoms.size, sameDir: this.scan.dir === primaryDir, oldPrefix: this.scan.hasRomsPrefix, nextPrefix: hasRomsPrefix, changed, samples }));
      }
      let sameSnapshot = this.scan !== null
        && this.scan.userRoms.size === userRoms.size
        && this.scan.dir === primaryDir
        && this.scan.hasRomsPrefix === hasRomsPrefix
        && this.fileOrigin.size === merged.origin.size;
      if (sameSnapshot) {
        for (const [key, file] of userRoms) {
          if (this.scan!.userRoms.get(key) !== file || this.fileOrigin.get(key) !== merged.origin.get(key)) {
            sameSnapshot = false;
            break;
          }
        }
      }
      if (!sameSnapshot) {
        this.scan = {
          userRoms,
          summary: summarize(userRoms),
          dir: primaryDir,
          hasRomsPrefix,
        };
        this.fileOrigin = merged.origin;
        this.filePathIndex = null;
        this.filePathIndexFiles = null;
        this.filePathIndexSize = -1;
      }
      dbg(`[library perf] snapshot organization files=${userRoms.size} sameSnapshot=${sameSnapshot} elapsed=${Math.round(performance.now() - organizeStarted)}ms`);
      const persistStarted = performance.now();
      this.persistCachedIndex(
        userRoms,
        merged.origin,
        primaryId,
        merged.scanned[0].hasRomsPrefix,
        sources.filter((source) => source.status === "ready" && !!source.handle).map((source) => source.id),
      );
      saveZipScanCache(this.sourceZipCache);
      scheduleLibraryMetadataSave(this.sourceMetadataCache);
      dbg(`[library perf] scan caches scheduled elapsed=${Math.round(performance.now() - persistStarted)}ms`);
      if (!validateCachedNames) this.archiveRefreshRevision++;
      this.pendingHandle = null;
      this.clearDirty();

      // Cover conversion is deferred until an SD sync needs a device-format sidecar.
      // Converting every full-size cover during startup retained gigabytes of image data.
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
   * Re-grant the remembered folder (call from a user gesture) and rebuild.
   *
   * This used to call `adoptHandle()`, which scanned that ONE directory and assigned the result
   * straight to `this.scan` — a second, registry-bypassing way for games to enter the Library,
   * and one that silently dropped every other registered ROM folder. Now the re-grant is
   * recorded on the registry row that owns the handle (so the Sources tab shows it as `ready`
   * too) and the library is rebuilt from the registry like any other change.
   */
  async reconnect(): Promise<void> {
    const handle = this.pendingHandle;
    if (!handle) return;
    if (!(await handlePermission(handle, "readwrite", true))) return;
    this.pendingHandle = null;
    for (const f of localFolders.folders) {
      if (!f.handle) continue;
      if (await defaultLibraryScanDeps.isSameEntry(f.handle, handle)) {
        await localFolders.grant(f.id);
        break;
      }
    }
    this.syncedSignature = null;
    await this.sync();
  }

  clear(): void {
    this.scan = null;
    this.filePathIndex = null;
    this.filePathIndexFiles = null;
    this.filePathIndexSize = -1;
    this.syncedSignature = null;
    this.savesScan = null;
    this.scanCollisions = [];
    this.scanDuplicates = [];
    this.scanSkipped = [];
    this.fileOrigin = new Map();
    this.clearDirty();
    this.error = null;
    this.pendingHandle = null;
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
    this.markDirtyMany([path]);
  }

  markDirtyMany(paths: Iterable<string>) {
    const next = new Set(this.dirtyFiles);
    for (const path of paths) next.add(path);
    if (next.size !== this.dirtyFiles.size) this.dirtyFiles = next;
  }

  clearDirty(paths?: Iterable<string>) {
    if (!paths) {
      this.dirtyFiles = new Set();
      return;
    }
    const next = new Set(this.dirtyFiles);
    for (const path of paths) next.delete(path);
    if (next.size !== this.dirtyFiles.size) this.dirtyFiles = next;
  }
}

export const library = new LibraryStore();

/** Read-only DevTools diagnostic for folder-gate/source-registration issues. */
if (typeof window !== "undefined") {
  (window as Window & { gnwLibraryState?: () => unknown }).gnwLibraryState = () => ({
    folders: localFolders.folders.map(({ id, name, folderName, usedBy, status, handle }) => ({
      id, name, folderName, usedBy: [...usedBy], status, hasHandle: !!handle,
    })),
    localFoldersReady: localFolders.ready,
    prompt: library.folderGatePrompt ? { sd: library.folderGatePrompt.sd } : null,
    selected: library.selected,
    loaded: library.loaded,
    error: library.error,
    scanSkipped: library.scanSkipped,
    sources: romFolderSources(localFolders.folders, coreRegistry.current).map(({ id, status, handle }) => ({
      id, status, hasHandle: !!handle,
    })),
    listState: library.listState,
  });
}
