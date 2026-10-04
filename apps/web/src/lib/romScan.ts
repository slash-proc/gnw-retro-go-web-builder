import { isNativeRomArchive, type NativeArchiveRules } from "./nativeRomArchives.js";
import { electronDirHandle, electronFs } from "./electronFs.js";
/**
 * ROM folder scan — turns a user-picked directory into the `userRoms` map that
 * feeds the flash-install pipeline (engine/flashInstall.ts → @gnw/fs-builders).
 *
 * The map is keyed by the path RELATIVE to the picked folder ("nes/mario.nes",
 * "bios/pce/syscard3.pce"): the top segment is the system (retro-go `/roms/<system>`),
 * and a top-level `bios/` folder merges into `/bios`. That's exactly what
 * planFlashImage expects (it routes `bios/*` → /bios, everything else → /roms/*).
 *
 * Supports two folder-picking strategies:
 *   1. File System Access API (`showDirectoryPicker`) — Chromium; read + write-back
 *   2. `<input webkitdirectory>` fallback — Firefox/Safari; read-only
 */

export interface SystemSummary {
  system: string; // top-level folder name ("nes", "md", "bios", …)
  files: number;
  bytes: number;
}

export interface RomScanSummary {
  /** Per top-level folder (systems + a "bios" entry if the user supplied BIOS). */
  systems: SystemSummary[];
  totalFiles: number;
  totalBytes: number;
}

export interface RomScanResult {
  /** "<system>/<file>" → bytes; "bios/*" entries merge into /bios downstream. */
  userRoms: Map<string, LibraryFile>;
  summary: RomScanSummary;
  /** The picked directory handle — kept so the location can be remembered + re-scanned later.
   *  May be a read-only shim (InputDirHandle) in Firefox. */
  dir: RomDirHandle;
  /** Whether the user picked the SD root containing a 'roms/' folder */
  hasRomsPrefix?: boolean;
}

// Minimal File System Access API surface (not all in lib.dom yet).
/** A picked ROM directory handle (re-usable to remember + re-scan the location). */
export type RomDirHandle = FsDirHandle;
interface FsDirHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, FsDirHandle | FsFileHandle]>;
  getDirectoryHandle?(name: string): Promise<FsDirHandle>;
  getFileHandle?(name: string): Promise<FsFileHandle>;
  /** True for native FSAA handles that support write-back (getDirectoryHandle, getFileHandle, createWritable). */
  readonly writable?: boolean;
}
interface FsFileHandle {
  kind: "file";
  name: string;
  getFileMetadata?(): Promise<{ size: number; lastModified: number }>;
  getFile(): Promise<File>;
}

export interface RomFileSnapshot {
  /** Handle-free metadata keeps thousands of Blink FileSystemFileHandle wrappers out of the UI heap. */
  path: string;
  size: number;
  lastModified: number;
}

const directoryHandleCache = new WeakMap<FsDirHandle, Map<string, FsDirHandle>>();

async function childDirectory(parent: FsDirHandle, name: string): Promise<FsDirHandle> {
  if (parent.getDirectoryHandle) return parent.getDirectoryHandle(name);
  for await (const [entryName, handle] of parent.entries()) {
    if (entryName === name && handle.kind === "directory") return handle;
  }
  throw new Error(`cached library directory disappeared: ${name}`);
}

async function childFile(parent: FsDirHandle, name: string): Promise<FsFileHandle> {
  if (parent.getFileHandle) return parent.getFileHandle(name);
  for await (const [entryName, handle] of parent.entries()) {
    if (entryName === name && handle.kind === "file") return handle;
  }
  throw new Error(`cached library file disappeared: ${name}`);
}

async function directoryAt(root: FsDirHandle, relativePath: string): Promise<FsDirHandle> {
  let cache = directoryHandleCache.get(root);
  if (!cache) {
    cache = new Map([["", root]]);
    directoryHandleCache.set(root, cache);
  }
  let currentPath = "";
  let current = root;
  for (const part of relativePath.split("/").filter(Boolean)) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const cached = cache.get(currentPath);
    if (cached) {
      current = cached;
      continue;
    }
    current = await childDirectory(current, part);
    cache.set(currentPath, current);
  }
  return current;
}

/** Read one source-relative file on demand, used by hydrated metadata-only library entries. */
export async function readRomFile(dir: RomDirHandle, relativePath: string): Promise<File> {
  const parts = relativePath.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error("cached library path is empty");
  const parent = await directoryAt(dir, parts.join("/"));
  return (await childFile(parent, fileName)).getFile();
}
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FsDirHandle>;
  }
}

import { homebrew, isHomebrewSourceFile } from "./sources/homebrewTitles.svelte.js";
import { sha1File } from "./fileHash.js";
export { sha1File } from "./fileHash.js";
import { zipExtractOne, type ZipEntry } from "./unzip.js";
import { readZipDirectory, resolveZipRom, type ZipRomVerdict } from "./zipScan.js";
export { resolveZipRom } from "./zipScan.js";
export type { ZipRomVerdict } from "./zipScan.js";
import { isLazy, noteLazyRead, noteLazyRelease, resolveBytes, type LazyBytes, type MaybeLazy } from "./lazyBytes.js";
import { coreRegistry } from "./sources/coreRegistry.svelte.js";
import { isKnownConsoleDir, type CoreRegistry } from "./sources/coreRegistry.js";
import { homebrewDirs } from "./engine/devicePaths.js";
import { download } from "./util.js";
import { dbg } from "./debug.js";
import {
  parseCoreHeader,
  evaluateCoreVersions,
  CORE_HEADER_PROBE_BYTES,
  type CoreVersionCheck,
} from "./engine/coreVersion.js";

const isHidden = (name: string): boolean => name.startsWith(".");

/**
 * A library file whose BYTES have not been read yet.
 *
 * The scan reads a zip's central directory and stops: it learns the inner name and the
 * UNCOMPRESSED size, which is everything the library list, the size columns, the budget and the
 * cheap dedup tiers need, and it reads none of the ROM. The bytes are inflated only when
 * something actually asks for them, which in practice means an install.
 *
 * WHY A `length` GETTER. The scan map's value type was `Uint8Array` and 32 call sites across 8
 * files read it. Almost all of them only want the size. Exposing `length` and `byteLength` means
 * every one of those keeps working untouched, and only the handful that genuinely need bytes has
 * to say so (`romBytes`). That is the whole reason this is a class rather than a plain record.
 */
export class LazyRom implements LazyBytes {
  /** UNCOMPRESSED length. Never the archive's size, which is meaningless for a flash budget. */
  readonly length: number;
  private cached: Uint8Array | null = null;
  private inflight: Promise<Uint8Array> | null = null;

  constructor(
    length: number,
    private readonly load: () => Promise<Uint8Array>,
    /** For diagnostics: the archive this came out of. */
    readonly archive: string,
    /** File metadata used by incremental scans; never requires reading the payload. */
    readonly lastModified?: number,
    /** Present for a ZIP-backed ROM so a persisted metadata index can re-open it lazily. */
    readonly zipEntry?: ZipEntry,
    /** Stream-hash direct files without building a full-size Uint8Array. */
    readonly hashSha1?: () => Promise<string>,
  ) {
    this.length = length;
  }

  /** Alias, because `UintFuncs` callers reach for either name. */
  get byteLength(): number {
    return this.length;
  }

  /** Inflate once. Concurrent callers share the one read rather than racing the file. */
  async bytes(): Promise<Uint8Array> {
    if (this.cached) return this.cached;
    if (!this.inflight) {
      const caller = new Error().stack?.split("\n").slice(2).find((line) =>
        !line.includes("romScan") && !line.includes("lazyBytes")
      )?.trim() || "unknown";
      this.inflight = this.load().then((b) => {
        noteLazyRead(b.byteLength, caller);
        this.cached = b;
        this.inflight = null;
        return b;
      });
    }
    return this.inflight;
  }

  release(): void {
    if (this.cached) noteLazyRelease(this.cached.byteLength);
    this.cached = null;
  }
}

/** Anything the library map can hold: bytes already read, or a zip entry not yet inflated. */
export type LibraryFile = MaybeLazy;

/** ZIP central-directory metadata retained between scans; never archive payload bytes. */
export interface ZipScanCacheEntry {
  size: number;
  lastModified?: number;
  verdict: ZipRomVerdict;
}

/** The bytes of a library file, inflating it if that has not happened yet. */
export const romBytes = resolveBytes;

/**
 * Inflate a whole map at once, for the moment an install actually needs bytes.
 *
 * This is the seam the lazy design turns on: everything upstream of it -- the library list, the
 * size columns, the budget, the name plan, the cheap dedup tiers -- runs on metadata and stays
 * synchronous. Only what the user selected is ever read, and only here.
 */
export async function materialize(files: Map<string, LibraryFile>): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const [k, v] of files) out.set(k, await romBytes(v));
  return out;
}

/** Synchronously available bytes, or null for an entry that has not been inflated. */
export function romBytesIfLoaded(v: LibraryFile): Uint8Array | null {
  return isLazy(v) ? null : v;
}

/**
 * Reports the relative path of each file as it is read, so a long first scan can say what it is
 * currently processing. Runtime-derived text (a path), never UI copy.
 */
export type ScanProgressFn = (relativePath: string) => void | Promise<void>;

/** Aggregated so a large collection of multi-ROM archives does not flood the main-thread log. */
interface ZipSkipSummary {
  count: number;
  samples: string[];
}

/**
 * The homebrew directories to assume when a caller does not say.
 *
 * This is the PRE-MANIFEST layout -- `DEFAULT_INSTALL_PATHS.homebrew` (`roms/homebrew`) and its
 * roms-relative form, which is what a locally picked ROM folder has. It is spelled here rather
 * than imported because `engine/devicePaths.ts` resolves paths through `@gnw/fs-builders`, and
 * that barrel re-exports the littlefs WASM vendor, which imports node's `module`. Reaching for
 * it from this browser-only module breaks every suite that bundles the scan under
 * `platform: "neutral"` -- `sources/discoveryWire.svelte.ts:145-147` records the same hazard
 * about this same module ("its build broke the moment this module reached for it"), and a
 * dynamic import is no escape: esbuild bundles those too (`sources/biosState.svelte.ts:245`).
 *
 * A caller that HAS the manifest passes the resolved set instead -- see `device.svelte.ts`'s
 * `scanSdCardGames`, where the live `/homebrews` only ever appears.
 */
export const LEGACY_HOMEBREW_PREFIXES: readonly string[] = ["homebrew", "roms/homebrew"];

async function walk(
  dir: FsDirHandle,
  root: FsDirHandle,
  prefix: string,
  out: Map<string, LibraryFile>,
  onFile: ScanProgressFn | null,
  hbPrefixes: readonly string[],
  zipCache?: Map<string, ZipScanCacheEntry>,
  zipSkips?: ZipSkipSummary,
  archiveRules?: NativeArchiveRules,
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (isHidden(name)) continue; // .DS_Store, .git, … (the pipeline also drops .DS_Store)
    const rel = prefix ? `${prefix}/${name}` : name;
    // Which directories are homebrew is the CALLER's to say: on a real card it is the
    // manifest's `/homebrews`, and testing two literals here meant the whitelist below never
    // applied there, so every file in it was read whole into memory.
    const isInsideHomebrew = hbPrefixes.includes(prefix);

    if (handle.kind === "directory") {
      // Do not recurse into subdirectories inside homebrew
      await walk(handle, root, rel, out, onFile, hbPrefixes, zipCache, zipSkips, archiveRules);
    } else {
      if (isInsideHomebrew || hbPrefixes.some((p) => rel.startsWith(`${p}/`))) {
        // Cover art (celeste.png, "Zelda 3.png", …) also lives directly in homebrew/ (see
        // GameDetailsPanel.svelte's applyPreview()/getCoverUrl() in RomManagementTab.svelte)
        // — it's neither a device file nor a source ROM, so the exact-name whitelist below
        // was silently dropping it from every scan, regardless of whether it was placed
        // manually or written here by our own UI. Without this, a homebrew cover could never
        // survive a rescan/reload no matter how it got there.
        // Device files and converter sources both come from the ACTIVE sources' manifests
        // (sources/homebrewTitles.svelte.ts), not from a hardcoded list. A source file is
        // matched by EXTENSION, not by name: a manifest identifies a user file by hash and
        // extension, never by whatever the user happened to call it. With no homebrew source
        // added, both sets are empty and only cover art survives the walk — which is correct,
        // since nothing can be built from those files anyway.
        const isCoverImage = /\.(png|jpe?g|img)$/i.test(name);
        const hbRoot = hbPrefixes.find((p) => rel === p || rel.startsWith(`${p}/`));
        const hbKey = hbRoot ? rel.slice(hbRoot.length + 1) : name;
        const isWhitelisted =
          isCoverImage || homebrew.deviceFiles.has(hbKey) || isHomebrewSourceFile(name) || !!homebrew.owning(hbKey);
        if (!isWhitelisted) continue;
      }
      if (/\.zip$/i.test(name) && !isNativeRomArchive(rel, archiveRules)) {
        let verdict: ZipRomVerdict;
        const file = await handle.getFile();
        const cached = zipCache?.get(rel);
        try {
          verdict = cached && cached.size === file.size && cached.lastModified === file.lastModified
            ? cached.verdict
            : resolveZipRom(await readZipDirectory(file));
          zipCache?.set(rel, { size: file.size, lastModified: file.lastModified, verdict });
        } catch (e) {
          verdict = { ok: false, reason: e instanceof Error ? e.message : String(e) };
          zipCache?.set(rel, { size: file.size, lastModified: file.lastModified, verdict });
        }
        if (!verdict.ok) {
          if (zipSkips) {
            zipSkips.count++;
            if (zipSkips.samples.length < 5) zipSkips.samples.push(`${rel}: ${verdict.reason}`);
          }
          continue;
        }
        const innerRel = prefix ? `${prefix}/${verdict.name}` : verdict.name;
        // Two archives can hold the same ROM under different archive names, and a Map would
        // take the last one silently. First wins (directory order is stable) and the loser is
        // named, which is the same posture as the cross-folder duplicate rule in
        // `sources/libraryScan.ts`: never renamed around, never quietly dropped.
        if (out.has(innerRel)) {
          if (zipSkips) {
            zipSkips.count++;
            if (zipSkips.samples.length < 5) zipSkips.samples.push(`${rel}: ${innerRel} already came from another archive`);
          }
          continue;
        }
        // The size is the central directory's; the bytes are read if and when someone installs
        // this ROM. Nothing of the payload has been touched at this point.
        const entry = verdict.entry;
        out.set(
          innerRel,
          new LazyRom(
            entry.size,
            async () => zipExtractOne(new Uint8Array(await (await readRomFile(root, rel)).arrayBuffer()), entry),
            rel,
            file.lastModified,
            entry,
          ),
        );
        await onFile?.(innerRel);
        continue;
      }

      // Keep regular files lazy as well. Scanning only needs their name and size; reading every
      // ROM into JS memory here made a large library consume gigabytes before the user selected
      // anything to install. The same LazyRom path already protects ZIP payloads.
      // Test/node shims that already hold bytes in memory may opt in via eager: true.
      // Native File System Access handles and browser InputFileHandle shims remain lazy so
      // scanning only inspects metadata without reading files into the JS heap.
      if ((handle as FsFileHandle & { eager?: boolean }).eager === true) {
        const file = await handle.getFile();
        out.set(rel, new Uint8Array(await file.arrayBuffer()));
        await onFile?.(rel);
        continue;
      }
      const fileHandle = handle as FsFileHandle;
      const metadata = fileHandle.getFileMetadata
        ? await fileHandle.getFileMetadata()
        : await fileHandle.getFile();
      out.set(
        rel,
        new LazyRom(
          metadata.size,
          async () => new Uint8Array(await (await readRomFile(root, rel)).arrayBuffer()),
          rel,
          metadata.lastModified,
          undefined,
          async () => sha1File(await readRomFile(root, rel)),
        ),
      );
      await onFile?.(rel);
    }
  }
}

/** Build the per-system summary from a userRoms map (top segment = system). */
export function summarize(userRoms: Map<string, LibraryFile>): RomScanSummary {
  const bySystem = new Map<string, SystemSummary>();
  let totalBytes = 0;
  for (const [path, data] of userRoms) {
    const system = path.split("/")[0] || "(root)";
    const s = bySystem.get(system) ?? { system, files: 0, bytes: 0 };
    s.files += 1;
    s.bytes += data.length;
    bySystem.set(system, s);
    totalBytes += data.length;
  }
  return {
    systems: [...bySystem.values()].sort((a, b) => a.system.localeCompare(b.system)),
    totalFiles: userRoms.size,
    totalBytes,
  };
}

/** Recursively read a picked directory into a userRoms map + summary. */
/**
 * Count the files a scan WILL read, without reading any of them.
 *
 * The library's progress bar had folders as its denominator, so with one ROM folder it sat at
 * 0% while filenames streamed past and then jumped to 100%. Files are the honest unit, and the
 * count has to come from somewhere before the walk starts.
 *
 * Enumerating directory entries is cheap next to reading them: this opens nothing and calls
 * `getFile()` on nothing. It applies the SAME homebrew whitelist as `walk`, so the count it
 * returns is the number of files the scan will actually read, not the number on disk -- a
 * denominator the progress can reach exactly.
 */
export async function countRomDirectory(
  dir: FsDirHandle,
  hbPrefixes: readonly string[] = LEGACY_HOMEBREW_PREFIXES,
  onFile?: (relativePath: string) => void | Promise<void>,
): Promise<number> {
  let n = 0;
  const walkCount = async (d: FsDirHandle, prefix: string): Promise<void> => {
    for await (const [name, handle] of d.entries()) {
      if (isHidden(name)) continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      const isInsideHomebrew = hbPrefixes.includes(prefix);
      if (handle.kind === "directory") {
        await walkCount(handle as FsDirHandle, rel);
      } else {
        if (isInsideHomebrew || hbPrefixes.some((p) => rel.startsWith(`${p}/`))) {
          const isCoverImage = /\.(png|jpe?g|img)$/i.test(name);
          const hbRoot = hbPrefixes.find((p) => rel === p || rel.startsWith(`${p}/`));
          const hbKey = hbRoot ? rel.slice(hbRoot.length + 1) : name;
          if (!(isCoverImage || homebrew.deviceFiles.has(hbKey) || isHomebrewSourceFile(name) || !!homebrew.owning(hbKey))) continue;
        }
        n++;
        await onFile?.(rel);
      }
    }
  };
  await walkCount(dir, "");
  return n;
}

export async function scanRomDirectory(
  dir: FsDirHandle,
  onFile: ScanProgressFn | null = null,
  hbPrefixes: readonly string[] = LEGACY_HOMEBREW_PREFIXES,
  zipCache: Map<string, ZipScanCacheEntry> | undefined = undefined,
  archiveRules?: NativeArchiveRules,
): Promise<RomScanResult> {
  const raw = new Map<string, LibraryFile>();
  const zipSkips: ZipSkipSummary = { count: 0, samples: [] };
  await walk(dir, dir, "", raw, onFile, hbPrefixes, zipCache, zipSkips, archiveRules);
  if (zipSkips.count > 0) {
    dbg(`[scan] ${zipSkips.count} archives skipped; samples: ${zipSkips.samples.join(" | ")}`);
  }
  
  const userRoms = new Map<string, LibraryFile>();
  let hasRomsPrefix = false;
  for (const [key, val] of raw) {
    if (key.startsWith("roms/")) {
      hasRomsPrefix = true;
      userRoms.set(key.slice(5), val);
    } else {
      userRoms.set(key, val);
    }
  }

  const summary = summarize(userRoms);
  return { userRoms, summary, dir, hasRomsPrefix };
}

/** Assemble a scan result from worker-collected file metadata without walking the tree again. */
export async function scanRomFileSnapshot(
  dir: RomDirHandle,
  entries: readonly RomFileSnapshot[],
  onFile: ScanProgressFn | null = null,
  zipCache?: Map<string, ZipScanCacheEntry>,
  waitForUi: () => Promise<void> = () => Promise.resolve(),
  archiveRules?: NativeArchiveRules,
  previousFiles?: ReadonlyMap<string, LibraryFile>,
): Promise<RomScanResult> {
  const raw = new Map<string, LibraryFile>();
  const previousByArchive = new Map<string, LazyRom>();
  for (const file of previousFiles?.values() ?? []) {
    if (isLazy(file)) {
      const lazy = file as LazyRom;
      previousByArchive.set(`${lazy.archive}\0${lazy.zipEntry?.name ?? ""}`, lazy);
    }
  }
  const zipSkips: ZipSkipSummary = { count: 0, samples: [] };
  const yieldToPaint = () => new Promise<void>((resolve) => {
    let settled = false;
    let fallback: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      resolve();
    };
    // Never let a throttled background-tab animation frame stall the metadata scan.
    fallback = setTimeout(finish, 100);
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(finish);
  });
  let zipCacheHits = 0;
  let zipInspections = 0;
  let zipInspectionMs = 0;
  for (let index = 0; index < entries.length; index++) {
    if (index % 128 === 0) {
      await waitForUi();
      await yieldToPaint();
    }
    const { path: rel, size, lastModified } = entries[index];
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    const prefix = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    const isInsideHomebrew = LEGACY_HOMEBREW_PREFIXES.includes(prefix);
    if (isInsideHomebrew || LEGACY_HOMEBREW_PREFIXES.some((p) => rel.startsWith(`${p}/`))) {
      const isCoverImage = /\.(png|jpe?g|img)$/i.test(name);
      const hbRoot = LEGACY_HOMEBREW_PREFIXES.find((p) => rel === p || rel.startsWith(`${p}/`));
      const hbKey = hbRoot ? rel.slice(hbRoot.length + 1) : name;
      if (!(isCoverImage || homebrew.deviceFiles.has(hbKey) || isHomebrewSourceFile(name) || !!homebrew.owning(hbKey))) continue;
    }
    if (/\.zip$/i.test(name) && !isNativeRomArchive(rel, archiveRules)) {
      const cached = zipCache?.get(rel);
      let verdict: ZipRomVerdict;
      if (cached && cached.size === size && cached.lastModified === lastModified) {
        zipCacheHits++;
        verdict = cached.verdict;
      }
      else {
        const zipStarted = performance.now();
        try {
          verdict = resolveZipRom(await readZipDirectory(await readRomFile(dir, rel)));
        } catch (error) {
          verdict = { ok: false, reason: error instanceof Error ? error.message : String(error) };
        } finally {
          zipInspections++;
          zipInspectionMs += performance.now() - zipStarted;
        }
        zipCache?.set(rel, { size, lastModified, verdict });
      }
      if (!verdict.ok) {
        zipSkips.count++;
        if (zipSkips.samples.length < 5) zipSkips.samples.push(`${rel}: ${verdict.reason}`);
        continue;
      }
      const innerRel = prefix ? `${prefix}/${verdict.name}` : verdict.name;
      if (raw.has(innerRel)) {
        zipSkips.count++;
        if (zipSkips.samples.length < 5) zipSkips.samples.push(`${rel}: ${innerRel} already came from another archive`);
        continue;
      }
      const entry = verdict.entry;
      const previous = previousByArchive.get(`${rel}\0${entry.name}`);
      raw.set(innerRel, previous && previous.length === entry.size && previous.lastModified === lastModified
        && JSON.stringify(previous.zipEntry) === JSON.stringify(entry) ? previous : new LazyRom(
        entry.size,
        async () => zipExtractOne(new Uint8Array(await (await readRomFile(dir, rel)).arrayBuffer()), entry),
        rel,
        lastModified,
        entry,
      ));
      await onFile?.(innerRel);
      continue;
    }
    const previous = previousByArchive.get(`${rel}\0`);
    raw.set(rel, previous && !previous.zipEntry && previous.length === size && previous.lastModified === lastModified ? previous : new LazyRom(
      size,
      async () => new Uint8Array(await (await readRomFile(dir, rel)).arrayBuffer()),
      rel,
      lastModified,
      undefined,
      async () => sha1File(await readRomFile(dir, rel)),
    ));
    await onFile?.(rel);
  }

  dbg(`[library perf] zip inspection cacheHits=${zipCacheHits} inspected=${zipInspections} elapsed=${Math.round(zipInspectionMs)}ms`);
  if (zipSkips.count > 0) dbg(`[scan] ${zipSkips.count} archives skipped; samples: ${zipSkips.samples.join(" | ")}`);
  const userRoms = new Map<string, LibraryFile>();
  let hasRomsPrefix = false;
  for (const [key, value] of raw) {
    if (key.startsWith("roms/")) {
      hasRomsPrefix = true;
      userRoms.set(key.slice(5), value);
    } else userRoms.set(key, value);
  }
  return { userRoms, summary: summarize(userRoms), dir, hasRomsPrefix };
}

/** True when the native File System Access API is available (Chromium). */
export const nativeFolderPickerSupported = (): boolean =>
  typeof window !== "undefined" && (typeof window.showDirectoryPicker === "function" || !!electronFs());

/** Folder picking is always supported — native FSAA in Chromium, <input webkitdirectory> fallback elsewhere. */
export const folderPickerSupported = (): boolean => true;

/** True when the dir handle supports write-back (getDirectoryHandle / getFileHandle / createWritable). */
export function dirSupportsWriteBack(dir: RomDirHandle | null | undefined): boolean {
  if (!dir) return false;
  // Native FSAA handles have getDirectoryHandle; our InputDirHandle shim does not.
  return typeof (dir as any).getDirectoryHandle === "function";
}

/**
 * Root detection now lives in `sources/coreRegistry.ts` as one pure rule (`isKnownConsoleDir`),
 * so a node suite can drive it. It used to consult ACTIVE cores only, which meant a ROM folder
 * holding just `gb/` and `gbc/` was refused here whenever tgb-dual was switched off — and the
 * folder was then never registered, so switching the core on afterwards had nothing to rescan.
 */

export async function getValidRoot(
  dir: FsDirHandle,
  reg: CoreRegistry = coreRegistry.current,
): Promise<FsDirHandle | null> {
  let hasConsoleDir = false;
  let hasHomebrewDir = false;
  let romsFolder: FsDirHandle | null = null;
  const hbDirs = [...new Set([...homebrewDirs(), "homebrews"])]

  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory") {
      if (isKnownConsoleDir(name, reg)) {
        hasConsoleDir = true;
      } else if (name.toLowerCase() === "roms") {
        romsFolder = handle as FsDirHandle;
      } else if (hbDirs.some((d) => !d.includes("/") && d.toLowerCase() === name.toLowerCase())) {
        hasHomebrewDir = true;
      }
    }
  }

  // If we found actual console folders (nes, md, doom, …) at the root, it's valid.
  if (hasConsoleDir || hasHomebrewDir) return dir;

  // Otherwise, if there is a 'roms' folder, check inside it for console folders.
  if (romsFolder) {
    for await (const [name, handle] of romsFolder.entries()) {
      if (handle.kind === "directory" && (isKnownConsoleDir(name, reg) || hbDirs.some((d) => d.toLowerCase() === `roms/${name.toLowerCase()}`))) {
        return dir;
      }
    }
  }

  return null;
}

// ── <input webkitdirectory> fallback ─────────────────────────────────────────
// Builds an in-memory FsDirHandle tree from a FileList so the rest of the
// codebase can consume it identically to a native FSAA handle.

/** A read-only directory handle shim built from <input webkitdirectory> FileList. */
class InputDirHandle implements FsDirHandle {
  kind = "directory" as const;
  name: string;
  private children = new Map<string, InputDirHandle | InputFileHandle>();
  /**
   * Stable identity fingerprint, set by `buildTreeFromFileList` on the root handle.
   *
   * Firefox has no `FileSystemHandle.isSameEntry()` — every pick returns a new in-memory
   * object, so the default `nativeIsSameEntry` (which calls `a.isSameEntry(b)`) always
   * returns `false`. Without this, picking the same folder twice registers it as two separate
   * entries in `localFolders` and then walks it twice in `dedupeSources`, doubling memory use
   * and freezing the main thread.
   *
   * The fingerprint is a sorted list of "relPath|size|lastModified" entries for every file in the original
   * FileList. Sorting removes any dependency on browser-specific enumeration order.
   * Two picks of the same folder on disk produce identical lists; a different folder or a
   * change to the contents produces a different one.
   *
   * Not `private`: `buildTreeFromFileList` (same module) sets it directly after construction.
   */
  _fingerprint: string | null = null;

  constructor(name: string) {
    this.name = name;
  }

  /** Insert a file at a relative path, creating intermediate directories. */
  insert(relPath: string, file: File): void {
    const parts = relPath.split("/");
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let cur: InputDirHandle = this;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let child = cur.children.get(seg);
      if (!child || child.kind !== "directory") {
        child = new InputDirHandle(seg);
        cur.children.set(seg, child);
      }
      cur = child as InputDirHandle;
    }
    const fileName = parts[parts.length - 1];
    cur.children.set(fileName, new InputFileHandle(fileName, file));
  }

  async *entries(): AsyncIterableIterator<[string, FsDirHandle | FsFileHandle]> {
    for (const [name, handle] of this.children) {
      yield [name, handle];
    }
  }

  /**
   * Mirrors `FileSystemHandle.isSameEntry()` so that `nativeIsSameEntry` in
   * `sources/libraryScan.ts` can recognise two picks of the same folder as identical.
   *
   * Only meaningful when both handles carry a fingerprint (i.e. both are root handles
   * returned by `buildTreeFromFileList`). A sub-directory handle has no fingerprint and
   * will always return `false`, matching the native API's semantics for handles that are
   * not the SAME entry.
   */
  async isSameEntry(other: unknown): Promise<boolean> {
    if (!(other instanceof InputDirHandle)) return false;
    if (!this._fingerprint || !other._fingerprint) return false;
    return this._fingerprint === other._fingerprint;
  }
}

class InputFileHandle implements FsFileHandle {
  kind = "file" as const;
  name: string;
  private file: File;
  constructor(name: string, file: File) {
    this.name = name;
    this.file = file;
  }
  async getFile(): Promise<File> {
    return this.file;
  }
}

/**
 * Firefox/macOS keeps the last directory on the native file-input control. Keep one hidden
 * control per logical picker so the ROM and SD flows retain separate picker locations.
 */
const fallbackInputs = new Map<string, HTMLInputElement>();

/** Pick a folder via a hidden <input webkitdirectory> element. Returns null on cancel. */
function pickFolderViaInput(id: string): Promise<FileList | null> {
  return new Promise((resolve) => {
    let input = fallbackInputs.get(id);
    if (!input) {
      input = document.createElement("input");
      input.type = "file";
      // @ts-ignore — webkitdirectory is non-standard but widely supported
      input.webkitdirectory = true;
      input.multiple = true;
      input.id = id;
      input.name = id;
      input.style.display = "none";
      document.body.appendChild(input);
      fallbackInputs.set(id, input);
    }
    let resolved = false;
    const finish = (files: FileList | null) => {
      if (resolved) return;
      resolved = true;
      resolve(files);
    };

    // `change` is dispatched after Firefox finishes its directory-upload confirmation.
    // A focus-based timeout races that confirmation and can turn a successful pick into a
    // silent cancel. The input's `cancel` event is the browser-provided no-selection signal.
    input.onchange = () => finish(input.files);
    input.oncancel = () => finish(null);

    input.click();
  });
}

/**
 * Build an InputDirHandle tree from a webkitdirectory FileList.
 *
 * Exported for `test/fsnode.mjs`, not as API: it is the read-only implementation of the
 * directory seam that Firefox and Safari already ship, so it is the reference a node-backed
 * handle is compared against. Anything indexable with a `length` satisfies the parameter.
 */
export function buildTreeFromFileList(files: ArrayLike<File>): InputDirHandle {
  // webkitRelativePath gives us "folderName/sub/file.ext" — the first segment
  // is the folder the user picked.
  const root = new InputDirHandle("roms");
  let rootName = "";
  // Fingerprint entries: collected alongside the tree build so we do one loop, not two.
  // Each entry is "relPath|size" (using the FULL webkitRelativePath, which includes the
  // top-level folder name, so two folders with the same contents but different names produce
  // different fingerprints — even though both are read-only shims with no handle identity).
  const fpEntries: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relPath = (file as any).webkitRelativePath as string;
    if (!relPath) continue;

    // Strip the top-level folder name (the folder the user actually picked)
    const firstSlash = relPath.indexOf("/");
    if (firstSlash < 0) continue; // shouldn't happen with webkitdirectory
    if (!rootName) rootName = relPath.slice(0, firstSlash);
    const inner = relPath.slice(firstSlash + 1);
    if (!inner) continue;
    root.insert(inner, file);
    // Include the full path (before stripping the top-level folder) and the file's size so
    // that the same folder picked twice yields the same fingerprint and a different folder
    // (or a changed file) yields a different one.
    fpEntries.push(`${relPath}|${file.size}|${file.lastModified}`);
  }
  // Use the actual folder name the user picked
  if (rootName) (root as any).name = rootName;
  // Assign the fingerprint: sort for stability (browser enumeration order is not guaranteed
  // to be consistent across picks) and join into one string.
  root._fingerprint = fpEntries.sort().join("\n");
  return root;
}

export async function pickFolder(id: string = "gnw-roms"): Promise<FsDirHandle | null> {
  const desktop = electronFs();
  if (desktop) {
    const picked = await desktop.pickDirectory(id);
    return picked ? electronDirHandle(picked.rootId, picked.name) : null;
  }
  if (nativeFolderPickerSupported()) {
    try {
      return await window.showDirectoryPicker!({ id, mode: "readwrite" });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      throw e;
    }
  }

  const files = await pickFolderViaInput(id);
  if (!files) return null;
  return buildTreeFromFileList(files);
}

/** Pick the SD card folder and store it on the device store — the SAME picker used by
 *  FolderGateModal.svelte (ROMs tab) and Wizard.svelte's SD-mode Install Retro-Go gate, so the
 *  user is never asked to pick it twice.
 *
 *  Outcomes, kept strictly apart (see sdFolderPick.svelte.ts, which holds the state machine):
 *  a CANCEL is a silent no-op (`pickFolder()` returns null for it); a genuine pick/scan failure
 *  is recorded on `sdFolderPick` and drawn on the gate row that raised the picker
 *  (ModalFolderSdUnreadable.dc.html). It used to be logged only, leaving the user with a button
 *  that visibly did nothing. */
export async function pickSdCardFolder(): Promise<void> {
  const { device } = await import("./device.svelte.js");
  const { runSdCardFolderPick } = await import("./sdFolderPick.svelte.js");
  await runSdCardFolderPick<FsDirHandle>({
    pick: () => pickFolder("gnw-sd-card"),
    adopt: async (handle) => {
      device.sdHandle = handle;
      // PICKING A CARD IS DECLARING THE TARGET, and this line is what makes that true.
      //
      // `targetMedia` is persisted and defaults to "flash", and until the SD card became a
      // SOURCE its only writer was the Landing page -- so every caller of this picker was
      // already in SD mode and this assignment is a no-op for them (FolderGateModal only
      // draws the SD row when `ensureFolders(sd)` was passed true, and the Wizard's gate is
      // its SD branch). The Sources pane's SD entry is the first caller that can run while
      // the app still thinks it is flashing, and without this the two notions of "SD" drift:
      //
      //  - the Library's dock keeps rendering the FLASH button, which carries the SAME
      //    `syncLibraryButton` label as the SD one, so "Sync Library" silently means "connect
      //    and flash the device" -- it calls ensureConnectGate() then boots the RAM stub,
      //    resetting a running Retro-Go, when the user asked to write files to a card;
      //  - `scanSdCardGames()` below early-returns on `targetMedia !== "sd"` and CLEARS
      //    `installedGames`, so the card is never read, and the next sync sees an empty
      //    baseline, calls itself a fresh target and rewrites the entire selection.
      //
      // Reversible from the Landing page, which is still the only other writer.
      device.targetMedia = "sd";
      await device.scanSdCardGames();
    },
    onError: (e) => {
      // `dbg()` alone: it reaches the Activity log, which a deployed build can show and a
      // bug report can carry. The console copy went only to devtools.
      dbg(`[sd] picking/scanning the SD card folder failed: ${e instanceof Error ? e.message : String(e)}`);
    },
  });
}

/**
 * Prompt for a folder and return its validated root handle. Returns null if cancelled.
 * Validates that the folder contains console subfolders, a 'roms/' folder, or homebrew.
 */
export async function pickRomFolder(id: string = "gnw-roms"): Promise<RomDirHandle | null> {
  const dir = await pickFolder(id);
  if (!dir) return null;

  const validRoot = await getValidRoot(dir);
  if (!validRoot) {
    throw new Error("Invalid folder selected. Please select your 'roms' folder containing console subfolders (e.g., nes, gbc, md).");
  }

  return validRoot;
}

/**
 * Prompt for a folder then scan it. Returns null if the user cancels the picker.
 * Uses the native File System Access API when available, otherwise falls back to
 * <input webkitdirectory>.
 */
export async function pickAndScanRomFolder(id: string = "gnw-roms", archiveRules?: NativeArchiveRules): Promise<RomScanResult | null> {
  const validRoot = await pickRomFolder(id);
  if (!validRoot) return null;

  return scanRomDirectory(validRoot, null, undefined, undefined, archiveRules);
}

/**
 * Save a file to the user's picked ROM directory. Falls back to a browser
 * download if the directory handle doesn't support write-back (Firefox fallback).
 */
export async function saveFileToDirOrDownload(
  dir: RomDirHandle | null | undefined,
  relativePath: string,
  data: Blob | Uint8Array,
): Promise<void> {
  // Try native FSAA write-back first
  if (dir && dirSupportsWriteBack(dir)) {
    const parts = relativePath.split("/");
    let currentDir: any = dir;
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
    }
    const fileName = parts[parts.length - 1];
    const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data instanceof Uint8Array ? new Blob([data as unknown as BlobPart]) : data);
    await writable.close();
    return;
  }

  // Fallback: trigger a browser download
  download(relativePath.split("/").pop() || "cover.png", data);
}

/** Delete a file at `relativePath` from `dir` via FSAA's removeEntry. No-op (not an error) if
 *  the file is already gone, or if `dir` doesn't support write-back (Firefox — nothing is
 *  actually persisted there to delete). */
/** Validate that every core file directly on the SD card (`cores/*.bin`) agrees with the given
 *  firmware version (and with each other, if no firmware version is known — e.g. validating a
 *  bare SD card with no connected/booted device to read a live firmware version from). Unlike
 *  the Flash/LittleFS path, plain `File` objects support `.slice()`, so this only ever reads
 *  the first `CORE_HEADER_PROBE_BYTES` of each core — cheap regardless of core count/size. */
export async function checkSdCoreVersions(
  dir: RomDirHandle | null | undefined,
  firmwareVersion: string | null,
): Promise<CoreVersionCheck> {
  const cores: Record<string, string | null> = {};
  if (dir) {
    for await (const [name, handle] of dir.entries()) {
      if (name !== "cores" || handle.kind !== "directory") continue;
      for await (const [coreName, coreHandle] of handle.entries()) {
        if (coreHandle.kind !== "file" || isHidden(coreName)) continue;
        const path = `cores/${coreName}`;
        try {
          const file = await coreHandle.getFile();
          const head = new Uint8Array(await file.slice(0, CORE_HEADER_PROBE_BYTES).arrayBuffer());
          cores[path] = parseCoreHeader(head)?.tag ?? null;
        } catch {
          cores[path] = null;
        }
      }
    }
  }
  return evaluateCoreVersions(firmwareVersion, cores);
}

/**
 * Read one file's text from a picked directory, or `""` when it is not there.
 *
 * Only used for a file the DEVICE also writes, where the existing contents are data we did not
 * author and must fold into rather than replace. Absent is not an error: the first star on a
 * fresh card has nothing to merge with.
 */
export async function readTextFromDir(
  dir: RomDirHandle | null | undefined,
  relativePath: string,
): Promise<string> {
  if (!dir) return "";
  const parts = relativePath.split("/");
  let currentDir: any = dir;
  try {
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(parts[i]);
    }
    const fh = await currentDir.getFileHandle(parts[parts.length - 1]);
    return await (await fh.getFile()).text();
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") return "";
    throw e;
  }
}

export async function deleteFileFromDir(dir: RomDirHandle | null | undefined, relativePath: string): Promise<void> {
  if (!dir || !dirSupportsWriteBack(dir)) return;
  const parts = relativePath.split("/");
  let currentDir: any = dir;
  try {
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(parts[i]);
    }
    await currentDir.removeEntry(parts[parts.length - 1]);
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") return;
    throw e;
  }
}

/** Remove empty parent directories below the card's top-level directory. */
export async function pruneEmptyParents(dir: RomDirHandle | null | undefined, relativePath: string): Promise<void> {
  if (!dir || !dirSupportsWriteBack(dir)) return;
  const parts = relativePath.split("/");
  // Keep the top-level directory (homebrews, roms, etc.) as part of the card layout.
  for (let depth = parts.length - 2; depth >= 1; depth--) {
    let parent: any = dir;
    try {
      for (let i = 0; i < depth; i++) parent = await parent.getDirectoryHandle(parts[i]);
      const candidate = await parent.getDirectoryHandle(parts[depth]);
      let empty = true;
      for await (const _ of candidate.entries()) { empty = false; break; }
      if (!empty) break;
      await parent.removeEntry(parts[depth]);
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError") break;
      throw e;
    }
  }
}
